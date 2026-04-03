# Release Guide

## V1 release shape

V1 is packaged as two deliverables:

- a macOS Tauri app installer for the overlay
- a portable OpenCode plugin bundle that users register from disk

OpenCode currently loads the plugin from a configured filesystem path, so this is a two-artifact release instead of a single installer.

## Build the release bundle

From the workspace root:

```bash
corepack pnpm release:v1
```

For local builds, the artifacts land in the local `release/` directory.

For published versions, the same artifacts are attached to the matching [GitHub Release](https://github.com/tcamise-gpsw/opencode-avatar/releases).

That command:

1. builds the workspace
2. builds the packaged Tauri app
3. creates a standalone plugin bundle with production dependencies
4. writes everything into `release/`

## Release output

The `release/` directory contains:

- `opencode-avatar_<version>_<arch>.dmg`
- `opencode-avatar-plugin/`
- `opencode-avatar-plugin_<version>.zip`

The unpacked plugin directory is useful for local install testing. The zip is the distribution artifact.

## End-user install flow

1. Install the `.dmg`
2. Unzip `opencode-avatar-plugin_<version>.zip` into a stable location
3. Add that plugin directory to `~/.config/opencode/config.json`
4. Start or restart OpenCode

Example config:

```json
{
  "plugin": [
    "/Users/you/Library/Application Support/opencode-avatar/opencode-avatar-plugin"
  ]
}
```

## Distribution notes

- The app currently targets macOS and uses macOS private API for overlay behavior.
- The current local build produces an Apple Silicon (`aarch64`) DMG.
- If you want external distribution beyond local use, add code signing and notarization to the Tauri app release process.
- The plugin bundle is produced with `pnpm deploy --legacy` because the workspace still depends on a local shared package during packaging.

## Automated versioning and releases

This repository uses conventional commits with `release-please`:

- merged commits on `main` determine the next semantic version
- `release-please` opens or updates a release PR with changelog and version bumps
- merging that release PR creates the GitHub Release and tag
- the release asset workflow builds and uploads the `.dmg` and plugin bundle to that GitHub Release

See the [consumer README](../README.md) for end-user installation and usage, and the [Developer Guide](../README-dev.md) for repository workflow details.
