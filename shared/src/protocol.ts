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
  /** Last assistant text snippet (tail, ~200 chars). */
  lastResponse: string | null;
  /** Pending permission request for this session, if any. */
  pendingPermission: {
    permissionId: string;
    title: string;
  } | null;
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

// --- WebSocket Messages: App -> Plugin ---

export interface PromptCommand {
  type: "command";
  command: "prompt";
  sessionId: string;
  text: string;
  requestId: string;
}

export interface PermissionReplyCommand {
  type: "command";
  command: "permission.reply";
  sessionId: string;
  permissionId: string;
  allow: boolean;
  requestId: string;
}

export interface CloseRobotCommand {
  type: "command";
  command: "robot.close";
  sessionId: string;
  requestId: string;
}

export type AppMessage = PromptCommand | PermissionReplyCommand | CloseRobotCommand;

// --- WebSocket Messages: Plugin -> App ---

export interface CommandResult {
  type: "command.result";
  requestId: string;
  success: boolean;
  error?: string;
}

export type PluginMessage = StateMessage | SessionMessage | SyncMessage | CommandResult;

// --- Tool-to-state mapping ---

/** Maps OpenCode tool names to avatar states */
export const TOOL_STATE_MAP: Record<string, AvatarState> = {
  // Reading tools
  Read: "reading",
  read: "reading",
  Grep: "reading",
  grep: "reading",
  Glob: "reading",
  glob: "reading",
  // Editing tools
  Edit: "editing",
  edit: "editing",
  Write: "editing",
  write: "editing",
  // Running tools
  Bash: "running",
  bash: "running",
  // Browser tools (reading)
  playwright_browser_snapshot: "reading",
  playwright_browser_take_screenshot: "reading",
  playwright_browser_navigate: "running",
  playwright_browser_click: "running",
  // Task/subagent tools
  Task: "thinking",
  task: "thinking",
};

/** Default state for tools not in the map */
export const DEFAULT_TOOL_STATE: AvatarState = "running";
