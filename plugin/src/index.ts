import type { Hooks, Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin";
import type {
  CommandResult,
  SessionMessage,
  SessionInfo,
  StateMessage,
} from "@opencode-avatar/shared";
import { randomUUID } from "crypto";
import { createLogger } from "./logger.js";
import { handleCommand } from "./command-handler.js";
import { SessionRegistry, type SessionMemberRuntime } from "./session-registry.js";
import { SharedSessionStore } from "./shared-session-store.js";
import { SessionStateMachine } from "./state-machine.js";
import { TokenTracker } from "./token-tracker.js";
import { AvatarWSServer } from "./ws-server.js";

type EventInput = Parameters<NonNullable<Hooks["event"]>>[0];
type SDKEvent = EventInput["event"];
type ChatMessageInput = Parameters<NonNullable<Hooks["chat.message"]>>[0];
type ChatMessageOutput = Parameters<NonNullable<Hooks["chat.message"]>>[1];
type PermissionAskInput = Parameters<NonNullable<Hooks["permission.ask"]>>[0];
type ToolBeforeInput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[0];
type ToolBeforeOutput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[1];
type ToolAfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0];

const DEFAULT_WS_PORT = 2728;
const TICK_INTERVAL_MS = 250;
const CROSS_PROCESS_TIMEOUT_MS = 10_000;

const log = createLogger("plugin");
const port = getPortFromEnv(process.env.AVATAR_WS_PORT);
const wsServer = new AvatarWSServer(port);
const registry = new SessionRegistry();
const instanceId = process.env.AVATAR_INSTANCE_ID?.trim() || randomUUID();
const sharedSessionStore = new SharedSessionStore(instanceId);

let serverStartPromise: Promise<void> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let sharedSyncCache: SessionInfo[] = [];
let sdkClient: PluginInput["client"] | null = null;
const pendingCrossProcessCommands = new Map<
  string,
  {
    createdAt: number;
    sessionId: string;
    command: string;
    reply: (result: CommandResult) => void;
  }
>();

function isLeaderInstance(): boolean {
  return wsServer.getPort() > 0;
}

function makeCommandFailureResult(requestId: string, error: string): CommandResult {
  return {
    type: "command.result",
    requestId,
    success: false,
    error,
  };
}

function routeIncomingCommand(
  message: Parameters<Parameters<typeof wsServer.setMessageHandler>[0]>[0],
  reply: (result: CommandResult) => void,
): void {
  const now = Date.now();
  const isLocalSession = registry.getGroupIdForSession(message.sessionId) !== null;

  log.info("command_routed", {
    command: message.command,
    requestId: message.requestId,
    sessionId: message.sessionId,
    route: isLocalSession ? "local" : "cross-process",
  });

  if (isLocalSession) {
    void handleCommand(message, sdkClient).then((result) => {
      reply(result);
    });
    return;
  }

  const existsInMergedSync = sharedSyncCache.some((session) => session.sessionId === message.sessionId);
  if (!existsInMergedSync) {
    const result = makeCommandFailureResult(message.requestId, "session not found");
    log.warn("command_route_session_not_found", {
      command: message.command,
      requestId: message.requestId,
      sessionId: message.sessionId,
    });
    reply(result);
    return;
  }

  const written = sharedSessionStore.writeCommand(message, now);
  if (!written) {
    const result = makeCommandFailureResult(message.requestId, "failed to route command");
    log.error("command_route_write_failed", {
      command: message.command,
      requestId: message.requestId,
      sessionId: message.sessionId,
    });
    reply(result);
    return;
  }

  pendingCrossProcessCommands.set(message.requestId, {
    createdAt: now,
    sessionId: message.sessionId,
    command: message.command,
    reply,
  });

  log.info("command_routed_to_shared_store", {
    command: message.command,
    requestId: message.requestId,
    sessionId: message.sessionId,
  });
}

function pollCrossProcessCommands(now = Date.now()): void {
  if (isLeaderInstance()) {
    return;
  }

  const localSessionIds = new Set(registry.getSnapshots(now).map((snapshot) => snapshot.sessionId));
  const commands = sharedSessionStore.pollCommands(localSessionIds, now);
  for (const commandFile of commands) {
    const message = commandFile.message;
    log.info("command_polled_for_execution", {
      command: message.command,
      requestId: message.requestId,
      sessionId: message.sessionId,
    });

    void handleCommand(message, sdkClient).then((result) => {
      const written = sharedSessionStore.writeResult(result, Date.now());
      if (!written) {
        log.error("command_result_write_failed", {
          requestId: result.requestId,
          success: result.success,
        });
        return;
      }

      log.info("command_result_written", {
        requestId: result.requestId,
        success: result.success,
      });
    });
  }
}

