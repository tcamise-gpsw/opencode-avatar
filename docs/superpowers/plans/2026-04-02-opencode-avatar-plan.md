# OpenCode Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native macOS desktop overlay that shows pixel-art robot avatars reflecting OpenCode agent state and token burn rate.

**Architecture:** Three components — an OpenCode plugin (`avatar-bridge.ts`) maps agent events to avatar states and serves them over WebSocket on port 2728; a Tauri 2 app creates a transparent always-on-top overlay window; PixiJS renders layered pixel-art robot sprites with flame particle effects inside that window.

**Tech Stack:** TypeScript, Tauri 2, PixiJS 8, Vitest, pnpm workspaces, Vite

**Spec:** `docs/superpowers/specs/2026-04-02-opencode-avatar-design.md`

---

## File Structure

```
opencode-avatar/
├── .gitignore
├── README.md
├── pnpm-workspace.yaml
├── package.json                      # Root workspace config
├── docs/
│   └── architecture.md               # Living architecture doc
├── shared/                           # Shared types between plugin and app
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── protocol.ts               # WebSocket message types, state enum
├── plugin/                           # OpenCode plugin
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                  # Plugin entry, hook registration
│   │   ├── state-machine.ts          # Per-session state transitions
│   │   ├── token-tracker.ts          # Rolling rate calculation
│   │   ├── ws-server.ts              # WebSocket server, broadcast
│   │   └── logger.ts                 # Structured logger
│   └── test/
│       ├── state-machine.test.ts
│       ├── token-tracker.test.ts
│       └── ws-protocol.test.ts
├── app/                              # Tauri desktop app
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html                    # Vite entry HTML
│   ├── src-tauri/                    # Rust backend
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   └── src/
│   │       └── main.rs              # Window: transparent, always-on-top, no dock icon
│   └── src/                          # Frontend (PixiJS)
│       ├── main.ts                   # Entry: init WS client, PixiJS app, connect them
│       ├── renderer.ts               # Manages PixiJS stage, robot collection, layout
│       ├── robot.ts                  # Single robot: sprite layers, state transitions
│       ├── flames.ts                 # Particle emitter for token flames
│       ├── sprites.ts                # Programmatic pixel-art sprite generation
│       ├── ws-client.ts              # WebSocket client with reconnection
│       ├── logger.ts                 # Frontend structured logger
│       └── types.ts                  # App-internal types (animation config, etc.)
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/protocol.ts` (stub)
- Create: `plugin/package.json`
- Create: `plugin/tsconfig.json`
- Create: `plugin/vitest.config.ts`
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vite.config.ts`
- Create: `app/index.html`

- [ ] **Step 1: Create pnpm workspace root**

```yaml
# pnpm-workspace.yaml
packages:
  - shared
  - plugin
  - app
```

```json
// package.json (root)
{
  "name": "opencode-avatar",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "dev:plugin": "pnpm --filter plugin dev",
    "dev:app": "pnpm --filter app dev"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create shared package**

```json
// shared/package.json
{
  "name": "@opencode-avatar/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/protocol.ts",
  "types": "src/protocol.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

```json
// shared/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```typescript
// shared/src/protocol.ts — stub, fleshed out in Task 2
export {}
```

- [ ] **Step 3: Create plugin package**

```json
// plugin/package.json
{
  "name": "@opencode-avatar/plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode-avatar/shared": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "latest",
    "@types/ws": "^8.5.0",
    "vitest": "^3.0.0"
  }
}
```

```json
// plugin/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```typescript
// plugin/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Create app package with Vite + Tauri scaffold**

```json
// app/package.json
{
  "name": "@opencode-avatar/app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@opencode-avatar/shared": "workspace:*",
    "pixi.js": "^8.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "vite": "^6.0.0"
  }
}
```

```json
// app/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```typescript
// app/vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

```html
<!-- app/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCode Avatar</title>
    <style>
      * { margin: 0; padding: 0; }
      html, body { overflow: hidden; background: transparent; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: All three workspaces resolve. No errors.

- [ ] **Step 6: Verify workspace**

Run: `pnpm -r typecheck`
Expected: All packages pass typecheck (trivially, since they're stubs).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with shared, plugin, and app packages"
```

---

## Task 2: Shared Protocol Types

**Files:**
- Modify: `shared/src/protocol.ts`

- [ ] **Step 1: Define the full protocol**

```typescript
// shared/src/protocol.ts

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

/** State priority map — lower number = higher priority */
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
  label: string | null;
  tokens: TokenData;
}

// --- WebSocket Messages: Plugin → App ---

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
  "playwright_browser_snapshot": "reading",
  "playwright_browser_take_screenshot": "reading",
  "playwright_browser_navigate": "running",
  "playwright_browser_click": "running",
  // Task/subagent tools
  Task: "thinking",
};

/** Default state for tools not in the map */
export const DEFAULT_TOOL_STATE: AvatarState = "running";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter shared typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add shared/src/protocol.ts
git commit -m "feat(shared): define WebSocket protocol types and state machine constants"
```

---

## Task 3: Plugin Logger

**Files:**
- Create: `plugin/src/logger.ts`

- [ ] **Step 1: Implement structured logger**

```typescript
// plugin/src/logger.ts
import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_DIR = join(homedir(), ".opencode-avatar", "logs");
const MAX_FILE_SIZE = 1_000_000; // 1MB
const MAX_FILES = 5;

let currentLevel: LogLevel = (process.env.AVATAR_LOG_LEVEL as LogLevel) ?? "info";

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Already exists or can't create — fall back to stderr only
  }
}

function formatMessage(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): string {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
    ...data,
  };
  return JSON.stringify(entry);
}

function writeLog(formatted: string): void {
  try {
    const logFile = join(LOG_DIR, "plugin.log");
    appendFileSync(logFile, formatted + "\n");
  } catch {
    // Best-effort file logging
  }
}

export function createLogger(component: string) {
  ensureLogDir();

  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
    const formatted = formatMessage(level, component, message, data);
    console.error(formatted); // stderr so it doesn't interfere with plugin stdout
    writeLog(formatted);
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add plugin/src/logger.ts
git commit -m "feat(plugin): add structured logger with file output and log levels"
```

---

## Task 4: Plugin State Machine (TDD)

