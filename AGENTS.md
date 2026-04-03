# AGENTS.md

This file gives coding agents the repo-specific context they need to work safely in `opencode-avatar`.

## Purpose

`opencode-avatar` is a pnpm workspace for a desktop overlay that visualizes OpenCode activity.

The product has two runtime pieces:

- `app/`: a Tauri 2 desktop shell with a Vite + PixiJS frontend
- `plugin/`: an OpenCode plugin that tracks session state and serves it over a local WebSocket

Shared protocol types live in `shared/`.

## Repo Layout

- `app/`: overlay UI, Tauri shell, generated app icons
- `plugin/`: OpenCode plugin runtime, session state machine, token tracking, WS server
- `shared/`: shared state and protocol definitions
- `docs/`: release, configuration, architecture, troubleshooting, and assets
- `scripts/`: local release helpers
- `.github/workflows/`: CI, commit enforcement, release automation

Primary docs:

- Consumer entry point: [`README.md`](README.md)
- Developer entry point: [`README-dev.md`](README-dev.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Configuration: [`docs/configuration.md`](docs/configuration.md)
- Release process: [`docs/release.md`](docs/release.md)
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)

## Development Commands

Install dependencies:

```bash
corepack pnpm install
```

Build the workspace:

```bash
corepack pnpm build
```

Run tests:

```bash
corepack pnpm test
```

Watch the plugin during development:

```bash
corepack pnpm dev:plugin
```

Run the Tauri app in development:

```bash
corepack pnpm --dir app tauri:dev
```

Run the Vite frontend only:

```bash
corepack pnpm dev:app
```

Build the local v1 release bundle:

```bash
corepack pnpm release:v1
```

That command writes local artifacts into the ignored `release/` directory.

## Runtime Notes

- The plugin is not a standalone daemon. OpenCode loads `plugin/dist/index.js`.
- During development, register the local plugin directory in `~/.config/opencode/config.json`.
- Default WebSocket URL/port is `ws://127.0.0.1:2728`.
- Plugin logs live at `~/.opencode-avatar/logs/plugin.log`.
- Shared state and cross-process command/result files live in `~/.opencode-avatar/state/`.

## Release Model

V1 is released as two artifacts:

- a macOS `.dmg` for the desktop app
- a plugin `.zip` that the user unpacks and registers in OpenCode config

Automated release flow:

- conventional commits feed `release-please`
- `release-please` opens/updates a release PR and bumps versions in the repo
- merging that release PR creates the GitHub Release and tag
- the release asset workflow builds and uploads the `.dmg` and plugin `.zip`

Published artifacts are distributed from:

- <https://github.com/tcamise-gpsw/opencode-avatar/releases>

## Commit And PR Rules

This repo enforces both:

- semantic PR titles via `.github/workflows/semantic-pr-title.yml`
- conventional commit messages via `.github/workflows/commitlint.yml`

Use formats like:

- `feat(app): add maximize mode`
- `fix(plugin): clear stale tool state`
- `docs(readme): clarify installation`
- `chore(ci): add release workflow`

## Editing Guidance

- Keep `README.md` consumer-facing.
- Put developer workflow detail in `README-dev.md` or focused docs under `docs/`.
- Prefer updating existing docs over duplicating the same instructions in multiple places.
- If you change release behavior, update both `README-dev.md` and `docs/release.md`.
- If you change runtime env vars, paths, or logging behavior, update `docs/configuration.md`.
- If you change protocol, cross-process routing, or runtime boundaries, update `docs/architecture.md`.

## Assets

- The app icon set under `app/src-tauri/icons/` is generated from [`docs/robot-icon.svg`](docs/robot-icon.svg).
- If the app icons need to be regenerated, use:

```bash
corepack pnpm --dir app tauri icon ../docs/robot-icon.svg
```

## CI Workflows

- `ci.yml`: workspace tests/build plus macOS Tauri shell validation
- `commitlint.yml`: conventional commit enforcement
- `semantic-pr-title.yml`: PR title enforcement
- `release-please.yml`: automated versioning and release PRs
- `release-assets.yml`: build/upload release artifacts for published GitHub Releases

## Cautions

- Do not revert unrelated worktree changes you did not create.
- The repo may contain local planning artifacts under `docs/superpowers/`; do not assume untracked files there are yours to commit.
- The current release workflow builds unsigned macOS artifacts. Signing/notarization is a separate concern.
