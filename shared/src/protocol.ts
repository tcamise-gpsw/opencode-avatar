/** Avatar states ordered by priority (highest first) */
export const AVATAR_STATES = [
  "error",
  "waiting",
  "running",
  "editing",
  "reading",
  "thinking",
  "idle",
] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];

/** State priority map - lower number = higher priority */
export const STATE_PRIORITY: Record<AvatarState, number> = {
  error: 0,
  waiting: 1,
  running: 2,
  editing: 3,
  reading: 4,
  thinking: 5,
  idle: 6,
};

/** Token data included in state updates */
export interface TokenData {
  /** Cumulative token count for this session */
  total: number;
  /** Tokens per second, rolling 5-second average */
  rate: number;
}

/** Session info shared across message types */
export interface SessionInfo {
  sessionId: string;
  name: string;
  state: AvatarState;
  /** Human-readable context. For display in a future hover tooltip. */
  label: string | null;
  tokens: TokenData;
}

// --- WebSocket Messages: Plugin -> App ---

export interface StateMessage {
  type: "state";
  sessionId: string;
  state: AvatarState;
  /** Human-readable context, e.g. "Reading main.ts". For display in future hover tooltip. */
  label: string | null;
  tokens: TokenData;
  timestamp: number;
}

export type SessionAction = "created" | "ended" | "resumed";

export interface SessionMessage {
  type: "session";
  sessionId: string;
  action: SessionAction;
  name: string;
  timestamp: number;
}

export interface SyncMessage {
  type: "sync";
  sessions: SessionInfo[];
}

export type PluginMessage = StateMessage | SessionMessage | SyncMessage;

// --- Tool-to-state mapping ---

/** Maps OpenCode tool names to avatar states */
export const TOOL_STATE_MAP: Record<string, AvatarState> = {
  // Reading tools
  Read: "reading",
  Grep: "reading",
  Glob: "reading",
  // Editing tools
  Edit: "editing",
  Write: "editing",
  // Running tools
  Bash: "running",
  // Browser tools (reading)
  playwright_browser_snapshot: "reading",
  playwright_browser_take_screenshot: "reading",
  playwright_browser_navigate: "running",
  playwright_browser_click: "running",
  // Task/subagent tools
  Task: "thinking",
};

/** Default state for tools not in the map */
export const DEFAULT_TOOL_STATE: AvatarState = "running";
