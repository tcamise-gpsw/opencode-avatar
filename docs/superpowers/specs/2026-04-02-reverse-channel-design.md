# Reverse Communication Channel — Design Spec

**Date**: 2026-04-02
**Status**: Draft
**Branch**: `feature/opencode-avatar-overlay`

## Overview

Add a reverse communication channel to the OpenCode Avatar overlay, enabling the Tauri/PixiJS app to send commands back to OpenCode sessions via the plugin. This extends the existing one-way plugin→app WebSocket protocol to be bidirectional.

### v1 Features

1. **Last response preview** — Hover tooltip shows last ~2 lines of assistant response text
2. **Permission approve/deny** — Waiting robots show a popup with Allow/Deny buttons
3. **Free-text prompt input** — Click a robot to open a text input, type and send a message to the session

### Cross-cutting Requirements

These apply to every implementation step:

- **Documentation**: Update `README.md` and `docs/architecture.md` with new protocol messages, command flow, and cross-process routing. Each new module gets a JSDoc header explaining its purpose.
- **Unit tests**: Every new module and every extended module gets tests. Follow existing Vitest patterns. Target: all new logic paths covered.
- **Logging**: Every command received, routed, executed, and result-returned is logged. All error paths log at `warn` or `error` level. Logging must be sufficient for an agent to debug issues by reading `~/.opencode-avatar/logs/plugin.log` alone.

## 1. Protocol & Data Flow

### New App→Plugin message types

```typescript
interface PromptCommand {
  type: "command";
  command: "prompt";
  sessionId: string;
  text: string;
  requestId: string;  // crypto.randomUUID()
}

interface PermissionReplyCommand {
  type: "command";
  command: "permission.reply";
  sessionId: string;
  permissionId: string;
  allow: boolean;
  requestId: string;
}

type AppMessage = PromptCommand | PermissionReplyCommand;
```

### New Plugin→App message types

```typescript
interface CommandResult {
  type: "command.result";
  requestId: string;
  success: boolean;
  error?: string;
}
```

### Enriched SessionInfo

```typescript
interface SessionInfo {
  sessionId: string;
  name: string;
  state: AvatarState;
  label: string | null;
  tokens: TokenData;
  // NEW:
  lastResponse: string | null;          // last ~200 chars of assistant text
  pendingPermission: {
    permissionId: string;
    title: string;
  } | null;
}
```

`PluginMessage` union expands to include `CommandResult`:

```typescript
type PluginMessage = StateMessage | SessionMessage | SyncMessage | CommandResult;
```

### Data flow

```
App (Tauri/PixiJS)                Plugin (OpenCode)
       |                                |
       |--- PromptCommand ------------>|
       |                                |-- client.session.promptAsync()
       |<-- CommandResult -------------|
       |                                |
       |--- PermissionReplyCommand --->|
       |                                |-- client.postSessionIdPermissions...()
       |<-- CommandResult -------------|
       |                                |
       |<-- SyncMessage (enriched) ----|  (lastResponse, pendingPermission)
```

## 2. Plugin-side Implementation

### A. Capturing lastResponse text

Use the `message.part.updated` event in the existing `handleEvent()` function. When the event carries a `TextPart` (`part.type === "text"`), store the last ~200 characters on the session member.

- Add `lastResponse: string | null` to `SessionMemberRuntime` in `session-registry.ts`.
- In `handleEvent`, add a case for `"message.part.updated"`. If `part.type === "text"`, set `member.lastResponse = part.text.slice(-200)` and broadcast.
- Include `lastResponse` in `SessionInfo` snapshots built by `getSnapshotByGroupId()`, sourced from the primary (highest-priority) member.

Zero additional API calls — just storing a string from events already received. The 200-char truncation keeps memory bounded.

**Logging**: Log at `debug` level when lastResponse is updated (session ID + char count).

### B. Capturing pendingPermission

Extend the existing `permission.ask` hook to store permission metadata alongside the waiting state.