function pollCrossProcessResults(now = Date.now()): void {
  if (!isLeaderInstance()) {
    return;
  }

  // Leader also polls command files with an empty session set to clean stale commands.
  sharedSessionStore.pollCommands(new Set(), now);

  const results = sharedSessionStore.pollResults();
  for (const resultFile of results) {
    const pending = pendingCrossProcessCommands.get(resultFile.result.requestId);
    if (!pending) {
      wsServer.broadcast(resultFile.result);
      log.warn("command_result_without_pending_request", {
        requestId: resultFile.result.requestId,
      });
      continue;
    }

    pendingCrossProcessCommands.delete(resultFile.result.requestId);
    pending.reply(resultFile.result);
    log.info("command_result_returned", {
      requestId: resultFile.result.requestId,
      success: resultFile.result.success,
      route: "cross-process",
    });
  }

  for (const [requestId, pending] of pendingCrossProcessCommands.entries()) {
    if (now - pending.createdAt <= CROSS_PROCESS_TIMEOUT_MS) {
      continue;
    }

    pendingCrossProcessCommands.delete(requestId);
    pending.reply(makeCommandFailureResult(requestId, "command timed out"));
    log.warn("command_result_timeout", {
      command: pending.command,
      requestId,
      sessionId: pending.sessionId,
      timeoutMs: CROSS_PROCESS_TIMEOUT_MS,
    });
  }
}

function getPortFromEnv(value: string | undefined): number {
  if (!value) {
    return DEFAULT_WS_PORT;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_WS_PORT;
}

function ensureServerStarted(): void {
  wsServer.setMessageHandler((message, reply) => {
    routeIncomingCommand(message, reply);
  });

  if (!serverStartPromise) {
    log.info("plugin_initializing", { port });
    serverStartPromise = wsServer.start().then(() => {
      log.info("plugin_ready", { port: wsServer.getPort() });
      refreshSyncData();
    }).catch((error: unknown) => {
      serverStartPromise = null;
      log.error("ws_start_failed", { error: getUnknownErrorMessage(error) });
    });
  }

  if (!tickTimer) {
    tickTimer = setInterval(() => {
      const now = Date.now();

      for (const snapshot of registry.getSnapshots(now)) {
        broadcastState(snapshot.sessionId, now);
      }

      pollCrossProcessCommands(now);
      pollCrossProcessResults(now);
      refreshSyncData(now);
    }, TICK_INTERVAL_MS);
  }
}

function refreshSyncData(now = Date.now()): void {
  updateSyncData(registry.getSnapshots(now), now, true);
}

function updateSyncData(localSnapshots: SessionInfo[], now: number, persistLocal: boolean): void {
  if (persistLocal) {
    sharedSessionStore.write(localSnapshots, now);
  }

  const mergedSnapshots = sharedSessionStore.readMerged(localSnapshots, now);
  const changed = haveSessionsChanged(sharedSyncCache, mergedSnapshots);

  sharedSyncCache = mergedSnapshots;
  wsServer.setSyncData(mergedSnapshots);

  if (changed && wsServer.getPort() > 0) {
    wsServer.broadcastSync();
  }
}

function haveSessionsChanged(previous: SessionInfo[], next: SessionInfo[]): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index];
    const right = next[index];

    if (!left || !right) {
      return true;
    }

    if (
      left.sessionId !== right.sessionId ||
      left.name !== right.name ||
      left.state !== right.state ||
      left.label !== right.label ||
      left.lastResponse !== right.lastResponse ||
      left.pendingPermission?.permissionId !== right.pendingPermission?.permissionId ||
      left.pendingPermission?.title !== right.pendingPermission?.title ||
      left.tokens.total !== right.tokens.total ||
      left.tokens.rate !== right.tokens.rate
    ) {
      return true;
    }
  }

  return false;
}

function getOrCreateSession(
  sessionId: string,
  options: {
    name?: string;
    parentId?: string;
  } = {},
): {
  member: ReturnType<SessionRegistry["getSession"]> extends infer T ? Exclude<T, null> : never;
  groupId: string;
  groupCreated: boolean;
} {
  const result = registry.ensureSession(sessionId, options);

  if (result.memberCreated) {
    log.info("session_created", {
      sessionId,
      name: options.name ?? "",
      parentId: options.parentId ?? null,
      groupId: result.groupId,
    });
  }

  if (result.removedGroup) {
    const message: SessionMessage = {
      type: "session",
      sessionId: result.removedGroup.groupId,
      action: "ended",
      name: result.removedGroup.name,
      timestamp: Date.now(),
    };

    wsServer.broadcast(message);
  }

  refreshSyncData();

  return {
    member: result.member,
    groupId: result.groupId,
    groupCreated: result.groupCreated,
  };
}

