import {
  type AvatarState,
  type SessionInfo,
  type TokenData,
  DEFAULT_TOOL_STATE,
  STATE_PRIORITY,
  TOOL_STATE_MAP,
} from "@opencode-avatar/shared";
import { createLogger } from "./logger.js";

const log = createLogger("state-machine");

const TOOL_HOLD_MS = 500;
const ERROR_HOLD_MS = 5000;

interface ActiveTool {
  name: string;
  state: AvatarState;
  label: string | null;
}

export interface SessionStateDiagnostics {
  activeToolCount: number;
  activeTools: string[];
  hasError: boolean;
  hasWaiting: boolean;
  isThinking: boolean;
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
    if (tool && this.shouldUseHeldState(tool.state)) {
      return this.holdState!;
    }

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
    if (tool && this.shouldUseHeldState(tool.state)) {
      return this.holdLabel;
    }

    if (tool) {
      return tool.label;
    }

    if (this.holdState !== null) {
      return this.holdLabel;
    }

    return null;
  }

  onToolStart(toolName: string, args: Record<string, unknown>): void {
    const normalizedToolName = this.normalizeToolName(toolName);
    const state = this.resolveToolState(toolName, normalizedToolName);
    const label = this.makeToolLabel(normalizedToolName, args);

    this.activeTools.push({ name: normalizedToolName, state, label });
    this.isThinking = false;

    log.debug("tool_start", { sessionId: this.sessionId, toolName: normalizedToolName, state, label });
  }

  onToolEnd(toolName: string): void {
    const normalizedToolName = this.normalizeToolName(toolName);
    const index = this.findLastToolIndex(normalizedToolName);
    if (index === -1) {
      return;
    }

    const [removed] = this.activeTools.splice(index, 1);
    const nextTool = this.getHighestPriorityTool();
    if (!nextTool || STATE_PRIORITY[removed.state] < STATE_PRIORITY[nextTool.state]) {
      this.holdState = removed.state;
      this.holdLabel = removed.label;
      this.holdUntil = this.now + TOOL_HOLD_MS;
    }

    log.debug("tool_end", { sessionId: this.sessionId, toolName: normalizedToolName });
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
      lastResponse: null,
      pendingPermission: null,
    };
  }

  getDiagnostics(): SessionStateDiagnostics {
    this.clearExpiredState();

    return {
      activeToolCount: this.activeTools.length,
      activeTools: this.activeTools.map((tool) => tool.name),
      hasError: this.errorLabel !== null,
      hasWaiting: this.waitingLabel !== null,
      isThinking: this.isThinking,
    };
  }

  private getHighestPriorityTool(): ActiveTool | null {
    let best: ActiveTool | null = null;

    for (const tool of this.activeTools) {
      if (!best || STATE_PRIORITY[tool.state] <= STATE_PRIORITY[best.state]) {
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

  private shouldUseHeldState(activeState: AvatarState): boolean {
    return this.holdState !== null && STATE_PRIORITY[this.holdState] < STATE_PRIORITY[activeState];
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
      case "read":
        return `Reading ${this.getStringArg(args, "path") ?? this.getStringArg(args, "filePath") ?? "file"}`;
      case "edit":
        return `Editing ${this.getStringArg(args, "filePath") ?? "file"}`;
      case "write":
        return `Writing ${this.getStringArg(args, "filePath") ?? "file"}`;
      case "grep":
        return `Searching ${this.getStringArg(args, "pattern") ?? ""}`.trimEnd();
      case "glob":
        return `Finding ${this.getStringArg(args, "pattern") ?? ""}`.trimEnd();
      case "bash": {
        const command = this.getStringArg(args, "command") ?? "command";
        return `Running ${command.slice(0, 40)}`;
      }
      default:
        return null;
    }
  }

  private normalizeToolName(toolName: string): string {
    return toolName.trim().toLowerCase();
  }

  private resolveToolState(toolName: string, normalizedToolName: string): AvatarState {
    switch (normalizedToolName) {
      case "read":
      case "grep":
      case "glob":
        return "reading";
      case "edit":
      case "write":
        return "editing";
      case "bash":
        return "running";
      case "task":
        return "thinking";
      default:
        return TOOL_STATE_MAP[normalizedToolName] ?? TOOL_STATE_MAP[toolName] ?? DEFAULT_TOOL_STATE;
    }
  }

  private getStringArg(args: Record<string, unknown>, key: string): string | null {
    const value = args[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
