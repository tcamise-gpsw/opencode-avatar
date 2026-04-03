import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin";
import type {
  SessionMessage,
  SessionInfo,
  StateMessage,
} from "@opencode-avatar/shared";
import { randomUUID } from "crypto";
import { createLogger } from "./logger.js";
import { SessionRegistry } from "./session-registry.js";
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

const log = createLogger("plugin");
const port = getPortFromEnv(process.env.AVATAR_WS_PORT);
const wsServer = new AvatarWSServer(port);
const registry = new SessionRegistry();
const instanceId = process.env.AVATAR_INSTANCE_ID?.trim() || randomUUID();
const sharedSessionStore = new SharedSessionStore(instanceId);

let serverStartPromise: Promise<void> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let sharedSyncCache: SessionInfo[] = [];

function getPortFromEnv(value: string | undefined): number {
  if (!value) {
    return DEFAULT_WS_PORT;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_WS_PORT;
}

function ensureServerStarted(): void {
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
      broadcastState(groupId);
      return;
    }
    case "session.idle": {
      const { member, groupId } = getOrCreateSession(event.properties.sessionID);
      member.sm.onMessageComplete();
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
      broadcastState(groupId);
      return;
    }
    case "permission.replied": {
      const { member, groupId } = getOrCreateSession(event.properties.sessionID);
      member.sm.onPermissionReplied();
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
  member.sm.onPermissionAsked(getPermissionLabel(input));
  broadcastState(groupId);
}

function handleToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): void {
  const { member, groupId } = getOrCreateSession(input.sessionID);
  member.sm.onToolStart(input.tool, normalizeArgs(output.args));
  broadcastState(groupId);
}

function handleToolAfter(input: ToolAfterInput): void {
  const { member, groupId } = getOrCreateSession(input.sessionID);
  member.sm.onToolEnd(input.tool);
  broadcastState(groupId);
}

export const server: Plugin = async () => {
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