function removeSession(sessionId: string): void {
  const result = registry.removeSession(sessionId);
  if (!result) {
    return;
  }

  if (result.groupRemoved) {
    const message: SessionMessage = {
      type: "session",
      sessionId: result.groupId,
      action: "ended",
      name: result.name,
      timestamp: Date.now(),
    };

    wsServer.broadcast(message);
  } else {
    broadcastSession(result.groupId, "resumed");
    broadcastState(result.groupId);
  }

  refreshSyncData();
  log.info("session_removed", { sessionId, groupId: result.groupId, name: result.name });
}

function broadcastSession(sessionId: string, action: SessionMessage["action"]): void {
  const snapshot = registry.getSnapshotBySessionId(sessionId, Date.now());
  if (!snapshot) {
    return;
  }

  const message: SessionMessage = {
    type: "session",
    sessionId: snapshot.sessionId,
    action,
    name: snapshot.name,
    timestamp: Date.now(),
  };

  wsServer.broadcast(message);
  refreshSyncData();
}

function broadcastState(sessionId: string, now = Date.now()): void {
  const snapshot = registry.getSnapshotBySessionId(sessionId, now);
  if (!snapshot) {
    return;
  }

  const message: StateMessage = {
    type: "state",
    sessionId: snapshot.sessionId,
    state: snapshot.state,
    label: snapshot.label,
    tokens: snapshot.tokens,
    timestamp: now,
  };

  wsServer.broadcast(message);
  refreshSyncData(now);
}

function logSessionStateSummary(reason: string, groupId: string, member: SessionMemberRuntime, now = Date.now()): void {
  const snapshot = registry.getSnapshotByGroupId(groupId, now);
  if (!snapshot) {
    return;
  }

  const diagnostics = member.sm.getDiagnostics();
  log.info("session_state_summary", {
    reason,
    sessionId: member.sessionId,
    groupId,
    state: snapshot.state,
    label: snapshot.label,
    tokenRate: snapshot.tokens.rate,
    activeToolCount: diagnostics.activeToolCount,
    activeTools: diagnostics.activeTools,
    isThinking: diagnostics.isThinking,
    hasWaiting: diagnostics.hasWaiting,
    hasError: diagnostics.hasError,
  });
}

function normalizeArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function getPermissionLabel(input: PermissionAskInput): string {
  if (typeof input.title === "string" && input.title.length > 0) {
    return input.title;
  }

  return "Permission requested";
}

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getSessionErrorMessage(event: Extract<SDKEvent, { type: "session.error" }>): string {
  const error = event.properties.error;
  if (!error) {
    return "Session error";
  }

  if ("data" in error && error.data && typeof error.data === "object") {
    const message = (error.data as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return error.name;
}

function getAssistantTokenTotal(event: Extract<SDKEvent, { type: "message.updated" }>): number | null {
  const info = event.properties.info;
  if (info.role !== "assistant") {
    return null;
  }

  if (!("tokens" in info) || !info.tokens) {
    return null;
  }

  return (
    info.tokens.input +
    info.tokens.output +
    info.tokens.reasoning +
    info.tokens.cache.read +
    info.tokens.cache.write
  );
}

function handleEvent(event: SDKEvent): void {
  switch (event.type) {
    case "session.created": {
      const { groupId, groupCreated } = getOrCreateSession(event.properties.info.id, {
        name: event.properties.info.title,
        parentId: event.properties.info.parentID,
      });
      broadcastSession(groupId, groupCreated ? "created" : "resumed");
      broadcastState(groupId);
      return;
    }
    case "session.updated": {
      const { groupId, groupCreated } = getOrCreateSession(event.properties.info.id, {
        name: event.properties.info.title,
        parentId: event.properties.info.parentID,
      });
      broadcastSession(groupId, groupCreated ? "created" : "resumed");
      broadcastState(groupId);
      return;
    }
    case "session.deleted": {
      removeSession(event.properties.info.id);
      return;
    }
    case "session.status": {
      const { member, groupId } = getOrCreateSession(event.properties.sessionID);
      if (event.properties.status.type === "busy") {
        member.sm.onMessageDelta();
      } else {
        member.sm.onMessageComplete();
      }
      logSessionStateSummary(`session.status:${event.properties.status.type}`, groupId, member);
      broadcastState(groupId);
      return;
    }
    case "session.idle": {
      const { member, groupId } = getOrCreateSession(event.properties.sessionID);
      member.sm.onMessageComplete();
      logSessionStateSummary("session.idle", groupId, member);
      broadcastState(groupId);
      return;
    }
    case "session.error": {
      const sessionId = event.properties.sessionID;
      if (!sessionId) {
        log.warn("session_error_missing_session", { error: getSessionErrorMessage(event) });
        return;
      }

      const { member, groupId } = getOrCreateSession(sessionId);
      member.sm.onError(getSessionErrorMessage(event));
      logSessionStateSummary("session.error", groupId, member);
      broadcastState(groupId);
      return;
    }
    case "permission.replied": {
      const { member, groupId } = getOrCreateSession(event.properties.sessionID);
      member.sm.onPermissionReplied();
      member.pendingPermission = null;
      log.info("permission_cleared", {
        permissionId: event.properties.permissionID,
        response: event.properties.response,
        sessionId: event.properties.sessionID,
      });
      logSessionStateSummary("permission.replied", groupId, member);
      broadcastState(groupId);
      return;
    }
    case "message.part.updated": {
      const part = event.properties.part;
      if (part.type !== "text") {
        return;
      }

      const { member, groupId } = getOrCreateSession(part.sessionID);
      member.lastResponse = part.text.slice(-200);
      log.debug("last_response_updated", {
        chars: member.lastResponse.length,
        sessionId: part.sessionID,
      });
      broadcastState(groupId);
      return;
    }
    case "message.updated": {
      const info = event.properties.info;
      if (info.role !== "assistant") {
        return;
      }

      const { member, groupId } = getOrCreateSession(info.sessionID);
      const total = getAssistantTokenTotal(event);
      if (total !== null) {
        const previous = member.assistantMessageTotals.get(info.id) ?? 0;
        const delta = total - previous;

        // message.updated is cumulative per assistant message, so only add the delta.
        if (delta > 0) {
          member.tokens.add(delta, Date.now());
          member.assistantMessageTotals.set(info.id, total);
        }
      }

      if (info.time.completed || info.error || info.finish) {
        member.sm.onMessageComplete();
      } else {
        member.sm.onMessageDelta();
      }

      broadcastState(groupId);
      return;
    }
    default:
      return;
  }
}

function handleChatMessage(input: ChatMessageInput, _output: ChatMessageOutput): void {
  const { member, groupId } = getOrCreateSession(input.sessionID);
  member.sm.onMessageDelta();
  broadcastState(groupId);
}

function handlePermissionAsk(input: PermissionAskInput): void {
  const { member, groupId } = getOrCreateSession(input.sessionID);
  const label = getPermissionLabel(input);
  member.sm.onPermissionAsked(label);
  member.pendingPermission = {
    permissionId: input.id,
    title: input.title,
  };
  log.info("permission_pending", {
    permissionId: input.id,
    sessionId: input.sessionID,
    title: label,
  });
  logSessionStateSummary("permission.ask", groupId, member);
  broadcastState(groupId);
}

function handleToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): void {
  const { member, groupId } = getOrCreateSession(input.sessionID);
  member.sm.onToolStart(input.tool, normalizeArgs(output.args));
  logSessionStateSummary(`tool.before:${input.tool}`, groupId, member);
  broadcastState(groupId);
}

function handleToolAfter(input: ToolAfterInput): void {
  const { member, groupId } = getOrCreateSession(input.sessionID);
  member.sm.onToolEnd(input.tool);
  logSessionStateSummary(`tool.after:${input.tool}`, groupId, member);
  broadcastState(groupId);
}

export const server: Plugin = async (input) => {
  sdkClient = input.client;
  log.info("sdk_client_captured", { captured: sdkClient !== null });
  ensureServerStarted();

  return {
    event: async ({ event }) => {
      handleEvent(event);
    },
    "chat.message": async (input, output) => {
      handleChatMessage(input, output);
    },
    "permission.ask": async (input) => {
      handlePermissionAsk(input);
    },
    "tool.execute.before": async (input, output) => {
      handleToolBefore(input, output);
    },
    "tool.execute.after": async (input) => {
      handleToolAfter(input);
    },
    unload: async () => {
      pendingCrossProcessCommands.clear();
      sharedSessionStore.remove();
      updateSyncData([], Date.now(), false);
    },
  };
};

export const id = "opencode-avatar";

const plugin: PluginModule = {
  id,
  server,
};

export default plugin;
