# Architecture Overview

## System Shape

The current runtime architecture is:

```text
OpenCode plugin -> WebSocket -> Tauri 2 + PixiJS app
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
2. The plugin normalizes those events into per-session runtime state.
3. `SessionStateMachine` determines the highest-priority visible avatar state.
4. `TokenTracker` accumulates assistant token totals and computes a rolling token rate.
5. `AvatarWSServer` broadcasts `session` and `state` messages and sends a `sync` snapshot to newly connected app clients.
6. The app WebSocket client receives those messages and applies them to the PixiJS renderer.
7. The renderer updates robot pose/state and flame intensity for each active session.

## Shared Protocol

The shared protocol exists so the plugin and app can evolve independently while preserving a typed boundary.

- `session` messages announce create, resume, and end events.
- `state` messages carry the current avatar state, display label, token totals, token rate, and timestamp.
- `sync` messages provide the full active-session snapshot for newly connected clients and reconnect recovery.

The protocol also centralizes tool-to-avatar-state mapping. Today that includes reading tools, editing tools, `Bash`, several Playwright browser actions, and `Task`.

## Plugin Responsibilities

The plugin is the source of truth for avatar behavior.

### State machine

`SessionStateMachine` combines several inputs into a single visible state:

- active tool execution
- thinking / message streaming
- permission waiting
- temporary error display
- short hold windows to avoid flicker when tools finish

Priority is defined in `shared/src/protocol.ts`, with `error` highest and `idle` lowest.

### Token tracking

`TokenTracker` stores cumulative token deltas from assistant message updates and calculates a rolling five-second rate. The app uses that rate to scale flame intensity.

### WebSocket server

`AvatarWSServer` listens on `AVATAR_WS_PORT` or `2728` by default. Each new client immediately receives a `sync` message, after which incremental `session` and `state` messages are broadcast.

## App Responsibilities

The app renders state; it does not derive state.

### Tauri shell

- `app/src-tauri/tauri.conf.json` configures a transparent, undecorated, always-on-top window.
- `app/src-tauri/src/lib.rs` applies macOS-specific overlay behavior so the window can stay visible across spaces.

### WebSocket client

`AvatarWSClient` connects to `VITE_AVATAR_WS_URL`, parses the shared protocol messages, and retries with exponential backoff after disconnects.

### PixiJS renderer

`AvatarRenderer` maintains one robot per active session, resizes the canvas to fit the active stack, and updates animation state every frame.

### Sprites and flames

- `sprites.ts` generates the texture set used by the robot renderer.
- `robot.ts` applies avatar state and token data to a session robot.
- `flames.ts` emits deterministic flame particles whose intensity scales with token throughput.

## Configuration

### Plugin env vars

| Variable | Default | Effect |
| --- | --- | --- |
| `AVATAR_WS_PORT` | `2728` | WebSocket server port for the plugin. |
| `AVATAR_LOG_LEVEL` | `info` | Plugin log filtering level. |

### App env vars

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_AVATAR_WS_URL` | `ws://127.0.0.1:2728` | WebSocket endpoint used by the frontend client. |
| `VITE_LOG_LEVEL` | `info` | Frontend console log filtering level. |
| `VITE_DEBUG` | unset | Enables frontend debug mode when set to `1`. |

## Logging Behavior

- Plugin logs are persisted under `~/.opencode-avatar/logs/` and currently write to `plugin.log`.
- The frontend logger in `app/src/logger.ts` is console-based today; it does not write browser logs to files.
- The Tauri shell enables `tauri-plugin-log` in debug builds, but this repo does not currently add explicit file-target configuration for app-side logs.

## Development Commands

Install dependencies:

```bash
corepack pnpm install
```

Run the plugin watcher:

```bash
corepack pnpm dev:plugin
```

Run the Tauri overlay app:

```bash
corepack pnpm --dir app tauri:dev
```

Run the Vite frontend only:

```bash
corepack pnpm dev:app
```

Build the workspace:

```bash
corepack pnpm build
```

Package the Tauri app:

```bash
corepack pnpm --dir app tauri:build
```

Run tests:

```bash
corepack pnpm test
```
