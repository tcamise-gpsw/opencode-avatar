# Troubleshooting and Log Guide

This guide focuses on diagnosing state/render issues in the avatar overlay.

## Quick triage checklist

1. Confirm OpenCode loaded the latest plugin build (`plugin/dist/index.js`).
2. Confirm overlay app is connected to plugin WebSocket (`ws://127.0.0.1:2728` by default).
3. Check plugin logs for `session_state_summary` and `tool_start`/`tool_end` patterns.

## Important paths

- Plugin logs: `~/.opencode-avatar/logs/plugin.log`
- Shared state snapshots: `~/.opencode-avatar/state/*.json`
- Cross-process command files: `~/.opencode-avatar/state/cmd-*.json`
- Cross-process result files: `~/.opencode-avatar/state/result-*.json`

## Enable debug logging

Launch OpenCode with plugin debug logs enabled:

```bash
AVATAR_LOG_LEVEL=debug opencode
```

Optional (mirror plugin logs to stderr too):

```bash
AVATAR_LOG_LEVEL=debug AVATAR_LOG_STDERR=1 opencode
```

## Tail logs live

```bash
tail -f ~/.opencode-avatar/logs/plugin.log
```

## State diagnosis signals

The plugin now emits an info-level `session_state_summary` record on major transitions.

Useful fields:

- `reason` (for example: `tool.before:read`, `tool.after:bash`, `session.idle`, `permission.ask`)
- `state`
- `label`
- `tokenRate`
- `activeToolCount`
- `activeTools`
- `isThinking`
- `hasWaiting`
- `hasError`

If a session looks stuck as running/smiley, look for:

- repeated `session_state_summary` with `state: running`
- `activeToolCount > 0`
- missing matching `tool.after:*` transitions

## Common symptom: smiley/running for too long

Expected behavior:

- `running` while a running-class tool is active
- `reading` while read/grep/glob tools are active
- `idle` when tool stack is empty and there is no waiting/error/thinking condition

What to inspect:

1. `session_state_summary` for current session
2. `tool_start` and `tool_end` debug records for that session
3. Current snapshot file under `~/.opencode-avatar/state/`

## Check current merged snapshot quickly

```bash
ls ~/.opencode-avatar/state/*.json
```

Then inspect the active snapshot file and confirm:

- `state`
- `label`
- `pendingPermission`
- `tokens.rate`

## Known operational gotcha

The plugin runs inside OpenCode and is loaded from `plugin/dist/index.js`.

After plugin source changes:

1. Rebuild plugin dist
2. Restart OpenCode processes

Otherwise, logs/state behavior may reflect older plugin code.

See the [Configuration Guide](configuration.md) for environment variables and runtime paths, and the [Developer Guide](../README-dev.md) for local development workflow.
