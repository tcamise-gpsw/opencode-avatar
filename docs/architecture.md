# Architecture Overview

## System Shape

The current runtime architecture is:

```text
OpenCode plugin instances <-> shared state files + WebSocket leader <-> Tauri 2 + PixiJS app
```

This keeps OpenCode-facing logic inside the plugin while the desktop app stays focused on rendering.

## Workspace Layout

### `shared/`

- `shared/src/protocol.ts` is the contract between the plugin and app.
- It defines avatar states, state priority, tool-to-state mapping, token data, session snapshots, and the three WebSocket message types.
- Message types: `session`, `state`, and `sync`.

### `plugin/`

- `plugin/src/index.ts` is the OpenCode plugin entry point.
- `plugin/src/state-machine.ts` converts OpenCode events into a stable avatar state with short hold windows for tools and errors.
- `plugin/src/token-tracker.ts` tracks cumulative tokens plus a rolling five-second token rate.
- `plugin/src/shared-session-store.ts` persists each plugin process's grouped session snapshots under `~/.opencode-avatar/state/` and merges live snapshots across processes.
- `plugin/src/command-handler.ts` executes reverse-channel commands (`prompt`, `permission.reply`) through the OpenCode SDK client and returns typed `command.result` responses.
- `plugin/src/ws-server.ts` exposes the plugin state over a local WebSocket server.
- `plugin/src/logger.ts` writes structured plugin logs to `~/.opencode-avatar/logs/plugin.log`.

### `app/`

- `app/src/main.ts` bootstraps the frontend, resolves the WebSocket URL, and wires the renderer to the WebSocket client.
- `app/src/ws-client.ts` handles connection lifecycle, message parsing, and reconnect backoff.
- `app/src/renderer.ts` owns the PixiJS application and one rendered robot per active session.
- `app/src/sprites.ts` and `app/src/robot.ts` generate and animate the robot visuals.
- `app/src/flames.ts` renders token-rate-driven flame particles below each robot.
- `app/src-tauri/` contains the Tauri 2 shell, including the always-on-top transparent overlay window configuration.

## Data Flow

1. OpenCode emits hook events such as session lifecycle updates, chat activity, tool execution, permission prompts, and errors.
2. Each plugin process normalizes those events into local per-session runtime state.
3. `SessionStateMachine` determines the highest-priority visible avatar state.
4. `TokenTracker` accumulates assistant token totals and computes a rolling token rate.
5. `SessionRegistry` groups subagent sessions under a parent/root avatar using `parentID`, and stores `lastResponse` plus `pendingPermission` per member.
6. `SharedSessionStore` writes each process's grouped snapshots to `~/.opencode-avatar/state/` and merges non-stale snapshots from other processes.
7. The plugin instance that successfully owns `AVATAR_WS_PORT` serves the merged `sync` view and broadcasts incremental `session` and `state` messages.
8. The app WebSocket client receives those messages and applies them to the PixiJS renderer.
9. The renderer updates robot pose/state and flame intensity for each active session.

Reverse-channel flow:

1. The app sends a `command` message (`prompt` or `permission.reply`) with a `requestId`.
2. If the target session is local to the WebSocket leader, the plugin executes it immediately via `command-handler`.
3. If the target session belongs to another plugin process, the leader writes `cmd-<requestId>.json` and tracks the request as pending.
4. Non-leader instances poll command files for their local sessions, execute commands, and write `result-<requestId>.json`.
5. The leader polls result files, resolves pending requests, and sends `command.result` back to the originating app socket.
6. Pending cross-process commands time out after 10 seconds if no result arrives.

## Shared Protocol

The shared protocol exists so the plugin and app can evolve independently while preserving a typed boundary.

- `session` messages announce create, resume, and end events.
- `state` messages carry the current avatar state, display label, token totals, token rate, and timestamp.
- `sync` messages provide the full active-session snapshot for newly connected clients, reconnect recovery, and cross-process session reconciliation.
- `command` messages (app → plugin) carry reverse-channel requests.
- `command.result` messages (plugin → app) acknowledge success/failure by `requestId`.