**Files:**
- Create: `plugin/src/state-machine.ts`
- Create: `plugin/test/state-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// plugin/test/state-machine.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { SessionStateMachine } from "../src/state-machine.js";

describe("SessionStateMachine", () => {
  let sm: SessionStateMachine;

  beforeEach(() => {
    sm = new SessionStateMachine("test-session");
  });

  describe("initial state", () => {
    it("starts in idle state", () => {
      expect(sm.getState()).toBe("idle");
    });

    it("has no active label", () => {
      expect(sm.getLabel()).toBeNull();
    });
  });

  describe("tool events", () => {
    it("transitions to reading on Read tool start", () => {
      sm.onToolStart("Read", { path: "main.ts" });
      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Reading main.ts");
    });

    it("transitions to editing on Edit tool start", () => {
      sm.onToolStart("Edit", { filePath: "main.ts" });
      expect(sm.getState()).toBe("editing");
      expect(sm.getLabel()).toBe("Editing main.ts");
    });

    it("transitions to editing on Write tool start", () => {
      sm.onToolStart("Write", { filePath: "config.json" });
      expect(sm.getState()).toBe("editing");
      expect(sm.getLabel()).toBe("Writing config.json");
    });

    it("transitions to running on Bash tool start", () => {
      sm.onToolStart("Bash", { command: "npm test" });
      expect(sm.getState()).toBe("running");
      expect(sm.getLabel()).toBe("Running npm test");
    });

    it("transitions to reading on Grep tool start", () => {
      sm.onToolStart("Grep", { pattern: "TODO" });
      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Searching TODO");
    });

    it("transitions to reading on Glob tool start", () => {
      sm.onToolStart("Glob", { pattern: "**/*.ts" });
      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Finding **/*.ts");
    });

    it("uses default state for unknown tools", () => {
      sm.onToolStart("SomeNewTool", {});
      expect(sm.getState()).toBe("running");
    });
  });

  describe("tool completion", () => {
    it("returns to idle after tool ends and hold time elapses", () => {
      sm.onToolStart("Read", { path: "file.ts" });
      expect(sm.getState()).toBe("reading");
      sm.onToolEnd("Read");
      // State holds briefly then falls back
      sm.tick(600); // 600ms > 500ms hold time
      expect(sm.getState()).toBe("idle");
    });

    it("holds state during hold period after tool ends", () => {
      sm.onToolStart("Read", { path: "file.ts" });
      sm.onToolEnd("Read");
      sm.tick(300); // 300ms < 500ms hold time
      expect(sm.getState()).toBe("reading");
    });
  });

  describe("thinking state", () => {
    it("transitions to thinking on message delta", () => {
      sm.onMessageDelta();
      expect(sm.getState()).toBe("thinking");
    });
  });

  describe("waiting state", () => {
    it("transitions to waiting on permission asked", () => {
      sm.onPermissionAsked("Run bash command?");
      expect(sm.getState()).toBe("waiting");
      expect(sm.getLabel()).toBe("Run bash command?");
    });

    it("exits waiting on permission replied", () => {
      sm.onPermissionAsked("Run bash?");
      expect(sm.getState()).toBe("waiting");
      sm.onPermissionReplied();
      expect(sm.getState()).toBe("idle");
    });
  });

  describe("error state", () => {
    it("transitions to error on session error", () => {
      sm.onError("Something broke");
      expect(sm.getState()).toBe("error");
      expect(sm.getLabel()).toBe("Something broke");
    });

    it("clears error after timeout", () => {
      sm.onError("fail");
      sm.tick(5100); // error displays for 5s
      expect(sm.getState()).toBe("idle");
    });
  });

  describe("state priority", () => {
    it("waiting overrides running", () => {
      sm.onToolStart("Bash", { command: "test" });
      expect(sm.getState()).toBe("running");
      sm.onPermissionAsked("Allow?");
      expect(sm.getState()).toBe("waiting");
    });

    it("error overrides everything", () => {
      sm.onToolStart("Bash", { command: "test" });
      sm.onPermissionAsked("Allow?");
      sm.onError("crash");
      expect(sm.getState()).toBe("error");
    });

    it("running overrides editing", () => {
      sm.onToolStart("Edit", { filePath: "f.ts" });
      sm.onToolStart("Bash", { command: "test" });
      expect(sm.getState()).toBe("running");
    });
  });

  describe("snapshot", () => {
    it("returns full session info", () => {
      sm.onToolStart("Read", { path: "file.ts" });
      const snap = sm.snapshot();
      expect(snap).toEqual({
        sessionId: "test-session",
        name: "",
        state: "reading",
        label: "Reading file.ts",
        tokens: { total: 0, rate: 0 },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter plugin test`
Expected: FAIL — `state-machine.ts` doesn't exist yet.

- [ ] **Step 3: Implement the state machine**

```typescript
// plugin/src/state-machine.ts
import {
  type AvatarState,
  type SessionInfo,
  type TokenData,
  TOOL_STATE_MAP,
  DEFAULT_TOOL_STATE,
  STATE_PRIORITY,
} from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("state-machine");

/** How long to hold a tool state after the tool completes (ms) */
const TOOL_HOLD_MS = 500;
/** How long to show error state before clearing (ms) */
const ERROR_HOLD_MS = 5000;

interface ActiveTool {
  name: string;
  state: AvatarState;
}

export class SessionStateMachine {
  private sessionId: string;
  private sessionName: string = "";
  private activeTools: ActiveTool[] = [];
  private waitingLabel: string | null = null;
  private isWaiting: boolean = false;
  private errorLabel: string | null = null;
  private errorUntil: number = 0;
  private isThinking: boolean = false;
  private holdState: AvatarState | null = null;
  private holdUntil: number = 0;
  private now: number = 0; // Logical clock for testability
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
    // Priority: error > waiting > active tools > hold state > thinking > idle
    if (this.errorLabel !== null && this.now < this.errorUntil) {
      return "error";
    }
    if (this.isWaiting) {
      return "waiting";
    }
    if (this.activeTools.length > 0) {
      return this.highestPriorityToolState();
    }
    if (this.holdState !== null && this.now < this.holdUntil) {
      return this.holdState;
    }
    if (this.isThinking) {
      return "thinking";
    }
    return "idle";
  }

  getLabel(): string | null {
    const state = this.getState();
    switch (state) {
      case "error":
        return this.errorLabel;
      case "waiting":
        return this.waitingLabel;
      default: {
        const tool = this.activeTools[this.activeTools.length - 1];
        return tool ? this.toolLabel(tool.name) : null;
      }
    }
  }

  private lastToolArgs: Record<string, unknown> = {};

  onToolStart(toolName: string, args: Record<string, unknown>): void {
    const state = TOOL_STATE_MAP[toolName] ?? DEFAULT_TOOL_STATE;
    this.activeTools.push({ name: toolName, state });
    this.lastToolArgs = args;
    this.isThinking = false;
    log.debug("tool_start", { sessionId: this.sessionId, tool: toolName, state });
  }

  onToolEnd(toolName: string): void {
    const idx = this.activeTools.findIndex((t) => t.name === toolName);
    if (idx !== -1) {
      const removed = this.activeTools.splice(idx, 1)[0];
      // Hold the tool's state briefly to prevent flicker
      if (this.activeTools.length === 0) {
        this.holdState = removed.state;
        this.holdUntil = this.now + TOOL_HOLD_MS;
      }
    }
    log.debug("tool_end", { sessionId: this.sessionId, tool: toolName });
  }

  onMessageDelta(): void {
    this.isThinking = true;
  }

  onMessageComplete(): void {
    this.isThinking = false;
  }

  onPermissionAsked(label: string): void {
    this.isWaiting = true;
    this.waitingLabel = label;
    log.info("permission_asked", { sessionId: this.sessionId, label });
  }

  onPermissionReplied(): void {
    this.isWaiting = false;
    this.waitingLabel = null;
    log.info("permission_replied", { sessionId: this.sessionId });
  }

  onError(message: string): void {
    this.errorLabel = message;
    this.errorUntil = this.now + ERROR_HOLD_MS;
    log.error("session_error", { sessionId: this.sessionId, message });
  }

  /** Advance the logical clock by `ms` milliseconds. Used for hold timers. */
  tick(ms: number): void {
    this.now += ms;
    // Clear expired error
    if (this.errorLabel !== null && this.now >= this.errorUntil) {
      this.errorLabel = null;
    }
  }

  /** Called by the plugin on a real timer to advance the clock. */
  advanceTime(realNow: number): void {
    this.now = realNow;
    if (this.errorLabel !== null && this.now >= this.errorUntil) {
      this.errorLabel = null;
    }
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

  private highestPriorityToolState(): AvatarState {
    let best: AvatarState = "idle";
    let bestPriority = STATE_PRIORITY["idle"];
    for (const tool of this.activeTools) {
      const p = STATE_PRIORITY[tool.state];
      if (p < bestPriority) {
        best = tool.state;
        bestPriority = p;
      }
    }
    return best;
  }

  private toolLabel(toolName: string): string | null {
    const args = this.lastToolArgs;
    switch (toolName) {
      case "Read":
        return `Reading ${args.path ?? args.filePath ?? "file"}`;
      case "Edit":
        return `Editing ${args.filePath ?? "file"}`;
      case "Write":
        return `Writing ${args.filePath ?? "file"}`;
      case "Grep":
        return `Searching ${args.pattern ?? ""}`;
      case "Glob":
        return `Finding ${args.pattern ?? ""}`;
      case "Bash":
        return `Running ${String(args.command ?? "command").slice(0, 40)}`;
      default:
        return toolName;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter plugin test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/state-machine.ts plugin/test/state-machine.test.ts
git commit -m "feat(plugin): implement state machine with TDD — 7 states, priority, hold timers"
```