- Add `pendingPermission: { permissionId: string; title: string } | null` to `SessionMemberRuntime`.
- In `handlePermissionAsk()`, store `{ permissionId: input.id, title: input.title }`.
- In the `permission.replied` event handler, clear `member.pendingPermission = null`.
- Include `pendingPermission` in `SessionInfo` snapshots.

**Logging**: Log at `info` level when permission is captured and when it's cleared (session ID + permission ID).

### C. SDK client capture and command handling

The `server` export (line 399 of `index.ts`) currently ignores its `PluginInput` parameter. Change to `async (input) => {` and store `input.client` in a module-level variable.

**New module: `plugin/src/command-handler.ts`**

Exports `handleCommand(msg: AppMessage, client: OpencodeClient, registry: SessionRegistry): Promise<CommandResult>`.

- **`prompt` command**: Call `client.session.promptAsync({ path: { id: msg.sessionId }, body: { parts: [{ type: "text", text: msg.text }] } })`. Fire-and-forget, return success immediately. If the call throws, return error.
- **`permission.reply` command**: Call `client.postSessionIdPermissionsPermissionId({ path: { id: msg.sessionId, permissionID: msg.permissionId }, body: { response: msg.allow ? "once" : "reject" } })`. Return success/error.

**Logging**: Log at `info` level: command received (type, sessionId, requestId), command executed (success/error), SDK call details at `debug`.

### D. WS server changes

Add incoming message handling to `AvatarWSServer`:

- New method: `setMessageHandler(handler: (msg: AppMessage, reply: (result: CommandResult) => void) => void)`.
- In the `ws.on("connection", ...)` callback, add `ws.on("message", ...)` that parses incoming JSON as `AppMessage`, calls the handler, and sends the `CommandResult` reply back on the same socket.
- Malformed messages are logged and ignored — connection stays open.

**Logging**: Log at `info` level: message received from app (command type), reply sent (requestId, success). Malformed messages at `warn`.

### E. Cross-process command routing

Extend `SharedSessionStore` with a file-based command queue using the existing `~/.opencode-avatar/state/` directory.

**Flow**:

1. Leader receives command → checks if target `sessionId` is in its own `SessionRegistry`.
   - **Local session**: Execute directly via SDK client (fast path).
   - **Remote session**: Write `~/.opencode-avatar/state/cmd-{requestId}.json` containing the `AppMessage` + `createdAt` timestamp.

2. Every instance polls for command files on the same interval it uses for snapshot writes (~1-2s). Each checks: "does this command target one of my sessions?"
   - **Yes**: Execute via own SDK client, write `result-{requestId}.json`, delete command file.
   - **No**: Ignore (another instance handles it).

3. Leader polls for result files → sends `CommandResult` to app via WS.

4. **Stale cleanup**: Command files older than 10 seconds are deleted by any instance. Leader sends timeout `CommandResult` for its pending commands.

**File formats**:

```typescript
// cmd-{requestId}.json
interface CommandFile {
  message: AppMessage;
  createdAt: number;  // Date.now()
}

// result-{requestId}.json
interface ResultFile {
  requestId: string;
  success: boolean;
  error?: string;
  completedAt: number;
}
```

**Logging**: Log at `info`: command file written (requestId, target sessionId), command file picked up (by which instance), result file written, stale file cleaned. Log at `warn`: command timeout, file I/O errors.

## 3. App-side UI

All new UI is plain HTML/CSS positioned over the PixiJS canvas. No PixiJS UI widgets.

### A. Enriched tooltip (lastResponse preview)

Current hover tooltip shows name + session ID. Extend with a third line showing last response text when available:

```
Session Name
session-id-abc123
> Last few words of response text...
```

- `SessionSnapshot` (renderer-local type) gains `lastResponse` and `pendingPermission` fields.
- `updateSync()` and `applyState()` propagate these from `SessionInfo`.
- `showTooltip()` conditionally appends a `<span class="last-response">` line, truncated to ~80 chars for display.
- CSS: `white-space: normal` (currently `nowrap`), max 2 lines via `-webkit-line-clamp`.

