import {
  type AvatarState,
  type SessionInfo,
  type TokenData,
  DEFAULT_TOOL_STATE,
  STATE_PRIORITY,
  TOOL_STATE_MAP,
} from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("state-machine");

const TOOL_HOLD_MS = 500;
const ERROR_HOLD_MS = 5000;

interface ActiveTool {
  name: string;
  state: AvatarState;
  label: string | null;
}

export class SessionStateMachine {
  private readonly sessionId: string;
  private sessionName = "";
  private activeTools: ActiveTool[] = [];
  private isThinking = false;
  private waitingLabel: string | null = null;
  private errorLabel: string | null = null;
  private errorUntil = 0;
  private holdState: AvatarState | null = null;
  private holdLabel: string | null = null;
  private holdUntil = 0;
  private now = 0;
  private tokenData: TokenData = { total: 0, rate: 0 };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setName(name: string): void {
    this.sessionName = name;
  }

  setTokens(tokens: TokenData): void {
    this.tokenData = tokens;
  }

  getState(): AvatarState {
    this.clearExpiredState();

    if (this.errorLabel !== null) {
      return "error";
    }

    if (this.waitingLabel !== null) {
      return "waiting";
    }

    const tool = this.getHighestPriorityTool();
    if (tool) {
      return tool.state;
    }

    if (this.holdState !== null) {
      return this.holdState;
    }

    if (this.isThinking) {
      return "thinking";
    }

    return "idle";
  }

  getLabel(): string | null {
    this.clearExpiredState();

    if (this.errorLabel !== null) {
      return this.errorLabel;
    }

    if (this.waitingLabel !== null) {
      return this.waitingLabel;
    }

    const tool = this.getHighestPriorityTool();
    if (tool) {
      return tool.label;
    }

    if (this.holdState !== null) {
      return this.holdLabel;
    }

    return null;
  }

  onToolStart(toolName: string, args: Record<string, unknown>): void {
    const state = TOOL_STATE_MAP[toolName] ?? DEFAULT_TOOL_STATE;
    const label = this.makeToolLabel(toolName, args);

    this.activeTools.push({ name: toolName, state, label });
    this.isThinking = false;
    this.holdState = null;
    this.holdLabel = null;
    this.holdUntil = 0;

    log.debug("tool_start", { sessionId: this.sessionId, toolName, state, label });
  }

  onToolEnd(toolName: string): void {
    const index = this.findLastToolIndex(toolName);
    if (index === -1) {
      return;
    }

    const [removed] = this.activeTools.splice(index, 1);
    if (this.activeTools.length === 0) {
      this.holdState = removed.state;
      this.holdLabel = removed.label;
      this.holdUntil = this.now + TOOL_HOLD_MS;
    }

    log.debug("tool_end", { sessionId: this.sessionId, toolName });
  }

  onMessageDelta(): void {
    this.isThinking = true;
  }

  onMessageComplete(): void {
    this.isThinking = false;
  }

  onPermissionAsked(label: string): void {
    this.waitingLabel = label;
  }

  onPermissionReplied(): void {
    this.waitingLabel = null;
  }

  onError(message: string): void {
    this.errorLabel = message;
    this.errorUntil = this.now + ERROR_HOLD_MS;

    log.error("session_error", { sessionId: this.sessionId, message });
  }

  tick(ms: number): void {
    this.now += ms;
    this.clearExpiredState();
  }

  advanceTime(realNow: number): void {
    this.now = realNow;
    this.clearExpiredState();
  }

  snapshot(): SessionInfo {
    return {
      sessionId: this.sessionId,
      name: this.sessionName,
      state: this.getState(),
      label: this.getLabel(),
      tokens: this.tokenData,
    };
  }

  private getHighestPriorityTool(): ActiveTool | null {
    let best: ActiveTool | null = null;

    for (const tool of this.activeTools) {
      if (!best || STATE_PRIORITY[tool.state] < STATE_PRIORITY[best.state]) {
        best = tool;
      }
    }

    return best;
  }

  private clearExpiredState(): void {
    if (this.errorLabel !== null && this.now >= this.errorUntil) {
      this.errorLabel = null;
      this.errorUntil = 0;
    }

    if (this.holdState !== null && this.now >= this.holdUntil) {
      this.holdState = null;
      this.holdLabel = null;
      this.holdUntil = 0;
    }
  }

  private findLastToolIndex(toolName: string): number {
    for (let index = this.activeTools.length - 1; index >= 0; index -= 1) {
      if (this.activeTools[index]?.name === toolName) {
        return index;
      }
    }

    return -1;
  }

  private makeToolLabel(toolName: string, args: Record<string, unknown>): string | null {
    switch (toolName) {
      case "Read":
        return `Reading ${this.getStringArg(args, "path") ?? this.getStringArg(args, "filePath") ?? "file"}`;
      case "Edit":
        return `Editing ${this.getStringArg(args, "filePath") ?? "file"}`;
      case "Write":
        return `Writing ${this.getStringArg(args, "filePath") ?? "file"}`;
      case "Grep":
        return `Searching ${this.getStringArg(args, "pattern") ?? ""}`.trimEnd();
      case "Glob":
        return `Finding ${this.getStringArg(args, "pattern") ?? ""}`.trimEnd();
      case "Bash": {
        const command = this.getStringArg(args, "command") ?? "command";
        return `Running ${command.slice(0, 40)}`;
      }
      default:
        return null;
    }
  }

  private getStringArg(args: Record<string, unknown>, key: string): string | null {
    const value = args[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
