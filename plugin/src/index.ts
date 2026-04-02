import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin";
import type {
  SessionMessage,
  StateMessage,
} from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";
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

interface SessionRuntime {
  sm: SessionStateMachine;
  tokens: TokenTracker;
  assistantMessageTotals: Map<string, number>;
}

const DEFAULT_WS_PORT = 2728;
const TICK_INTERVAL_MS = 250;

const log = createLogger("plugin");
const port = getPortFromEnv(process.env.AVATAR_WS_PORT);
const wsServer = new AvatarWSServer(port);
const sessions = new Map<string, SessionRuntime>();

let serverStartPromise: Promise<void> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

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
    }).catch((error: unknown) => {
      serverStartPromise = null;
      log.error("ws_start_failed", { error: getUnknownErrorMessage(error) });
    });
  }

  if (!tickTimer) {
    tickTimer = setInterval(() => {
      const now = Date.now();

      for (const [sessionId, session] of sessions) {
        const before = session.sm.snapshot();
        session.sm.advanceTime(now);
        session.sm.setTokens(session.tokens.getData(now));
        const after = session.sm.snapshot();

        if (
          before.state !== after.state ||
          before.label !== after.label ||
          before.tokens.total !== after.tokens.total ||
          before.tokens.rate !== after.tokens.rate
        ) {
          broadcastState(sessionId);
        }
      }

      refreshSyncData(now);
    }, TICK_INTERVAL_MS);
  }
}

function refreshSyncData(now = Date.now()): void {
  const snapshots = Array.from(sessions.values(), (session) => {
    session.sm.advanceTime(now);
    session.sm.setTokens(session.tokens.getData(now));
    return session.sm.snapshot();
  });

  wsServer.setSyncData(snapshots);
}

function getOrCreateSession(sessionId: string, name?: string): {
  session: SessionRuntime;
  created: boolean;
} {
  let session = sessions.get(sessionId);
  let created = false;

  if (!session) {
    session = {
      sm: new SessionStateMachine(sessionId),
      tokens: new TokenTracker(),
      assistantMessageTotals: new Map(),
    };
    sessions.set(sessionId, session);
    created = true;
    log.info("session_created", { sessionId, name: name ?? "" });
  }

  if (name) {
    session.sm.setName(name);
  }

  session.sm.advanceTime(Date.now());
  session.sm.setTokens(session.tokens.getData(Date.now()));
  refreshSyncData();

  return { session, created };
}

function removeSession(sessionId: string, name: string): void {
  if (!sessions.delete(sessionId)) {
    return;
  }

  const message: SessionMessage = {
    type: "session",
    sessionId,
    action: "ended",
    name,
    timestamp: Date.now(),
  };

  wsServer.broadcast(message);
  refreshSyncData();
  log.info("session_removed", { sessionId, name });
}

function broadcastSession(sessionId: string, action: SessionMessage["action"]): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  const snapshot = session.sm.snapshot();
  const message: SessionMessage = {
    type: "session",
    sessionId,
    action,
    name: snapshot.name,
    timestamp: Date.now(),
  };

  wsServer.broadcast(message);
  refreshSyncData();
}

function broadcastState(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  const now = Date.now();
  session.sm.advanceTime(now);
  session.sm.setTokens(session.tokens.getData(now));
  const snapshot = session.sm.snapshot();

  const message: StateMessage = {
    type: "state",
    sessionId,
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
      const { created } = getOrCreateSession(event.properties.info.id, event.properties.info.title);
      broadcastSession(event.properties.info.id, created ? "created" : "resumed");
      broadcastState(event.properties.info.id);
      return;
    }
    case "session.updated": {
      const { created } = getOrCreateSession(event.properties.info.id, event.properties.info.title);
      broadcastSession(event.properties.info.id, created ? "created" : "resumed");
      broadcastState(event.properties.info.id);
      return;
    }
    case "session.deleted": {
      removeSession(event.properties.info.id, event.properties.info.title);
      return;
    }
    case "session.status": {
      const { session } = getOrCreateSession(event.properties.sessionID);
      if (event.properties.status.type === "busy") {
        session.sm.onMessageDelta();
      } else {
        session.sm.onMessageComplete();
      }
      broadcastState(event.properties.sessionID);
      return;
    }
    case "session.idle": {
      const { session } = getOrCreateSession(event.properties.sessionID);
      session.sm.onMessageComplete();
      broadcastState(event.properties.sessionID);
      return;
    }
    case "session.error": {
      const sessionId = event.properties.sessionID;
      if (!sessionId) {
        log.warn("session_error_missing_session", { error: getSessionErrorMessage(event) });
        return;
      }

      const { session } = getOrCreateSession(sessionId);
      session.sm.onError(getSessionErrorMessage(event));
      broadcastState(sessionId);
      return;
    }
    case "permission.replied": {
      const { session } = getOrCreateSession(event.properties.sessionID);
      session.sm.onPermissionReplied();
      broadcastState(event.properties.sessionID);
      return;
    }
    case "message.updated": {
      const info = event.properties.info;
      if (info.role !== "assistant") {
        return;
      }

      const { session } = getOrCreateSession(info.sessionID);
      const total = getAssistantTokenTotal(event);
      if (total !== null) {
        const previous = session.assistantMessageTotals.get(info.id) ?? 0;
        const delta = total - previous;

        // message.updated is cumulative per assistant message, so only add the delta.
        if (delta > 0) {
          session.tokens.add(delta, Date.now());
          session.assistantMessageTotals.set(info.id, total);
        }
      }

      if (info.time.completed || info.error || info.finish) {
        session.sm.onMessageComplete();
      } else {
        session.sm.onMessageDelta();
      }

      broadcastState(info.sessionID);
      return;
    }
    default:
      return;
  }
}

function handleChatMessage(input: ChatMessageInput, _output: ChatMessageOutput): void {
  const { session } = getOrCreateSession(input.sessionID);
  session.sm.onMessageDelta();
  broadcastState(input.sessionID);
}

function handlePermissionAsk(input: PermissionAskInput): void {
  const { session } = getOrCreateSession(input.sessionID);
  session.sm.onPermissionAsked(getPermissionLabel(input));
  broadcastState(input.sessionID);
}

function handleToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): void {
  const { session } = getOrCreateSession(input.sessionID);
  session.sm.onToolStart(input.tool, normalizeArgs(output.args));
  broadcastState(input.sessionID);
}

function handleToolAfter(input: ToolAfterInput): void {
  const { session } = getOrCreateSession(input.sessionID);
  session.sm.onToolEnd(input.tool);
  broadcastState(input.sessionID);
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
  };
};

const plugin: PluginModule = {
  server,
};

export default plugin;