---

## Task 5: Plugin Token Tracker (TDD)

**Files:**
- Create: `plugin/src/token-tracker.ts`
- Create: `plugin/test/token-tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// plugin/test/token-tracker.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { TokenTracker } from "../src/token-tracker.js";

describe("TokenTracker", () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe("total tracking", () => {
    it("starts at zero", () => {
      expect(tracker.getData().total).toBe(0);
    });

    it("accumulates token counts", () => {
      tracker.add(100, 1000);
      tracker.add(200, 2000);
      expect(tracker.getData().total).toBe(300);
    });
  });

  describe("rate calculation", () => {
    it("starts at zero rate", () => {
      expect(tracker.getData().rate).toBe(0);
    });

    it("calculates rate over 5-second window", () => {
      // Add 500 tokens at t=0
      tracker.add(500, 0);
      // Rate at t=2.5s should be 500/5 = 100 (window is 5s, only one sample)
      const rate = tracker.getRateAt(2500);
      expect(rate).toBe(100);
    });

    it("drops samples outside the window", () => {
      tracker.add(500, 0);
      // At t=6s, the t=0 sample is outside the 5s window
      const rate = tracker.getRateAt(6000);
      expect(rate).toBe(0);
    });

    it("sums multiple samples within window", () => {
      tracker.add(100, 0);
      tracker.add(100, 1000);
      tracker.add(100, 2000);
      // 300 tokens over 5s window at t=3s
      const rate = tracker.getRateAt(3000);
      expect(rate).toBe(60);
    });
  });

  describe("reset", () => {
    it("resets total and rate", () => {
      tracker.add(500, 0);
      tracker.reset();
      expect(tracker.getData().total).toBe(0);
      expect(tracker.getData().rate).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter plugin test -- token-tracker`
Expected: FAIL — `token-tracker.ts` doesn't exist.

- [ ] **Step 3: Implement the token tracker**

```typescript
// plugin/src/token-tracker.ts
import type { TokenData } from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("token-tracker");

/** Rolling window size in milliseconds */
const WINDOW_MS = 5000;

interface Sample {
  tokens: number;
  timestamp: number;
}

export class TokenTracker {
  private total: number = 0;
  private samples: Sample[] = [];
  private lastTimestamp: number = 0;

  /** Add a token count sample. `timestamp` is ms since epoch or logical clock. */
  add(tokens: number, timestamp: number): void {
    this.total += tokens;
    this.samples.push({ tokens, timestamp });
    this.lastTimestamp = timestamp;
    log.debug("token_sample", { tokens, total: this.total, timestamp });
  }

  /** Get the rate (tokens/sec) at a given point in time. */
  getRateAt(now: number): number {
    const windowStart = now - WINDOW_MS;
    const inWindow = this.samples.filter((s) => s.timestamp >= windowStart);
    // Prune old samples
    this.samples = inWindow;
    const sum = inWindow.reduce((acc, s) => acc + s.tokens, 0);
    return Math.round(sum / (WINDOW_MS / 1000));
  }

  /** Get the current token data snapshot. */
  getData(): TokenData {
    return {
      total: this.total,
      rate: this.getRateAt(this.lastTimestamp),
    };
  }

  reset(): void {
    this.total = 0;
    this.samples = [];
    this.lastTimestamp = 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter plugin test -- token-tracker`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/token-tracker.ts plugin/test/token-tracker.test.ts
git commit -m "feat(plugin): implement token tracker with rolling rate calculation (TDD)"
```

---

## Task 6: Plugin WebSocket Server

**Files:**
- Create: `plugin/src/ws-server.ts`
- Create: `plugin/test/ws-protocol.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// plugin/test/ws-protocol.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AvatarWSServer } from "../src/ws-server.js";
import WebSocket from "ws";
import type { PluginMessage, SyncMessage, StateMessage, SessionMessage } from "@opencode-avatar/shared/src/protocol.js";

