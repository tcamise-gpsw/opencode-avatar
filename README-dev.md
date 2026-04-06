# OpenCode Avatar Overlay Developer Guide

This document is the developer entry point for the repository.

## Project Layout

- [`app/`](app/): Tauri 2 + Vite + PixiJS overlay app
- [`plugin/`](plugin/): OpenCode plugin, session state machine, token tracking, WebSocket server
- [`shared/`](shared/): shared protocol and state definitions used by both sides
- [`docs/`](docs/): architecture, configuration, release, and troubleshooting docs

## Development Setup

Prerequisites:

- Node.js with Corepack enabled
- `pnpm` via Corepack
- Rust toolchain for Tauri builds
- platform dependencies required by Tauri 2

Install dependencies:

```bash
corepack pnpm install
```

Register the local plugin in `~/.config/opencode/config.json`:

```json
{
  "plugin": [
    "/Users/tcamise/gopro/opencode-avatar/plugin"
  ]
}
```

OpenCode loads `plugin/dist/index.js`, so keep that build output current while developing.

## Local Development Workflow

Run the plugin build watcher in one terminal:

```bash
corepack pnpm dev:plugin
```

Start OpenCode in the same environment so the plugin loads.

Run the desktop app in another terminal:

```bash
corepack pnpm --dir app tauri:dev
```

If you only want the frontend without the Tauri shell:

```bash
corepack pnpm dev:app
```

Defaults expect the plugin WebSocket server at `ws://127.0.0.1:2728`.

## Build And Test

Build the workspace:

```bash
corepack pnpm build
```

Run tests:

```bash
corepack pnpm test
```

Build the packaged Tauri app only:

```bash
corepack pnpm --dir app tauri:build
```

## Important Dev Note

After plugin source changes:

1. rebuild `plugin/dist/`
2. restart the relevant OpenCode processes

Otherwise OpenCode may still be running older plugin code.

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Configuration Guide](docs/configuration.md)
- [Release Guide](docs/release.md)
- [Troubleshooting Guide](docs/troubleshooting.md)

## CI And Releases

- [CI workflow](.github/workflows/ci.yml): runs tests and build validation on pull requests and `main`
- [Semantic PR title workflow](.github/workflows/semantic-pr-title.yml): enforces conventional-commit PR titles
- [Commitlint workflow](.github/workflows/commitlint.yml): enforces conventional commits across pushed and pull-request commit ranges
- [Release Please workflow](.github/workflows/release-please.yml): versions the repo from conventional commits and creates release PRs
- [Release assets workflow](.github/workflows/release-assets.yml): builds the `.dmg` and plugin bundle and uploads them to published GitHub Releases

Published artifacts are distributed from [GitHub Releases](https://github.com/tcamise-gpsw/opencode-avatar/releases).

Preferred format examples:

- `feat(app): add maximize mode`
- `fix(plugin): clear stale tool state`
- `docs(readme): clarify installation`

## Operational Signals

Expected success signals during development:

- OpenCode loads the plugin and `~/.opencode-avatar/logs/plugin.log` contains `plugin_ready`
- the overlay stops reconnecting and begins rendering robots for active sessions
