# OpenCode Avatar Overlay

`opencode-avatar` is a pnpm workspace that turns OpenCode activity into a desktop overlay.

The current implementation has three parts:

1. `plugin/`: an OpenCode plugin that tracks session state, token throughput, and tool activity, persists per-process snapshots under `~/.opencode-avatar/state/`, and publishes the merged view over WebSocket.
2. `shared/`: the shared TypeScript protocol and state definitions used by both sides of the connection.
3. `app/`: a Tauri 2 desktop shell that hosts a PixiJS renderer and connects to the plugin's WebSocket server.

## Workspace Layout

```text
.
├── app/      # Tauri 2 + Vite + PixiJS overlay app
├── plugin/   # OpenCode plugin, state machine, token tracker, WS server
├── shared/   # Shared protocol types and state mappings
└── docs/     # Project documentation
```

## Architecture

Runtime flow:

```text
OpenCode plugin <-> WebSocket <-> Tauri 2 + PixiJS app
```

- `shared/src/protocol.ts` defines avatar states plus the WebSocket message shapes used in both directions.
- `plugin/src/index.ts` listens to OpenCode hooks, feeds `SessionStateMachine` and `TokenTracker`, writes each plugin instance's grouped snapshots to the shared state directory, and broadcasts the merged view through `AvatarWSServer`.
- `app/src/ws-client.ts` reconnects to the plugin WebSocket, receives `session`/`state`/`sync`/`command.result`, and can send app commands (`prompt`, `permission.reply`) back to the plugin.
- `app/src/renderer.ts` manages one robot per active session and uses `sprites.ts`, `robot.ts`, and `flames.ts` to render the overlay.

## Interactive Reverse Channel (v1)

The overlay now supports a reverse communication channel (app → plugin → OpenCode SDK):

- **Last response preview:** hover a robot to see the latest assistant text snippet in the tooltip.
- **Click-to-prompt:** click a robot to open an input panel and send text into that session.
- **Permission popup:** when a session is waiting on permission, a popup appears near the robot with Allow/Deny.

Protocol additions in `shared/src/protocol.ts`:

- App → Plugin: `type: "command"` with `command: "prompt" | "permission.reply"`
- Plugin → App: `type: "command.result"`
- `SessionInfo` now includes `lastResponse` and `pendingPermission`.

For multi-process OpenCode setups, cross-process command routing uses shared files in `~/.opencode-avatar/state/`:

- `cmd-<requestId>.json`
- `result-<requestId>.json`

More detail lives in `docs/architecture.md`.

## Prerequisites

- Node.js with Corepack enabled
- `pnpm` via Corepack
- Rust toolchain for Tauri builds
- Platform dependencies required by Tauri 2

## Install

```bash
corepack pnpm install
```

## Run

The plugin does **not** run as a standalone server process. It is loaded by OpenCode, and OpenCode executes the built artifact at `plugin/dist/index.js`.

In one terminal, watch and rebuild the plugin package:

```bash
corepack pnpm dev:plugin
```

Register the plugin in your OpenCode config (`~/.config/opencode/config.json`), then start OpenCode so it loads `plugin/dist/index.js` and opens the avatar WebSocket server.

Example config snippet:

```json
{
  "plugin": [
    "/Users/tcamise/gopro/opencode-avatar/plugin"
  ]
}
```

Once OpenCode is running with the plugin enabled, run the desktop overlay in another terminal:

```bash
corepack pnpm --dir app tauri:dev
```

If you only want the Vite frontend without the Tauri shell:

```bash
corepack pnpm dev:app
```

Defaults expect the plugin WebSocket server on `ws://127.0.0.1:2728`.

If you change plugin code, restart the relevant OpenCode processes after `plugin/dist/` has been rebuilt so they load the updated plugin runtime.

Expected success signals:

- OpenCode loads the plugin and `~/.opencode-avatar/logs/plugin.log` contains `plugin_ready`
- The overlay stops reconnecting and begins rendering robots for active sessions

## Build

Build all workspace packages:

```bash
corepack pnpm build
```

Build the packaged Tauri app:

```bash
corepack pnpm --dir app tauri:build
```

## Test

Run the workspace test suite:

```bash
corepack pnpm test
```

The current automated tests live in `plugin/test/` and cover the state machine, token tracking, shared session store, and WebSocket protocol.

## Environment Variables

### Plugin

| Variable | Default | Purpose |
| --- | --- | --- |
| `AVATAR_WS_PORT` | `2728` | Port used by the plugin WebSocket server. |
| `AVATAR_INSTANCE_ID` | random UUID per process | Optional stable ID for a plugin process when writing shared state snapshots. |
| `AVATAR_LOG_LEVEL` | `info` | Plugin log verbosity: `debug`, `info`, `warn`, or `error`. |
| `AVATAR_LOG_STDERR` | unset | When set to `1`, mirrors plugin logs to stderr in addition to `~/.opencode-avatar/logs/plugin.log`. |

### App

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_AVATAR_WS_URL` | `ws://127.0.0.1:2728` | WebSocket URL used by the PixiJS client. |
| `VITE_LOG_LEVEL` | `info` | Frontend console log verbosity: `debug`, `info`, `warn`, or `error`. |
| `VITE_DEBUG` | unset | Enables frontend debug mode when set to `1`. |

Example:

```bash
export AVATAR_WS_PORT=3001
export AVATAR_LOG_LEVEL=debug

# Launch OpenCode in the same environment so the plugin inherits these values.
VITE_AVATAR_WS_URL=ws://127.0.0.1:3001 VITE_LOG_LEVEL=debug VITE_DEBUG=1 corepack pnpm --dir app tauri:dev
```

To change the plugin WebSocket port, export `AVATAR_WS_PORT` in the environment used to launch OpenCode.

## Logging

- The plugin writes newline-delimited JSON logs to `~/.opencode-avatar/logs/plugin.log`.
- The plugin also writes per-process session snapshots to `~/.opencode-avatar/state/` so one plugin instance can merge sessions from multiple OpenCode processes.
- The plugin now also writes cross-process command and result files in that state directory (`cmd-*.json`, `result-*.json`).
- The frontend TypeScript logger currently writes structured logs to the browser console and respects `VITE_LOG_LEVEL` and `VITE_DEBUG`.
- The Tauri Rust shell enables `tauri-plugin-log` in debug builds, but this repo does not currently configure the frontend app to persist its own logs into `~/.opencode-avatar/logs/`.

## Current Notes

- This documentation describes the repository as it exists now, not the original design plan.
- The plugin and app are intentionally decoupled through the shared protocol and local WebSocket boundary.
- The app is currently centered on rendering session robots, token-driven flame effects, and connection state, rather than a broader control surface.