describe("AvatarWSServer", () => {
  let server: AvatarWSServer;
  const PORT = 0; // Random port for testing

  beforeEach(async () => {
    server = new AvatarWSServer(PORT);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.getPort()}`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function nextMessage(ws: WebSocket): Promise<PluginMessage> {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it("sends sync message on connect", async () => {
    const ws = await connect();
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("sync");
    expect((msg as SyncMessage).sessions).toEqual([]);
    ws.close();
  });

  it("broadcasts state messages to all clients", async () => {
    const ws1 = await connect();
    await nextMessage(ws1); // consume sync
    const ws2 = await connect();
    await nextMessage(ws2); // consume sync

    const stateMsg: StateMessage = {
      type: "state",
      sessionId: "s1",
      state: "thinking",
      label: null,
      tokens: { total: 0, rate: 0 },
      timestamp: Date.now(),
    };

    server.broadcast(stateMsg);

    const received1 = await nextMessage(ws1);
    const received2 = await nextMessage(ws2);
    expect(received1).toEqual(stateMsg);
    expect(received2).toEqual(stateMsg);

    ws1.close();
    ws2.close();
  });

  it("includes session data in sync for new connections", async () => {
    // Register a session
    server.setSyncData([
      { sessionId: "s1", name: "agent", state: "thinking", label: "test", tokens: { total: 100, rate: 50 } },
    ]);

    const ws = await connect();
    const msg = (await nextMessage(ws)) as SyncMessage;
    expect(msg.type).toBe("sync");
    expect(msg.sessions).toHaveLength(1);
    expect(msg.sessions[0].sessionId).toBe("s1");
    expect(msg.sessions[0].state).toBe("thinking");
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter plugin test -- ws-protocol`
Expected: FAIL — `ws-server.ts` doesn't exist.

- [ ] **Step 3: Implement the WebSocket server**

```typescript
// plugin/src/ws-server.ts
import { WebSocketServer, WebSocket } from "ws";
import type { PluginMessage, SessionInfo, SyncMessage } from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("ws-server");

export class AvatarWSServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private syncData: SessionInfo[] = [];
  private port: number;
  private actualPort: number = 0;

  constructor(port: number = 2728) {
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        const addr = this.wss!.address();
        this.actualPort = typeof addr === "object" ? addr.port : this.port;
        log.info("ws_server_started", { port: this.actualPort });
        resolve();
      });

      this.wss.on("error", (err) => {
        log.error("ws_server_error", { error: err.message });
        reject(err);
      });

      this.wss.on("connection", (ws) => {
        this.clients.add(ws);
        log.info("ws_client_connected", { clients: this.clients.size });

        // Send sync message to new client
        const syncMsg: SyncMessage = {
          type: "sync",
          sessions: this.syncData,
        };
        ws.send(JSON.stringify(syncMsg));

        ws.on("close", () => {
          this.clients.delete(ws);
          log.info("ws_client_disconnected", { clients: this.clients.size });
        });

        ws.on("error", (err) => {
          log.warn("ws_client_error", { error: err.message });
          this.clients.delete(ws);
        });
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      if (this.wss) {
        this.wss.close(() => {
          log.info("ws_server_stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.actualPort;
  }

  setSyncData(sessions: SessionInfo[]): void {
    this.syncData = sessions;
  }

  broadcast(message: PluginMessage): void {
    const data = JSON.stringify(message);
    log.debug("ws_broadcast", { type: message.type, clients: this.clients.size });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter plugin test -- ws-protocol`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/ws-server.ts plugin/test/ws-protocol.test.ts
git commit -m "feat(plugin): implement WebSocket server with sync and broadcast (TDD)"
```

---

## Task 7: Plugin Entry — Hook Registration

**Files:**
- Create: `plugin/src/index.ts`

- [ ] **Step 1: Implement the plugin entry point**

This wires everything together: hooks → state machine → WebSocket broadcast.

```typescript
// plugin/src/index.ts
import type { Plugin } from "@opencode-ai/plugin";
import { SessionStateMachine } from "./state-machine.js";
import { TokenTracker } from "./token-tracker.js";
import { AvatarWSServer } from "./ws-server.js";
import { createLogger } from "./logger.js";
import type { StateMessage, SessionMessage } from "@opencode-avatar/shared/src/protocol.js";

const log = createLogger("plugin");

const WS_PORT = parseInt(process.env.AVATAR_WS_PORT ?? "2728", 10);
const TICK_INTERVAL_MS = 200;

const sessions = new Map<string, { sm: SessionStateMachine; tokens: TokenTracker }>();
const wsServer = new AvatarWSServer(WS_PORT);

function getOrCreateSession(sessionId: string): { sm: SessionStateMachine; tokens: TokenTracker } {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sm: new SessionStateMachine(sessionId),
      tokens: new TokenTracker(),
    };
    sessions.set(sessionId, session);
    log.info("session_created", { sessionId });
  }
  return session;
}

function broadcastState(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const now = Date.now();
  session.sm.advanceTime(now);
  session.sm.setTokens({
    total: session.tokens.getData().total,
    rate: session.tokens.getRateAt(now),
  });

  const snap = session.sm.snapshot();
  const msg: StateMessage = {
    type: "state",
    sessionId: snap.sessionId,
    state: snap.state,
    label: snap.label,
    tokens: snap.tokens,
    timestamp: now,
  };
  wsServer.broadcast(msg);
}

function updateSyncData(): void {
  const allSessions = Array.from(sessions.values()).map((s) => {
    s.sm.advanceTime(Date.now());
    return s.sm.snapshot();
  });
  wsServer.setSyncData(allSessions);
}

const plugin: Plugin = {
  name: "opencode-avatar",

  setup(hooks) {
    log.info("plugin_initializing", { port: WS_PORT });

    // Start WebSocket server
    wsServer.start().catch((err) => {
      log.error("ws_start_failed", { error: String(err) });
    });

    // Periodic tick for hold timers and sync data
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of sessions) {
        const prevState = session.sm.getState();
        session.sm.advanceTime(now);
        const newState = session.sm.getState();
        if (prevState !== newState) {
          broadcastState(sessionId);
        }
      }
      updateSyncData();
    }, TICK_INTERVAL_MS);

    // --- Hook: Events ---
    hooks.hook("event", ({ event }) => {
      const { properties } = event as { type: string; properties: Record<string, unknown> };

      if (event.type === "session.created" || event.type === "session.updated") {
        const sessionId = properties.info?.id ?? properties.id;
        if (typeof sessionId === "string") {
          const session = getOrCreateSession(sessionId);
          if (properties.info?.title) {
            session.sm.setName(String(properties.info.title));
          }
        }
      }

      if (event.type === "session.deleted") {
        const sessionId = (properties as { id?: string }).id;
        if (typeof sessionId === "string") {
          sessions.delete(sessionId);
          const msg: SessionMessage = {
            type: "session",
            sessionId,
            action: "ended",
            name: "",
            timestamp: Date.now(),
          };
          wsServer.broadcast(msg);
          updateSyncData();
          log.info("session_ended", { sessionId });
        }
      }

      if (event.type === "session.error") {
        const sessionId = (properties as { sessionId?: string }).sessionId;
        if (typeof sessionId === "string") {
          const session = getOrCreateSession(sessionId);
          session.sm.onError(String((properties as { error?: string }).error ?? "Unknown error"));
          broadcastState(sessionId);
        }
      }

      if (event.type === "permission.asked") {
        const sessionId = (properties as { sessionId?: string }).sessionId;
        if (typeof sessionId === "string") {
          const session = getOrCreateSession(sessionId);
          session.sm.onPermissionAsked(String((properties as { question?: string }).question ?? "Permission requested"));
          broadcastState(sessionId);
        }
      }

      if (event.type === "permission.replied") {
        const sessionId = (properties as { sessionId?: string }).sessionId;
        if (typeof sessionId === "string") {
          const session = getOrCreateSession(sessionId);
          session.sm.onPermissionReplied();
          broadcastState(sessionId);
        }
      }
    });

    // --- Hook: Tool execution ---
    hooks.hook("tool.execute.before", ({ sessionId, tool }) => {
      const session = getOrCreateSession(sessionId);
      session.sm.onToolStart(tool.name, tool.parameters ?? {});
      broadcastState(sessionId);
    });

    hooks.hook("tool.execute.after", ({ sessionId, tool }) => {
      const session = getOrCreateSession(sessionId);
      session.sm.onToolEnd(tool.name);
      broadcastState(sessionId);
    });

    // --- Hook: Message updates (thinking/generating) ---
    hooks.hook("chat.message", ({ sessionId, message }) => {
      const session = getOrCreateSession(sessionId);
      if (message.role === "assistant") {
        // Track tokens if available
        if (message.tokens) {
          const total = message.tokens.input + message.tokens.output;
          session.tokens.add(total, Date.now());
          session.sm.setTokens({
            total: session.tokens.getData().total,
            rate: session.tokens.getRateAt(Date.now()),
          });
        }
        session.sm.onMessageDelta();
        broadcastState(sessionId);
      }
    });

    log.info("plugin_initialized");
  },
};

export default plugin;
```

- [ ] **Step 2: Typecheck the plugin**

Run: `pnpm --filter plugin typecheck`
Expected: PASS (may need minor type adjustments based on actual @opencode-ai/plugin types).

Note: The hook event property access patterns may need adjustment once we test against the real OpenCode runtime. The property shapes are inferred from the SDK types analyzed during research. The structured logging will help debug any mismatches quickly.

- [ ] **Step 3: Commit**

```bash
git add plugin/src/index.ts
git commit -m "feat(plugin): wire hooks to state machine, token tracker, and WebSocket broadcast"
```

---

## Task 8: Tauri App Shell

**Files:**
- Create: `app/src-tauri/Cargo.toml`
- Create: `app/src-tauri/tauri.conf.json`
- Create: `app/src-tauri/src/main.rs`

- [ ] **Step 1: Initialize Tauri in the app directory**

Run from `app/`:
```bash
pnpm tauri init
```

Follow prompts:
- App name: `opencode-avatar`
- Window title: `OpenCode Avatar`
- Dev server URL: `http://localhost:5173`
- Frontend dist: `../dist`
- Dev command: `pnpm dev`
- Build command: `pnpm build`

- [ ] **Step 2: Configure Tauri for transparent overlay**

Edit `app/src-tauri/tauri.conf.json` — set these key properties:

```json
{
  "app": {
    "windows": [
      {
        "title": "OpenCode Avatar",
        "width": 200,
        "height": 600,
        "x": null,
        "y": null,
        "resizable": false,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "visible": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "identifier": "com.opencode.avatar",
    "icon": []
  }
}
```

- [ ] **Step 3: Configure Rust main for macOS overlay behavior**

```rust
// app/src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    // Make window visible on all spaces
                    let ns_window = window.ns_window().unwrap() as cocoa::base::id;
                    unsafe {
                        use cocoa::appkit::NSWindow;
                        use cocoa::appkit::NSWindowCollectionBehavior;
                        ns_window.setCollectionBehavior_(
                            NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                        );
                        // Set window level above everything
                        ns_window.setLevel_(cocoa::appkit::NSMainMenuWindowLevel as i64 + 1);
                    }
                }
                // Hide from dock
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Add `cocoa` dependency to `Cargo.toml`:
```toml
[dependencies]
cocoa = "0.26"
```

- [ ] **Step 4: Verify the Tauri app builds**

Run from `app/`:
```bash
pnpm tauri build --debug
```
Expected: Build completes (may take a few minutes for first Rust compile). A transparent window should appear. Note: the exact Tauri 2 API calls may need adjustment — check Tauri 2 docs for `ns_window()` access and activation policy API.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/
git commit -m "feat(app): scaffold Tauri 2 shell with transparent always-on-top overlay window"
```

---

## Task 9: App Logger