`SessionInfo` now includes:

- `lastResponse: string | null`
- `pendingPermission: { permissionId: string; title: string } | null`

The protocol also centralizes tool-to-avatar-state mapping. Today that includes reading tools, editing tools, `Bash`, several Playwright browser actions, and `Task`.

Tool mapping is applied case-insensitively in the plugin state machine. Incoming tool names are normalized (for example `read`/`Read`) before state resolution and before matching start/end lifecycle events.

## Plugin Responsibilities

The plugin is the source of truth for avatar behavior. In multi-process setups, each plugin process owns its local session state while the WebSocket-owning process serves the merged cross-process view.

### State machine

`SessionStateMachine` combines several inputs into a single visible state:

- active tool execution
- thinking / message streaming
- permission waiting
- temporary error display
- short hold windows to avoid flicker when tools finish

`SessionStateMachine` also exposes diagnostics used by logging, including active tool count/names and state flags (`isThinking`, waiting, error).

Priority is defined in `shared/src/protocol.ts`, with `error` highest and `idle` lowest.

### Token tracking

`TokenTracker` stores cumulative token deltas from assistant message updates and calculates a rolling five-second rate. The app uses that rate to scale flame intensity.

### Session grouping and cross-process merge

- `SessionRegistry` collapses subagent sessions into their parent/root group so subagents do not create extra robots.
- `SharedSessionStore` persists grouped session snapshots per plugin process.
- Snapshot files older than 15 seconds are treated as stale and removed during merge.
- The merge key is `sessionId`, so the merged `sync` payload represents one robot per root/grouped session across all running OpenCode processes.
- Cross-process reverse-channel files:
  - `cmd-<requestId>.json`: `{ message, createdAt }`
  - `result-<requestId>.json`: `{ result, createdAt }`

### WebSocket server

`AvatarWSServer` listens on `AVATAR_WS_PORT` or `2728` by default. Only one plugin process can bind that port at a time. Each new client immediately receives a merged `sync` message, after which incremental `session` and `state` messages are broadcast. When the merged snapshot changes, the leader also rebroadcasts `sync` so already-connected overlays pick up sessions from other OpenCode processes. Follower plugin instances keep retrying leadership so another active OpenCode process can take over if the current leader exits.

The WebSocket server is bidirectional: it also accepts app `command` messages and sends back `command.result` replies.

## App Responsibilities

The app renders state; it does not derive state.

### Tauri shell

- `app/src-tauri/tauri.conf.json` configures a transparent, undecorated, always-on-top window.
- `app/src-tauri/src/lib.rs` applies macOS-specific overlay behavior so the window can stay visible across spaces.

### WebSocket client

`AvatarWSClient` connects to `VITE_AVATAR_WS_URL`, parses all shared protocol messages (`sync`, `state`, `session`, `command.result`), sends app `command` messages, and retries with exponential backoff after disconnects.

### PixiJS renderer

`AvatarRenderer` maintains one robot per active session, resizes the canvas to fit the active stack, updates animation state every frame, and hosts interactive overlay UI:

- hover tooltip with `lastResponse` preview
- click-to-prompt input panel
- permission popup (Allow/Deny)
- Tauri window expand/shrink calls for panel visibility

### Sprites and flames

- `sprites.ts` generates the texture set used by the robot renderer.
- `robot.ts` applies avatar state and token data to a session robot.
- `flames.ts` emits deterministic flame particles whose intensity scales with token throughput.

## Operational References

- [Developer Guide](../README-dev.md) covers local setup, build, and test workflows.
- [Configuration Guide](configuration.md) covers OpenCode config, environment variables, runtime paths, and logging locations.
- [Release Guide](release.md) covers the v1 packaging flow and output artifacts.
- [Troubleshooting Guide](troubleshooting.md) covers operational triage and log interpretation.
