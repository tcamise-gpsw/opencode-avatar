# Release Guide

## V1 release shape

Each release publishes a single `opencode-avatar_<version>.zip` to [GitHub Releases](https://github.com/tcamise-gpsw/opencode-avatar/releases).

The zip contains:

- `install.sh` — installer script
- `opencode-avatar_<version>_<arch>.dmg` — macOS desktop app
- `opencode-avatar-plugin/` — OpenCode plugin bundle

## End-user install flow

1. Download and unzip `opencode-avatar_<version>.zip`
2. Run `./install.sh`
3. Start or restart OpenCode
4. Launch the app

The install script copies the app to `/Applications`, places the plugin in `~/Library/Application Support/opencode-avatar/`, and registers it in `~/.config/opencode/config.json`.

To update, download the latest release and run `./install.sh` again.

## Distribution notes

- The app currently targets macOS and uses macOS private API for overlay behavior.
- The current release workflow produces an Apple Silicon (`aarch64`) DMG.
- If you want external distribution beyond local use, add code signing and notarization to the Tauri app release process.
- The plugin bundle is produced with `pnpm deploy --legacy` because the workspace still depends on a local shared package during packaging.

## Automated versioning and releases

This repository uses conventional commits with `release-please`:

- merged commits on `main` determine the next semantic version
- `release-please` opens or updates a release PR with changelog and version bumps
- merging that release PR creates the GitHub Release and tag
- the release asset workflow builds and uploads the bundled zip to that GitHub Release

See the [consumer README](../README.md) for end-user installation and usage, and the [Developer Guide](../README-dev.md) for repository workflow details.