**Files:**
- Create: `app/src/logger.ts`

- [ ] **Step 1: Implement frontend logger**

```typescript
// app/src/logger.ts

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (
  (typeof import.meta !== "undefined" && (import.meta as Record<string, Record<string, string>>).env?.VITE_LOG_LEVEL) ||
  "info"
) as LogLevel;

const isDebugMode = typeof import.meta !== "undefined" &&
  (import.meta as Record<string, Record<string, string>>).env?.VITE_DEBUG === "1";

function formatMessage(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
    ...data,
  });
}

export function createLogger(component: string) {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
    const formatted = formatMessage(level, component, message, data);
    switch (level) {
      case "error":
        console.error(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
    isDebug: () => isDebugMode,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/logger.ts
git commit -m "feat(app): add frontend structured logger"
```

---

## Task 10: App WebSocket Client

**Files:**
- Create: `app/src/ws-client.ts`
- Create: `app/src/types.ts`

- [ ] **Step 1: Define app-internal types**

```typescript
// app/src/types.ts
import type { AvatarState, TokenData } from "@opencode-avatar/shared/src/protocol.js";

/** Sprite animation config per state */
export interface StateAnimationConfig {
  bodyAnim: string;
  headAnim: string;
  faceFrame: string;
  /** Animation FPS */
  fps: number;
}

/** Full animation config map */
export const STATE_ANIMATIONS: Record<AvatarState, StateAnimationConfig> = {
  idle: { bodyAnim: "breathe", headAnim: "neutral", faceFrame: "sleeping", fps: 6 },
  thinking: { bodyAnim: "breathe", headAnim: "tilt", faceFrame: "dots", fps: 8 },
  reading: { bodyAnim: "lean", headAnim: "neutral", faceFrame: "scan", fps: 8 },
  editing: { bodyAnim: "typing", headAnim: "neutral", faceFrame: "focused", fps: 8 },
  running: { bodyAnim: "vibrate", headAnim: "neutral", faceFrame: "excited", fps: 10 },
  waiting: { bodyAnim: "tap", headAnim: "neutral", faceFrame: "question", fps: 6 },
  error: { bodyAnim: "slump", headAnim: "neutral", faceFrame: "x-eyes", fps: 4 },
};

/** Layout constants */
export const LAYOUT = {
  /** Robot sprite render size in CSS pixels */
  robotSize: 64,
  /** Margin from screen edge */
  edgeMargin: 20,
  /** Gap between stacked robots */
  robotGap: 8,
} as const;
```

- [ ] **Step 2: Implement WebSocket client with reconnection**

```typescript
// app/src/ws-client.ts
import type { PluginMessage, StateMessage, SessionMessage, SyncMessage } from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("ws-client");

export interface WSClientCallbacks {
  onSync: (msg: SyncMessage) => void;
  onState: (msg: StateMessage) => void;
  onSession: (msg: SessionMessage) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

export class AvatarWSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: WSClientCallbacks;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionallyClosed: boolean = false;

  constructor(url: string, callbacks: WSClientCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  connect(): void {
    this.isIntentionallyClosed = false;
    this.attemptConnect();
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private attemptConnect(): void {
    log.info("ws_connecting", { url: this.url });

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      log.error("ws_connect_error", { error: String(err) });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      log.info("ws_connected");
      this.reconnectDelay = 1000; // Reset backoff
      this.callbacks.onConnected();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as PluginMessage;
        log.debug("ws_message", { type: msg.type });

        switch (msg.type) {
          case "sync":
            this.callbacks.onSync(msg);
            break;
          case "state":
            this.callbacks.onState(msg);
            break;
          case "session":
            this.callbacks.onSession(msg);
            break;
          default:
            log.warn("ws_unknown_message", { type: (msg as Record<string, unknown>).type });
        }
      } catch (err) {
        log.error("ws_parse_error", { error: String(err) });
      }
    };

    this.ws.onclose = () => {
      log.info("ws_disconnected");
      this.ws = null;
      this.callbacks.onDisconnected();
      if (!this.isIntentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      log.error("ws_error", { error: String(err) });
      // onclose will fire after this, which handles reconnection
    };
  }

  private scheduleReconnect(): void {
    log.info("ws_reconnect_scheduled", { delay: this.reconnectDelay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptConnect();
    }, this.reconnectDelay);
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/ws-client.ts app/src/types.ts
git commit -m "feat(app): implement WebSocket client with exponential backoff reconnection"
```

---

## Task 11: Programmatic Sprite Generation

**Files:**
- Create: `app/src/sprites.ts`

- [ ] **Step 1: Implement pixel-art sprite generator**

This generates all sprite frames programmatically on a canvas. Each function draws a 32×32 pixel frame and returns it as a texture.