### B. Click-to-prompt panel

**Trigger**: Click on a robot's hitbox div.

**UI**: Small panel anchored to the left of the clicked robot:
- Text input field (single line, ~200px wide)
- Send button (or press Enter)
- × close button

**Behavior**:
- Click toggles the panel (click again to close).
- On show: hide tooltip, focus input.
- On send: construct `PromptCommand` with `crypto.randomUUID()` requestId, send via WS, clear input, hide panel.
- On close: × button or Escape key.
- Robot removed while panel open: auto-close panel.

**Wiring**: Renderer accepts callbacks `onPrompt(sessionId, text)` and `onPermissionReply(sessionId, permissionId, allow)`. `main.ts` wires these to `wsClient.send()`.

### C. Permission popup

**Trigger**: Session's `pendingPermission` transitions from null to non-null.

**UI**: Small popup anchored to the left of the waiting robot:
- Permission title text (e.g., "Allow Bash: npm test")
- Allow button + Deny button
- Auto-dismisses when `pendingPermission` becomes null

**Behavior**:
- Only one permission popup at a time (most recent takes priority; others accessible by clicking their robot).
- Allow → `PermissionReplyCommand` with `allow: true`. Deny → `allow: false`.
- Popup and prompt panel are mutually exclusive per robot.

### D. WS client changes

- New `send(message: AppMessage): void` method on `AvatarWSClient`.
- New `onCommandResult` callback in `WSClientCallbacks`.
- `parseMessage` recognizes `"command.result"` type.

### E. Styling

All new UI follows existing tooltip aesthetic:
- Dark semi-transparent background: `rgba(15, 23, 42, 0.94)`
- Monospace font, slate color palette
- Subtle border and box-shadow
- `pointer-events: auto` on interactive panels
- Smooth fade-in via CSS transition

## 4. Window Behavior

### A. Click-through for dead space

- `pointer-events: none` on `<body>` and `#app` — mouse events pass through transparent areas to apps behind the overlay.
- `pointer-events: auto` on robot hitbox divs, prompt panel, permission popup — these remain interactive.
- If CSS-only passthrough doesn't work on macOS, add `NSWindow.setIgnoresMouseEvents` toggling as fallback (verify during implementation).

### B. Dynamic window resize

- **Default**: Stay at 200×600 (current size). Robots and tooltip only.
- **On panel open**: Resize window leftward to ~500px via Tauri command. Adjust position so robots stay anchored at the right edge (the right side of the window stays fixed, the left edge extends).
- **On panel close**: Shrink back to 200px, shift position back.

Implementation:
- New Tauri Rust commands: `expand_window(width)` and `shrink_window()`. These atomically call `window.set_size()` + `window.set_position()` to avoid robots visually jumping.
- Renderer calls these before showing/hiding panels.
- Edge case: if robot disappears while panel is open, panel-close logic triggers `shrink_window()`.

### C. No dragging (v1)

Robots stay in auto-stacked bottom-right positions. Dragging deferred — adds significant complexity for limited v1 value.

## 5. Testing Strategy

### New test file: `plugin/test/command-handler.test.ts`

- Prompt command → verify `session.promptAsync()` called with correct args, success result returned.
- Prompt command with unknown session → error result.
- Permission reply (allow) → verify SDK called with `response: "once"`, success result.
- Permission reply (deny) → verify SDK called with `response: "reject"`, success result.
- Permission reply with missing permissionId → error result.
- SDK client throws → error caught, `CommandResult` with `success: false`.

### Extended: `plugin/test/ws-protocol.test.ts`

- App sends `PromptCommand` → receives `CommandResult` back on same socket.
- App sends `PermissionReplyCommand` → receives `CommandResult`.
- Malformed JSON → no crash, connection stays open.
- Unknown command type → error `CommandResult`.

### Extended: `plugin/test/shared-session-store.test.ts`

