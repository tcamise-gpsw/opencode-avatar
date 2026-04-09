# Configuration Guide

## OpenCode plugin registration

OpenCode loads the plugin from a filesystem path. Add the plugin directory to `~/.config/opencode/config.json`:

```json
{
  "plugin": [
    "/absolute/path/to/opencode-avatar/plugin"
  ]
}
```

For release installs, point this at the unpacked `opencode-avatar-plugin/` directory instead.

## Environment variables

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

## Runtime paths

- Plugin logs: `~/.opencode-avatar/logs/plugin.log`
- Shared state snapshots: `~/.opencode-avatar/state/*.json`
- Cross-process command files: `~/.opencode-avatar/state/cmd-*.json`
- Cross-process result files: `~/.opencode-avatar/state/result-*.json`

## Logging behavior

- The plugin writes newline-delimited JSON logs to `~/.opencode-avatar/logs/plugin.log`.
- The plugin also writes per-process session snapshots to `~/.opencode-avatar/state/` so one plugin instance can merge sessions from multiple OpenCode processes.
- The plugin writes cross-process command and result files in that state directory (`cmd-*.json`, `result-*.json`).
- The frontend TypeScript logger writes structured logs to the browser console and respects `VITE_LOG_LEVEL` and `VITE_DEBUG`.
- The Tauri Rust shell enables `tauri-plugin-log` in debug builds, but the repo does not currently persist frontend logs into `~/.opencode-avatar/logs/`.

See the [Troubleshooting Guide](troubleshooting.md) for live log tailing and diagnostic workflows.