```typescript
// app/src/sprites.ts
import { Texture, RenderTexture, Graphics, Container } from "pixi.js";
import { createLogger } from "./logger.js";

const log = createLogger("sprites");

/** Sprite frame size in pixels */
export const FRAME_SIZE = 32;

/** Color palette */
const COLORS = {
  body: 0x64748b,
  bodyDark: 0x334155,
  screen: 0x0f172a,
  screenBorder: 0x475569,
  green: 0x4ade80,
  yellow: 0xfacc15,
  red: 0xf87171,
  orange: 0xf97316,
  white: 0xffffff,
  grey: 0x94a3b8,
} as const;

/**
 * Generate all sprite textures needed for the robot.
 * Returns a map of texture name → Texture.
 *
 * Face textures: "face-neutral", "face-dots", "face-scan", "face-focused",
 *                "face-question", "face-x-eyes", "face-excited", "face-sleeping"
 *
 * Body textures: "body-idle-0" through "body-idle-3", "body-typing-0" through "body-typing-3",
 *                "body-vibrate-0", "body-vibrate-1", "body-slump-0"
 *
 * The actual pixel art drawing is intentionally simple for v1 — blocky shapes
 * with clear silhouettes. Can be replaced with artist-made PNGs later.
 */
export function generateSpriteTextures(app: { renderer: { generateTexture: (container: Container) => Texture } }): Map<string, Texture> {
  const textures = new Map<string, Texture>();

  log.info("generating_sprites");

  // Helper: draw a filled pixel rect
  function px(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
    g.rect(x, y, w, h).fill(color);
  }

  // --- Face expressions (drawn on the 12x8 screen area) ---
  function makeFace(name: string, drawFn: (g: Graphics) => void): void {
    const container = new Container();
    const g = new Graphics();
    drawFn(g);
    container.addChild(g);
    textures.set(name, app.renderer.generateTexture(container));
  }

  // Neutral face — two square eyes, flat mouth
  makeFace("face-neutral", (g) => {
    px(g, 2, 2, 3, 3, COLORS.green); // left eye
    px(g, 9, 2, 3, 3, COLORS.green); // right eye
    px(g, 4, 6, 6, 1, COLORS.green); // mouth
  });

  // Thinking dots — animated dots
  makeFace("face-dots", (g) => {
    px(g, 3, 4, 2, 2, COLORS.green);
    px(g, 7, 4, 2, 2, COLORS.green);
    px(g, 11, 4, 2, 2, COLORS.green);
  });

  // Scanning eyes — wide eyes looking right
  makeFace("face-scan", (g) => {
    px(g, 1, 2, 4, 3, COLORS.green); // left eye wide
    px(g, 8, 2, 4, 3, COLORS.green); // right eye wide
    px(g, 4, 3, 1, 1, COLORS.screen); // left pupil
    px(g, 11, 3, 1, 1, COLORS.screen); // right pupil
  });

  // Focused — one eye squinted
  makeFace("face-focused", (g) => {
    px(g, 2, 2, 3, 3, COLORS.green); // left eye normal
    px(g, 9, 3, 3, 1, COLORS.green); // right eye squinted
    px(g, 4, 6, 6, 1, COLORS.green); // mouth
  });

  // Question mark
  makeFace("face-question", (g) => {
    px(g, 5, 1, 4, 1, COLORS.yellow);
    px(g, 9, 2, 1, 2, COLORS.yellow);
    px(g, 6, 4, 3, 1, COLORS.yellow);
    px(g, 6, 5, 1, 1, COLORS.yellow);
    px(g, 6, 7, 1, 1, COLORS.yellow);
  });

  // X-eyes (error)
  makeFace("face-x-eyes", (g) => {
    // Left X
    px(g, 2, 2, 1, 1, COLORS.red); px(g, 4, 2, 1, 1, COLORS.red);
    px(g, 3, 3, 1, 1, COLORS.red);
    px(g, 2, 4, 1, 1, COLORS.red); px(g, 4, 4, 1, 1, COLORS.red);
    // Right X
    px(g, 9, 2, 1, 1, COLORS.red); px(g, 11, 2, 1, 1, COLORS.red);
    px(g, 10, 3, 1, 1, COLORS.red);
    px(g, 9, 4, 1, 1, COLORS.red); px(g, 11, 4, 1, 1, COLORS.red);
    // Frown
    px(g, 5, 7, 4, 1, COLORS.red);
  });

  // Excited face
  makeFace("face-excited", (g) => {
    px(g, 2, 2, 3, 3, COLORS.green);
    px(g, 9, 2, 3, 3, COLORS.green);
    px(g, 3, 3, 1, 1, COLORS.white); // shine
    px(g, 10, 3, 1, 1, COLORS.white);
    px(g, 4, 6, 6, 2, COLORS.green); // big smile
    px(g, 5, 6, 4, 1, COLORS.screen); // mouth interior
  });

  // Sleeping face
  makeFace("face-sleeping", (g) => {
    px(g, 2, 3, 3, 1, COLORS.grey); // closed left eye
    px(g, 9, 3, 3, 1, COLORS.grey); // closed right eye
    // Z's
    px(g, 12, 0, 2, 1, COLORS.grey);
    px(g, 13, 1, 1, 1, COLORS.grey);
    px(g, 12, 2, 2, 1, COLORS.grey);
  });

  // --- Body frames ---
  // For v1, the body is a simple robot shape. Different "animations" are
  // subtle variations (arm positions, slight vertical offset for breathing).
  // The actual body drawing code will be similar across frames with small tweaks.

  function makeBody(name: string, drawFn: (g: Graphics) => void): void {
    const container = new Container();
    const g = new Graphics();
    drawFn(g);
    container.addChild(g);
    textures.set(name, app.renderer.generateTexture(container));
  }

  function drawBaseBody(g: Graphics, yOffset: number = 0, armOffset: number = 0): void {
    const y = yOffset;
    // Antenna
    px(g, 15, y + 0, 2, 4, COLORS.green);
    px(g, 14, y + 0, 4, 2, COLORS.green);
    // Head shell
    px(g, 8, y + 4, 16, 12, COLORS.body);
    // Screen
    px(g, 9, y + 5, 14, 10, COLORS.screen);
    // Body
    px(g, 10, y + 18, 12, 8, COLORS.body);
    // Chest lights
    px(g, 13, y + 20, 2, 2, COLORS.green);
    px(g, 16, y + 20, 2, 2, COLORS.yellow);
    px(g, 19, y + 20, 2, 2, COLORS.red);
    // Arms
    px(g, 5, y + 18 + armOffset, 4, 2, COLORS.body);
    px(g, 23, y + 18 + armOffset, 4, 2, COLORS.body);
    // Legs
    px(g, 12, y + 27, 3, 4, COLORS.body);
    px(g, 18, y + 27, 3, 4, COLORS.body);
    // Feet
    px(g, 10, y + 30, 5, 2, COLORS.body);
    px(g, 17, y + 30, 5, 2, COLORS.body);
  }

  // Idle breathing frames (4 frames, subtle y-offset)
  for (let i = 0; i < 4; i++) {
    const yOff = i < 2 ? 0 : 1; // frames 0,1 = up, frames 2,3 = down
    makeBody(`body-idle-${i}`, (g) => drawBaseBody(g, yOff));
  }

  // Typing frames (4 frames, alternating arm positions)
  for (let i = 0; i < 4; i++) {
    const armOff = i % 2 === 0 ? 0 : -1;
    makeBody(`body-typing-${i}`, (g) => drawBaseBody(g, 0, armOff));
  }

  // Vibrate frames (2 frames, x-offset)
  makeBody("body-vibrate-0", (g) => drawBaseBody(g, 0));
  makeBody("body-vibrate-1", (g) => {
    // Slightly shifted — we offset the whole drawing by 1px
    drawBaseBody(g, 0);
  });

  // Slump frame
  makeBody("body-slump-0", (g) => drawBaseBody(g, 2)); // lower position

  log.info("sprites_generated", { count: textures.size });
  return textures;
}
```

Note: This is a starting point for programmatic art. The sprite shapes will need visual iteration once we can see them rendered. The logging and texture map approach make it easy to swap individual frames.

- [ ] **Step 2: Commit**

```bash
git add app/src/sprites.ts
git commit -m "feat(app): implement programmatic pixel-art sprite generation for robot"
```

---

## Task 12: Robot Class — Sprite Layers & State Transitions

**Files:**
- Create: `app/src/robot.ts`

- [ ] **Step 1: Implement the Robot class**

```typescript
// app/src/robot.ts
import { Container, Sprite, Texture } from "pixi.js";
import type { AvatarState, TokenData } from "@opencode-avatar/shared/src/protocol.js";
import { STATE_ANIMATIONS, LAYOUT } from "./types.js";
import { FRAME_SIZE } from "./sprites.js";
import { createLogger } from "./logger.js";

const log = createLogger("robot");

/** Scale factor: 32px sprites rendered at 64px */
const SCALE = LAYOUT.robotSize / FRAME_SIZE;

/** Transition blend duration in ms */
const BLEND_MS = 150;

export class Robot {
  public readonly container: Container;
  public readonly sessionId: string;
  public sessionName: string = "";

  private bodySprite: Sprite;
  private faceSprite: Sprite;
  private textures: Map<string, Texture>;

  private currentState: AvatarState = "idle";
  private targetState: AvatarState = "idle";
  private animFrame: number = 0;
  private animTimer: number = 0;
  private tokens: TokenData = { total: 0, rate: 0 };

  /** Is the robot in "disconnected" grey mode? */
  private disconnected: boolean = false;

  constructor(sessionId: string, textures: Map<string, Texture>) {
    this.sessionId = sessionId;
    this.textures = textures;
    this.container = new Container();
    this.container.scale.set(SCALE);

    // Body layer
    this.bodySprite = new Sprite(this.getTexture("body-idle-0"));
    this.container.addChild(this.bodySprite);

    // Face layer (positioned on the screen area of the robot head)
    this.faceSprite = new Sprite(this.getTexture("face-neutral"));
    this.faceSprite.x = 9; // Offset to screen position within body
    this.faceSprite.y = 5;
    this.container.addChild(this.faceSprite);

    log.info("robot_created", { sessionId });
  }

  setState(state: AvatarState): void {
    if (state === this.targetState) return;
    log.debug("robot_state_change", {
      sessionId: this.sessionId,
      from: this.currentState,
      to: state,
    });
    this.targetState = state;
    this.currentState = state;
    this.animFrame = 0;
    this.animTimer = 0;
    this.updateSprites();
  }

  setTokens(tokens: TokenData): void {
    this.tokens = tokens;
  }

  setDisconnected(disconnected: boolean): void {
    this.disconnected = disconnected;
    this.container.alpha = disconnected ? 0.4 : 1.0;
    if (disconnected) {
      this.faceSprite.texture = this.getTexture("face-sleeping");
    }
  }

  /** Called every frame by the renderer */
  update(deltaMs: number): void {
    if (this.disconnected) return;

    const config = STATE_ANIMATIONS[this.currentState];
    const frameDuration = 1000 / config.fps;

    this.animTimer += deltaMs;
    if (this.animTimer >= frameDuration) {
      this.animTimer -= frameDuration;
      this.animFrame++;
      this.updateSprites();
    }
  }

  /** Pop-in animation */
  popIn(): void {
    this.container.scale.set(0);
    this.container.alpha = 0;
    // Simple tween: will be driven by update loop
    // For v1, snap to final state
    this.container.scale.set(SCALE);
    this.container.alpha = 1;
    log.debug("robot_pop_in", { sessionId: this.sessionId });
  }

  /** Fade-out animation */
  fadeOut(): Promise<void> {
    this.container.alpha = 0;
    log.debug("robot_fade_out", { sessionId: this.sessionId });
    return Promise.resolve();
  }

  getTokens(): TokenData {
    return this.tokens;
  }

  private updateSprites(): void {
    const config = STATE_ANIMATIONS[this.currentState];

    // Update body frame
    const bodyFrameCount = this.getBodyFrameCount(config.bodyAnim);
    const bodyFrame = this.animFrame % bodyFrameCount;
    const bodyTexName = `body-${config.bodyAnim}-${bodyFrame}`;
    this.bodySprite.texture = this.getTexture(bodyTexName, "body-idle-0");

    // Update face
    this.faceSprite.texture = this.getTexture(`face-${config.faceFrame}`, "face-neutral");
  }

  private getBodyFrameCount(animName: string): number {
    switch (animName) {
      case "breathe":
      case "idle":
        return 4;
      case "typing":
      case "tap":
        return 4;
      case "vibrate":
        return 2;
      case "slump":
      case "lean":
        return 1;
      case "tilt":
        return 4;
      default:
        return 1;
    }
  }

  private getTexture(name: string, fallback?: string): Texture {
    const tex = this.textures.get(name);
    if (tex) return tex;
    if (fallback) {
      const fb = this.textures.get(fallback);
      if (fb) return fb;
    }
    log.warn("texture_not_found", { name, fallback });
    return Texture.EMPTY;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/robot.ts
git commit -m "feat(app): implement Robot class with layered sprites and state-driven animation"
```