- Write command file → verify created with correct format.
- Poll commands → file targeting known session is picked up.
- Stale cleanup → old command files deleted.
- Result file round-trip → write command, poll, write result, poll result.

### Extended: `plugin/test/session-registry.test.ts`

- `lastResponse` field stored and included in snapshots.
- `pendingPermission` field stored, cleared, and included in snapshots.

### Not tested (manual only)

- App-side UI (PixiJS rendering, DOM interaction) — no test infra for Tauri/browser.
- Tauri window resize commands — manual macOS verification.
- End-to-end plugin↔app flow — manual smoke test.

### Test command

```bash
corepack pnpm --filter @opencode-avatar/plugin test
```

## 6. Error Handling

### Plugin-side errors

| Scenario | Handling |
|---|---|
| SDK `promptAsync()` throws | Catch, return `CommandResult{success:false, error}`. Log `error`. |
| SDK `postPermissions...()` throws | Same pattern. |
| Malformed WS message from app | Log `warn`, ignore. Connection stays open. |
| Unknown command type | Return `CommandResult{success:false, error:"unknown command"}`. |
| Session not found locally or in cross-process snapshots | Return `CommandResult{success:false, error:"session not found"}`. |
| Cross-process command times out (>10s) | Leader returns timeout `CommandResult`. Cleans up stale file. |
| Command file write fails (disk) | Log `error`, return `CommandResult{success:false}`. |
| SDK client not available | Return error for all commands. Log once at startup. |

### App-side errors

| Scenario | Handling |
|---|---|
| WS not connected when sending | Disable send button, show "disconnected" in prompt panel. |
| `CommandResult` with `success:false` | Show error text in prompt panel (red, auto-dismiss 3s). |
| Panel open but robot disappears | Close panel immediately. |
| Window resize fails | Log warning, panel still shows (may clip, but functional). |

### Logging levels

- `debug`: lastResponse updates, SDK call details, WS message parsing.
- `info`: command received, command executed, permission captured/cleared, command file I/O, session lifecycle.
- `warn`: malformed messages, unknown command types, stale file cleanup.
- `error`: SDK failures, file I/O failures, unexpected exceptions.

## Files Changed

### New files
- `plugin/src/command-handler.ts` — command routing and SDK client calls
- `plugin/test/command-handler.test.ts` — unit tests for command handler

### Modified files (plugin)
- `plugin/src/index.ts` — capture SDK client from PluginInput, add `message.part.updated` handler, wire command handler
- `plugin/src/session-registry.ts` — add `lastResponse` and `pendingPermission` to SessionMemberRuntime and snapshots
- `plugin/src/ws-server.ts` — add incoming message handler, reply routing
- `plugin/src/shared-session-store.ts` — command file write/poll/cleanup, result file I/O, include new fields in snapshots

### Modified files (shared)
- `shared/src/protocol.ts` — extend `SessionInfo`, add `AppMessage`, `CommandResult`, `PluginMessage` types

### Modified files (app)
- `app/src/ws-client.ts` — add `send()` method, `onCommandResult` callback, parse `command.result`
- `app/src/renderer.ts` — enriched tooltips, click handler, prompt panel, permission popup, window resize calls
- `app/src/main.ts` — wire renderer callbacks to WS client
- `app/index.html` — add prompt panel and permission popup HTML/CSS, body pointer-events

### Modified files (Tauri)
- `app/src-tauri/src/lib.rs` — add `expand_window`/`shrink_window` commands, click-through verification
- `app/src-tauri/tauri.conf.json` — possibly adjust initial window size if needed

### Modified test files
- `plugin/test/ws-protocol.test.ts` — bidirectional message tests
- `plugin/test/shared-session-store.test.ts` — command file routing tests
- `plugin/test/session-registry.test.ts` — new field tests

### Documentation
- `README.md` — update with reverse channel usage, new features
- `docs/architecture.md` — update with bidirectional protocol, command flow diagram, cross-process routing
