# Reverse Communication Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional WebSocket communication so the Tauri overlay app can send prompts and permission replies back to OpenCode sessions.

**Architecture:** Extend the existing plugin→app WS protocol with app→plugin command messages. The plugin captures the OpenCode SDK client to execute commands. Cross-process command routing uses the existing filesystem-based shared state directory. The app adds HTML/CSS UI panels over the PixiJS canvas.

**Tech Stack:** TypeScript, Vitest, WebSocket (ws), Tauri (Rust), PixiJS, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-04-02-reverse-channel-design.md`

**Build/test commands:**
- Build plugin: `corepack pnpm --filter @opencode-avatar/plugin build`
- Test plugin: `corepack pnpm --filter @opencode-avatar/plugin test`
- Build shared: `corepack pnpm --filter @opencode-avatar/shared build`
- Type-check all: `corepack pnpm -r run typecheck` (if available) or build each package

**Important:** After any `shared/` change, rebuild shared before building/testing plugin or app.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `plugin/src/command-handler.ts` | Routes `AppMessage` commands to SDK client calls, returns `CommandResult` |
| `plugin/test/command-handler.test.ts` | Unit tests for command handler with mock SDK client |

### Modified files
| File | Changes |
|------|---------|
| `shared/src/protocol.ts` | Add `AppMessage`, `CommandResult` types; extend `SessionInfo` with `lastResponse`, `pendingPermission`; extend `PluginMessage` union |
| `plugin/src/session-registry.ts` | Add `lastResponse` and `pendingPermission` to `SessionMemberRuntime`; include in snapshots |
| `plugin/src/ws-server.ts` | Add incoming message handler via `setMessageHandler()`; parse app messages, route replies |
| `plugin/src/shared-session-store.ts` | Add command file write/poll/cleanup; result file I/O; include new fields in shared snapshots |
| `plugin/src/index.ts` | Capture SDK `client` from `PluginInput`; add `message.part.updated` handler; capture `permissionId` in `permission.ask`; clear in `permission.replied`; wire command handler to WS server |
| `app/src/ws-client.ts` | Add `send()` method; add `onCommandResult` callback; parse `command.result` messages |
| `app/src/renderer.ts` | Enriched tooltips; click-to-prompt panel; permission popup; window resize calls; command callbacks |
| `app/src/main.ts` | Wire renderer command callbacks to WS client |
| `app/index.html` | Add prompt panel and permission popup HTML elements and CSS; `pointer-events: none` on body |
| `app/src-tauri/src/lib.rs` | Add `expand_window`/`shrink_window` Tauri commands |
| `plugin/test/session-registry.test.ts` | Tests for new `lastResponse` and `pendingPermission` fields |
| `plugin/test/ws-protocol.test.ts` | Tests for bidirectional message flow |
| `plugin/test/shared-session-store.test.ts` | Tests for command file routing |
| `README.md` | Document reverse channel features |
| `docs/architecture.md` | Document bidirectional protocol, command flow, cross-process routing |

---

## Task 1: Extend shared protocol types

**Files:**
- Modify: `shared/src/protocol.ts`

This is the foundation — all other tasks depend on these types.

- [ ] **Step 1:** Add `AppMessage` types (`PromptCommand`, `PermissionReplyCommand`, and union) to `shared/src/protocol.ts`. Add `CommandResult` type. See spec Section 1 for exact shapes.

- [ ] **Step 2:** Extend `SessionInfo` with two new optional fields: `lastResponse: string | null` and `pendingPermission: { permissionId: string; title: string } | null`.

- [ ] **Step 3:** Extend `PluginMessage` union to include `CommandResult`.

- [ ] **Step 4:** Export all new types from the package barrel.

- [ ] **Step 5:** Build shared package: `corepack pnpm --filter @opencode-avatar/shared build`. Fix any type errors.

- [ ] **Step 6:** Commit: `feat(shared): add reverse channel protocol types`

---

## Task 2: Extend session registry with new fields

**Files:**
- Modify: `plugin/src/session-registry.ts`
- Modify: `plugin/test/session-registry.test.ts`

- [ ] **Step 1:** Write tests in `session-registry.test.ts` for:
  - `lastResponse` is `null` by default on a new session member
  - Setting `lastResponse` on a member makes it appear in `getSnapshotByGroupId()` output
  - `pendingPermission` is `null` by default
  - Setting `pendingPermission` on a member makes it appear in snapshots
  - When a group has multiple members, `lastResponse` and `pendingPermission` come from the primary (highest state priority) member

- [ ] **Step 2:** Run tests, verify they fail: `corepack pnpm --filter @opencode-avatar/plugin test`

- [ ] **Step 3:** Add `lastResponse: string | null` and `pendingPermission: { permissionId: string; title: string } | null` as mutable fields on `SessionMemberRuntime`. Initialize both to `null` in `ensureSession()`. Include both in the `SessionInfo` snapshot returned by `getSnapshotByGroupId()`, sourced from the primary member.

- [ ] **Step 4:** Run tests, verify they pass.

- [ ] **Step 5:** Commit: `feat(plugin): add lastResponse and pendingPermission to session registry`

---

## Task 3: Capture lastResponse from message.part.updated events

**Files:**
- Modify: `plugin/src/index.ts`

No unit test for this step — it's event wiring in the main module. Tested via integration later.

- [ ] **Step 1:** In `handleEvent()`, add a case for `"message.part.updated"`. Extract `event.properties.part`. If `part.type === "text"`, look up the session via `part.sessionID`, set `member.lastResponse = part.text.slice(-200)`, and call `broadcastState(groupId)`. Add `debug` level logging with session ID and character count.

- [ ] **Step 2:** Build plugin: `corepack pnpm --filter @opencode-avatar/plugin build`. Fix any type errors.

- [ ] **Step 3:** Run existing tests to verify nothing broke: `corepack pnpm --filter @opencode-avatar/plugin test`

- [ ] **Step 4:** Commit: `feat(plugin): capture lastResponse from message.part.updated events`

---

## Task 4: Capture pendingPermission from permission hooks

**Files:**
- Modify: `plugin/src/index.ts`

- [ ] **Step 1:** In `handlePermissionAsk()`, after the existing `sm.onPermissionWaiting()` call, set `member.pendingPermission = { permissionId: input.id, title: input.title }`. Add `info` level logging.

- [ ] **Step 2:** In `handleEvent()` case `"permission.replied"`, after the existing `sm.onPermissionReplied()` call, set `member.pendingPermission = null`. Add `info` level logging.

- [ ] **Step 3:** Build and run tests: `corepack pnpm --filter @opencode-avatar/plugin build && corepack pnpm --filter @opencode-avatar/plugin test`

- [ ] **Step 4:** Commit: `feat(plugin): capture pendingPermission from permission hooks`

---

## Task 5: Capture SDK client from PluginInput

**Files:**
- Modify: `plugin/src/index.ts`

- [ ] **Step 1:** Change the `server` export signature from `async () => {` to `async (input) => {`. Store `input.client` in a module-level variable (e.g., `let sdkClient: OpencodeClient | null = null`). Log at `info` level whether the client was received.

- [ ] **Step 2:** Build and run tests: `corepack pnpm --filter @opencode-avatar/plugin build && corepack pnpm --filter @opencode-avatar/plugin test`

- [ ] **Step 3:** Commit: `feat(plugin): capture SDK client from PluginInput`

---

## Task 6: Create command handler module

**Files:**
- Create: `plugin/src/command-handler.ts`
- Create: `plugin/test/command-handler.test.ts`

- [ ] **Step 1:** Write tests in `command-handler.test.ts` with a mock SDK client object. Test cases:
  - `prompt` command calls `client.session.promptAsync()` with correct `path.id` and `body.parts`, returns `{ success: true }`
  - `permission.reply` with `allow: true` calls `client.postSessionIdPermissionsPermissionId()` with `response: "once"`, returns success
  - `permission.reply` with `allow: false` calls with `response: "reject"`, returns success
  - SDK client throws → returns `{ success: false, error: <message> }`
  - Unknown command type → returns `{ success: false, error: "unknown command" }`
  - SDK client is null → returns `{ success: false, error: <descriptive message> }`

- [ ] **Step 2:** Run tests, verify they fail.

- [ ] **Step 3:** Implement `command-handler.ts`. Export a `handleCommand` function that takes an `AppMessage`, an SDK client (or null), and returns a `Promise<CommandResult>`. Use `createLogger("command-handler")` for structured logging. Log at `info` for every command received and result returned. Log SDK call details at `debug`. Catch all SDK errors and return them as `CommandResult`.

- [ ] **Step 4:** Run tests, verify they pass.

- [ ] **Step 5:** Commit: `feat(plugin): add command handler module`

---

## Task 7: Add incoming message handling to WS server

**Files:**
- Modify: `plugin/src/ws-server.ts`
- Modify: `plugin/test/ws-protocol.test.ts`

- [ ] **Step 1:** Write tests in `ws-protocol.test.ts`:
  - Client sends a valid `PromptCommand` JSON → message handler is called with parsed message, reply function sends `CommandResult` back to the same client
  - Client sends a valid `PermissionReplyCommand` → same flow
  - Client sends malformed JSON → connection stays open, no crash, handler not called
  - Client sends unknown message type → handler receives it (handler decides the error response)

- [ ] **Step 2:** Run tests, verify they fail.

- [ ] **Step 3:** Add `setMessageHandler()` method to `AvatarWSServer`. In the `ws.on("connection")` callback, add a `ws.on("message")` listener that parses incoming JSON, validates it has `type: "command"`, calls the handler with a reply function that sends JSON back on that socket. Log at `info` for messages received and replies sent. Log at `warn` for malformed messages.

- [ ] **Step 4:** Run tests, verify they pass.

- [ ] **Step 5:** Commit: `feat(plugin): add bidirectional message handling to WS server`

---

## Task 8: Wire command handler to WS server in index.ts

**Files:**
- Modify: `plugin/src/index.ts`

- [ ] **Step 1:** In `ensureServerStarted()` (or after WS server creation), call `wsServer.setMessageHandler(...)`. The handler should call `handleCommand(msg, sdkClient)` and pass the result to the reply function.

- [ ] **Step 2:** Build and run all tests: `corepack pnpm --filter @opencode-avatar/plugin build && corepack pnpm --filter @opencode-avatar/plugin test`

- [ ] **Step 3:** Commit: `feat(plugin): wire command handler to WS server`

---

## Task 9: Cross-process command routing in SharedSessionStore

**Files:**
- Modify: `plugin/src/shared-session-store.ts`
- Modify: `plugin/test/shared-session-store.test.ts`

- [ ] **Step 1:** Write tests:
  - `writeCommand(msg)` creates a `cmd-{requestId}.json` file in the state directory with correct format (`{ message, createdAt }`)
  - `pollCommands(mySessionIds)` reads command files, returns only those targeting sessions in the provided set, deletes the consumed command file
  - `pollCommands` ignores command files targeting other sessions
  - `writeResult(result)` creates a `result-{requestId}.json` file
  - `pollResults()` reads and deletes result files, returns array of `ResultFile`
  - Stale command files (>10s) are deleted during `pollCommands` and not returned
  - File I/O errors are caught and logged, not thrown

- [ ] **Step 2:** Run tests, verify they fail.

- [ ] **Step 3:** Implement the new methods on `SharedSessionStore`. Use the existing `stateDir` path. Follow the existing write-tmp-then-rename pattern for atomicity. Add structured logging for all file operations.

- [ ] **Step 4:** Also update `writeSnapshot()` to include `lastResponse` and `pendingPermission` in the shared snapshot format, so the leader's merge sees them from non-leader instances.

- [ ] **Step 5:** Run tests, verify they pass.

- [ ] **Step 6:** Commit: `feat(plugin): add cross-process command routing to SharedSessionStore`

---

## Task 10: Integrate cross-process routing into command flow

**Files:**
- Modify: `plugin/src/index.ts`

- [ ] **Step 1:** Update the command handler wiring (from Task 8) to check if the target session is local. If local, execute directly. If not local (session not in registry but exists in merged sync data), call `sharedSessionStore.writeCommand(msg)`.

- [ ] **Step 2:** Add a polling loop (or hook into the existing snapshot poll interval) that calls `sharedSessionStore.pollCommands(mySessionIds)` for non-leader instances, executes commands locally, and writes results.

- [ ] **Step 3:** For the leader: add polling for result files via `sharedSessionStore.pollResults()`, send results back through WS server to the app. Track pending cross-process commands and time them out after 10 seconds.

- [ ] **Step 4:** Build and run all tests: `corepack pnpm --filter @opencode-avatar/plugin build && corepack pnpm --filter @opencode-avatar/plugin test`

- [ ] **Step 5:** Commit: `feat(plugin): integrate cross-process command routing`

---

## Task 11: App WS client — send method and command result handling

**Files:**
- Modify: `app/src/ws-client.ts`

- [ ] **Step 1:** Add a `send(message: AppMessage): void` method to `AvatarWSClient` that JSON-serializes and sends via the open WebSocket. If not connected, log a warning and no-op.

- [ ] **Step 2:** Add `onCommandResult: (msg: CommandResult) => void` to `WSClientCallbacks`.

- [ ] **Step 3:** Update `parseMessage()` to also recognize `type: "command.result"` messages and dispatch to `onCommandResult`.

- [ ] **Step 4:** Build app to verify types: `corepack pnpm --filter @opencode-avatar/app build` (or type-check).

- [ ] **Step 5:** Commit: `feat(app): add send method and command result handling to WS client`

---

## Task 12: Enriched tooltip with lastResponse

**Files:**
- Modify: `app/src/renderer.ts`
- Modify: `app/index.html`

- [ ] **Step 1:** Add `lastResponse: string | null` and `pendingPermission` fields to the renderer-local `SessionSnapshot` type.

- [ ] **Step 2:** Update `updateSync()`, `applyState()`, and `upsertSession()` to propagate `lastResponse` and `pendingPermission` from incoming `SessionInfo` to the managed robot's snapshot.

- [ ] **Step 3:** Update `showTooltip()` to conditionally append a `<span class="last-response">` line when `lastResponse` is non-null. Truncate to ~80 chars for display.

- [ ] **Step 4:** Update tooltip CSS in `index.html`: change `white-space: nowrap` to `white-space: normal`. Add `.last-response` styles with smaller font, `-webkit-line-clamp: 2`, and the `>` prefix styling.

- [ ] **Step 5:** Build and verify manually in the Tauri app.

- [ ] **Step 6:** Commit: `feat(app): show lastResponse preview in hover tooltip`

---

## Task 13: Click-to-prompt panel

**Files:**
- Modify: `app/src/renderer.ts`
- Modify: `app/src/main.ts`
- Modify: `app/index.html`

- [ ] **Step 1:** Add the prompt panel HTML to `index.html`: a hidden `<div id="prompt-panel">` with a text `<input>`, send `<button>`, and close `<button>`. Style it to match the tooltip aesthetic (dark background, monospace font, `pointer-events: auto`). Add fade-in CSS transition.

- [ ] **Step 2:** Add `pointer-events: none` to `body` and `#app` in the CSS. Verify robot hitboxes still work (they already have `pointer-events: auto`).

- [ ] **Step 3:** In the renderer, add a `click` event listener to each robot's hitbox. On click: position the prompt panel to the left of the robot, show it, focus the input, hide the tooltip. Click again to toggle closed. Escape key closes.

- [ ] **Step 4:** Add callback properties to `AvatarRenderer`: `onPrompt?: (sessionId: string, text: string) => void`. On send (Enter key or button), call `this.onPrompt(sessionId, inputValue)`, clear input, hide panel.

- [ ] **Step 5:** In `main.ts`, wire `renderer.onPrompt` to construct a `PromptCommand` and call `wsClient.send()`. Wire `onCommandResult` callback to show success/error feedback.

- [ ] **Step 6:** Handle edge case: if a robot is removed while its prompt panel is open, close the panel (update `removeRobot()`).

- [ ] **Step 7:** Build and verify manually.

- [ ] **Step 8:** Commit: `feat(app): add click-to-prompt input panel`

---

## Task 14: Permission popup

**Files:**
- Modify: `app/src/renderer.ts`
- Modify: `app/src/main.ts`
- Modify: `app/index.html`

- [ ] **Step 1:** Add the permission popup HTML to `index.html`: a hidden `<div id="permission-popup">` with a `<p>` for the title, Allow `<button>`, and Deny `<button>`. Style consistently with prompt panel.

- [ ] **Step 2:** In the renderer, detect when `pendingPermission` transitions from null to non-null during `upsertSession()` or `applyState()`. Show the permission popup anchored to the left of that robot. Only one popup at a time (most recent wins). When `pendingPermission` transitions to null, hide the popup.

- [ ] **Step 3:** Add callback: `onPermissionReply?: (sessionId: string, permissionId: string, allow: boolean) => void`. Allow/Deny buttons call this callback.

- [ ] **Step 4:** In `main.ts`, wire `renderer.onPermissionReply` to construct a `PermissionReplyCommand` and call `wsClient.send()`.

- [ ] **Step 5:** Handle mutual exclusivity: if prompt panel and permission popup target the same robot, permission popup takes priority. Prompt panel hides.

- [ ] **Step 6:** Build and verify manually.

- [ ] **Step 7:** Commit: `feat(app): add permission approve/deny popup`

---

## Task 15: Dynamic window resize (Tauri commands)

**Files:**
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/renderer.ts`

- [ ] **Step 1:** In `lib.rs`, add two Tauri commands: `expand_window` (takes target width) and `shrink_window`. Both atomically call `window.set_size()` and `window.set_position()` — expanding grows leftward (decrease x, increase width), shrinking reverses. Use the current window position to calculate the new x so the right edge stays fixed.

- [ ] **Step 2:** Register the commands in the Tauri builder: `.invoke_handler(tauri::generate_handler![expand_window, shrink_window])`.

- [ ] **Step 3:** In the renderer, before showing a panel (prompt or permission), call `invoke("expand_window", { width: 500 })` via `@tauri-apps/api/core`. On panel hide, call `invoke("shrink_window")`. Guard with try/catch — if resize fails, the panel still shows (may clip but is functional).

- [ ] **Step 4:** Verify the CSP in `tauri.conf.json` allows the invoke calls (it should — `ipc:` is already in `connect-src`).

- [ ] **Step 5:** Build Tauri app: `corepack pnpm --filter @opencode-avatar/app tauri build` (or dev mode). Test manually — click robot, verify window expands, panel shows, close panel, verify window shrinks.

- [ ] **Step 6:** Commit: `feat(app): add dynamic window resize for interactive panels`

---

## Task 16: Click-through verification on macOS

**Files:**
- Possibly modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1:** With the `pointer-events: none` on body from Task 13, manually test on macOS: can you click through the transparent overlay areas to apps behind it?

- [ ] **Step 2:** If yes — done, no changes needed.

- [ ] **Step 3:** If no — add Tauri's `ignore_cursor_events(true)` on the window as default, and toggle it off when the cursor enters a hitbox/panel. Check if Tauri v2 has a built-in API for this before dropping to raw `NSWindow` calls.

- [ ] **Step 4:** If changes were made, commit: `fix(app): enable click-through on macOS overlay`

---

## Task 17: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1:** Update `README.md` with a section on the new interactive features: tooltip with last response, click-to-prompt, permission popup. Briefly explain the reverse channel concept.

- [ ] **Step 2:** Update `docs/architecture.md` with:
  - Bidirectional protocol diagram (app→plugin commands, plugin→app results)
  - Cross-process command routing flow
  - New file formats (`cmd-*.json`, `result-*.json`)
  - Updated `SessionInfo` fields

- [ ] **Step 3:** Verify JSDoc headers exist on `command-handler.ts` and any new types.

- [ ] **Step 4:** Commit: `docs: update architecture and README with reverse channel`

---

## Task 18: Final integration test

- [ ] **Step 1:** Run full test suite: `corepack pnpm --filter @opencode-avatar/plugin test`. All tests must pass.

- [ ] **Step 2:** Build all packages: `corepack pnpm --filter @opencode-avatar/shared build && corepack pnpm --filter @opencode-avatar/plugin build`

- [ ] **Step 3:** Manual smoke test:
  - Start an OpenCode session with the plugin loaded
  - Launch the Tauri overlay app
  - Verify robots appear with enriched tooltips (hover shows lastResponse text)
  - Click a robot → prompt panel appears, window expands
  - Type a message, press Enter → verify it reaches the OpenCode session
  - Trigger a permission request → verify popup appears near robot
  - Click Allow → verify permission is granted in the session
  - Close panels → verify window shrinks back

- [ ] **Step 4:** Commit any final fixes if needed.

- [ ] **Step 5:** Final commit: `feat: reverse communication channel v1`