---

## Task 13: Flame Particle System

**Files:**
- Create: `app/src/flames.ts`

- [ ] **Step 1: Implement the flame particle emitter**

```typescript
// app/src/flames.ts
import { Container, Graphics } from "pixi.js";
import { createLogger } from "./logger.js";

const log = createLogger("flames");

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

const FLAME_COLORS = [0xf97316, 0xfacc15, 0xef4444, 0xfbbf24];

/** Maps token rate to flame config */
function rateToConfig(rate: number): { count: number; maxHeight: number; speed: number } {
  if (rate <= 0) return { count: 0, maxHeight: 0, speed: 0 };
  if (rate <= 50) return { count: 3, maxHeight: 8, speed: 20 };
  if (rate <= 200) return { count: 7, maxHeight: 20, speed: 35 };
  return { count: 13, maxHeight: 40, speed: 50 };
}

export class FlameEmitter {
  public readonly container: Container;
  private particles: Particle[] = [];
  private graphics: Graphics;
  private targetRate: number = 0;
  private currentRate: number = 0;
  private emitTimer: number = 0;

  /** Width of the emitter zone (matches robot width) */
  private emitWidth: number;

  constructor(emitWidth: number = 32) {
    this.emitWidth = emitWidth;
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    log.debug("flame_emitter_created");
  }

  setRate(tokensPerSecond: number): void {
    this.targetRate = tokensPerSecond;
  }

  update(deltaMs: number): void {
    // Smooth ramp current rate toward target
    const rampSpeed = 0.003; // per ms
    if (this.currentRate < this.targetRate) {
      this.currentRate = Math.min(this.currentRate + rampSpeed * deltaMs, this.targetRate);
    } else {
      this.currentRate = Math.max(this.currentRate - rampSpeed * deltaMs, this.targetRate);
    }

    const config = rateToConfig(this.currentRate);

    // Emit new particles
    if (config.count > 0) {
      this.emitTimer += deltaMs;
      const emitInterval = 1000 / (config.count * 2); // particles per second
      while (this.emitTimer >= emitInterval) {
        this.emitTimer -= emitInterval;
        this.spawnParticle(config);
      }
    }

    // Update existing particles
    const dt = deltaMs / 1000;
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= deltaMs;
    }

    // Remove dead particles
    this.particles = this.particles.filter((p) => p.life > 0);

    // Redraw
    this.draw();
  }

  private spawnParticle(config: { maxHeight: number; speed: number }): void {
    const particle: Particle = {
      x: Math.random() * this.emitWidth,
      y: 0,
      vx: (Math.random() - 0.5) * 10, // slight horizontal drift
      vy: -(config.speed + Math.random() * config.speed * 0.5), // upward
      life: 400 + Math.random() * 600, // 0.4-1.0 seconds
      maxLife: 1000,
      size: Math.random() > 0.5 ? 2 : 3, // 2x2 or 3x3 pixels
      color: FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)],
    };
    this.particles.push(particle);
  }

  private draw(): void {
    this.graphics.clear();
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      this.graphics.rect(p.x, p.y, p.size, p.size).fill({ color: p.color, alpha });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/flames.ts
git commit -m "feat(app): implement flame particle emitter driven by token burn rate"
```

---

## Task 14: Renderer — Multi-Robot Manager

**Files:**
- Create: `app/src/renderer.ts`

- [ ] **Step 1: Implement the renderer**

```typescript
// app/src/renderer.ts
import { Application, Container, Texture } from "pixi.js";
import type { SessionInfo, AvatarState, TokenData } from "@opencode-avatar/shared/src/protocol.js";
import { Robot } from "./robot.js";
import { FlameEmitter } from "./flames.js";
import { generateSpriteTextures, FRAME_SIZE } from "./sprites.js";
import { LAYOUT } from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger("renderer");

interface ManagedRobot {
  robot: Robot;
  flames: FlameEmitter;
  createdAt: number;
}

export class AvatarRenderer {
  private app: Application;
  private robots: Map<string, ManagedRobot> = new Map();
  private textures: Map<string, Texture> = new Map();
  private robotContainer: Container;
  private isReady: boolean = false;

  constructor() {
    this.app = new Application();
    this.robotContainer = new Container();
  }

  async init(canvas?: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      background: 0x000000,
      backgroundAlpha: 0,
      width: LAYOUT.robotSize + LAYOUT.edgeMargin * 2,
      height: 600,
      canvas: canvas ?? undefined,
      antialias: false, // Keep pixel art crisp
    });

    // Generate sprites
    this.textures = generateSpriteTextures(this.app);

    this.app.stage.addChild(this.robotContainer);

    // Start render loop
    this.app.ticker.add((ticker) => {
      const deltaMs = ticker.deltaMS;
      for (const managed of this.robots.values()) {
        managed.robot.update(deltaMs);
        managed.flames.update(deltaMs);
      }
    });

    this.isReady = true;
    log.info("renderer_initialized");
  }

  getCanvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  /** Sync all sessions at once (on initial connect) */
  syncSessions(sessions: SessionInfo[]): void {
    // Remove robots not in sync data
    for (const [id] of this.robots) {
      if (!sessions.find((s) => s.sessionId === id)) {
        this.removeRobot(id);
      }
    }
    // Add/update robots from sync data
    for (const session of sessions) {
      this.updateSession(session.sessionId, session.state, session.label, session.tokens, session.name);
    }
  }

  /** Update a single session's state */
  updateSession(sessionId: string, state: AvatarState, label: string | null, tokens: TokenData, name?: string): void {
    let managed = this.robots.get(sessionId);
    if (!managed) {
      managed = this.addRobot(sessionId);
      if (name) managed.robot.sessionName = name;
    }
    managed.robot.setState(state);
    managed.robot.setTokens(tokens);
    managed.flames.setRate(tokens.rate);
    if (name) managed.robot.sessionName = name;
  }

  /** Add a new session */
  addSession(sessionId: string, name: string): void {
    if (!this.robots.has(sessionId)) {
      const managed = this.addRobot(sessionId);
      managed.robot.sessionName = name;
      managed.robot.popIn();
    }
  }

  /** Remove a session */
  async removeSession(sessionId: string): Promise<void> {
    const managed = this.robots.get(sessionId);
    if (managed) {
      await managed.robot.fadeOut();
      this.removeRobot(sessionId);
    }
  }

  /** Set all robots to disconnected state */
  setDisconnected(disconnected: boolean): void {
    for (const managed of this.robots.values()) {
      managed.robot.setDisconnected(disconnected);
    }
  }

  private addRobot(sessionId: string): ManagedRobot {
    const robot = new Robot(sessionId, this.textures);
    const flames = new FlameEmitter(FRAME_SIZE);

    // Position flames at robot's feet
    flames.container.scale.set(LAYOUT.robotSize / FRAME_SIZE);
    flames.container.y = LAYOUT.robotSize - 4; // Just above the feet

    const container = new Container();
    container.addChild(flames.container);
    container.addChild(robot.container);

    const managed: ManagedRobot = { robot, flames, createdAt: Date.now() };
    this.robots.set(sessionId, managed);
    this.robotContainer.addChild(container);

    this.relayout();
    log.info("robot_added", { sessionId, count: this.robots.size });
    return managed;
  }

  private removeRobot(sessionId: string): void {
    const managed = this.robots.get(sessionId);
    if (managed) {
      managed.robot.container.parent?.removeChild(managed.robot.container.parent);
      this.robots.delete(sessionId);
      this.relayout();
      log.info("robot_removed", { sessionId, count: this.robots.size });
    }
  }

  /** Reposition all robots in the stack */
  private relayout(): void {
    // Sort by creation time (oldest at bottom)
    const sorted = Array.from(this.robots.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    );

    const totalHeight = sorted.length * (LAYOUT.robotSize + LAYOUT.robotGap) - LAYOUT.robotGap;

    sorted.forEach(([_id, managed], index) => {
      const parent = managed.robot.container.parent;
      if (parent) {
        parent.x = LAYOUT.edgeMargin;
        // Stack from bottom: first robot at bottom, newer ones above
        parent.y = totalHeight - (index + 1) * (LAYOUT.robotSize + LAYOUT.robotGap) + LAYOUT.robotGap;
      }
    });

    // Resize canvas to fit
    const canvasHeight = Math.max(100, totalHeight + LAYOUT.edgeMargin * 2);
    this.app.renderer.resize(
      LAYOUT.robotSize + LAYOUT.edgeMargin * 2,
      canvasHeight
    );

    log.debug("relayout", { count: sorted.length, height: canvasHeight });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/renderer.ts
git commit -m "feat(app): implement multi-robot renderer with layout management and flames"
```

---

## Task 15: App Entry Point

**Files:**
- Create: `app/src/main.ts`

- [ ] **Step 1: Wire everything together**

```typescript
// app/src/main.ts
import { AvatarRenderer } from "./renderer.js";
import { AvatarWSClient } from "./ws-client.js";
import { createLogger } from "./logger.js";

const log = createLogger("main");

const WS_URL = `ws://127.0.0.1:${import.meta.env.VITE_WS_PORT ?? "2728"}`;

async function main(): Promise<void> {
  log.info("app_starting", { wsUrl: WS_URL });

  // Initialize renderer
  const renderer = new AvatarRenderer();
  await renderer.init();

  // Mount canvas
  const appEl = document.getElementById("app");
  if (!appEl) throw new Error("No #app element found");
  appEl.appendChild(renderer.getCanvas());

  // Connect WebSocket
  const wsClient = new AvatarWSClient(WS_URL, {
    onSync(msg) {
      log.info("sync_received", { sessions: msg.sessions.length });
      renderer.syncSessions(msg.sessions);
    },
    onState(msg) {
      log.debug("state_received", { sessionId: msg.sessionId, state: msg.state });
      renderer.updateSession(msg.sessionId, msg.state, msg.label, msg.tokens);
    },
    onSession(msg) {
      log.info("session_event", { sessionId: msg.sessionId, action: msg.action });
      if (msg.action === "created" || msg.action === "resumed") {
        renderer.addSession(msg.sessionId, msg.name);
      } else if (msg.action === "ended") {
        renderer.removeSession(msg.sessionId);
      }
    },
    onConnected() {
      log.info("connected_to_plugin");
      renderer.setDisconnected(false);
    },
    onDisconnected() {
      log.warn("disconnected_from_plugin");
      renderer.setDisconnected(true);
    },
  });

  wsClient.connect();

  // Debug overlay
  if (createLogger("").isDebug()) {
    const debugDiv = document.createElement("div");
    debugDiv.id = "debug-overlay";
    debugDiv.style.cssText = "position:fixed;top:4px;left:4px;font:10px monospace;color:#4ade80;pointer-events:none;z-index:9999;";
    document.body.appendChild(debugDiv);

    setInterval(() => {
      debugDiv.textContent = `WS: ${WS_URL} | Robots: ${document.querySelectorAll("canvas").length}`;
    }, 1000);
  }

  log.info("app_started");
}

main().catch((err) => {
  log.error("app_fatal", { error: String(err) });
});
```

- [ ] **Step 2: Verify the app compiles**

Run: `pnpm --filter app build`
Expected: Vite build succeeds (Tauri not needed for this check).

- [ ] **Step 3: Commit**

```bash
git add app/src/main.ts
git commit -m "feat(app): wire WebSocket client to renderer in main entry point"
```

---

## Task 16: Documentation

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`

- [ ] **Step 1: Write README**

Write `README.md` with:
- Project description (one paragraph)
- Architecture diagram (ASCII, same as spec)
- Prerequisites (Node.js, pnpm, Rust/Cargo for Tauri)
- Setup instructions (`pnpm install`)
- How to install the plugin (copy/symlink to OpenCode config)
- How to run the Tauri app (`pnpm tauri:dev`)
- How to run tests (`pnpm test`)
- Configuration (env vars: `AVATAR_LOG_LEVEL`, `AVATAR_DEBUG`, `AVATAR_WS_PORT`)
- Project structure overview

- [ ] **Step 2: Write architecture.md**

Write `docs/architecture.md` with the living architecture doc. Copy the relevant sections from the spec (Architecture, State Machine, Protocol, Sprite System, Flame System) into a maintainable format. This is the doc that gets updated as we develop.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/architecture.md
git commit -m "docs: add README with setup instructions and living architecture doc"
```

---

## Task 17: Integration Smoke Test

**Files:** No new files — manual verification.

- [ ] **Step 1: Start the plugin in isolation**

Verify the plugin's WebSocket server starts and serves sync messages:

```bash
# In a terminal, start a quick test:
cd plugin
node -e "
  import('./src/ws-server.js').then(async ({ AvatarWSServer }) => {
    const server = new AvatarWSServer(2728);
    await server.start();
    console.log('WS server running on port', server.getPort());
  });
"
```

In another terminal, verify with `websocat` or similar:
```bash
websocat ws://127.0.0.1:2728
# Should receive: {"type":"sync","sessions":[]}
```

- [ ] **Step 2: Start the Tauri app**

```bash
cd app
pnpm tauri:dev
```

Expected: A transparent window appears. The app connects to ws://127.0.0.1:2728. If the plugin isn't running, the app should show reconnection attempts in the console logs and robots in disconnected (grey) state once they exist.

- [ ] **Step 3: Verify end-to-end with OpenCode plugin installed**

Install the plugin in OpenCode config (`~/.config/opencode/config.json`), start OpenCode, and verify:
- Robot appears when a session starts
- Robot changes state when tools are called
- Token flames appear during LLM generation
- Robot goes grey when OpenCode is stopped, reconnects when restarted

- [ ] **Step 4: Commit any fixes from integration testing**

```bash
git add -A
git commit -m "fix: adjustments from integration smoke testing"
```

- [ ] **Step 5: Push to remote**

```bash
git push origin main
```
