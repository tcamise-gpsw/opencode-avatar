# OpenCode Avatar Overlay

<p align="center">
  <img src="docs/robot-banner.svg" alt="OpenCode Avatar robots showing idle, thinking, reading, editing, running, waiting, and error states" width="100%" />
</p>

Does your OpenCode session need some personality? Are you sick of alt-tabbing back to the terminal just to see if your agent is still thinking, stuck on a permission prompt, or burning tokens like it's going out of style? Is your workflow missing a tiny robot companion that actually tells you what's going on?

Then **OpenCode Avatar** is the project for you.

## Overview

OpenCode Avatar Overlay is a desktop companion for OpenCode that shows active sessions as an always-on-top overlay.

The overlay gives you a live view of what OpenCode is doing without switching back to the terminal.

Current behavior includes:

- one robot per active session
- live state changes for reading, editing, running, waiting, error, and idle states
- token-rate flame effects
- hover previews of the latest assistant response
- prompt input and permission replies from the overlay
- a maximize option to view the status at a glance when you're walking by your computer

## Installation

It ships as a single `.zip` containing the macOS desktop app, the OpenCode plugin, and an install script.

If you are building from source instead, see the [Developer Guide](README-dev.md) and [Release Guide](docs/release.md).

### 1. Download and unzip

Download `opencode-avatar_<version>.zip` from [GitHub Releases](https://github.com/tcamise-gpsw/opencode-avatar/releases) and unzip it.

### 2. Run the install script

```bash
cd opencode-avatar
./install.sh
```

The script:

- installs the app to `/Applications`
- copies the plugin to `~/Library/Application Support/opencode-avatar/`
- registers the plugin in `~/.config/opencode/config.json`

### 3. Start OpenCode

Start or restart OpenCode so it loads the plugin.

The plugin opens a local WebSocket server on `ws://127.0.0.1:2728` by default.

### 4. Launch the desktop app

Open the installed OpenCode Avatar app.

If the plugin is running, the overlay should connect automatically and begin rendering active sessions.

Expected success signals:

- the app opens without staying stuck in reconnect mode
- robots appear when OpenCode sessions are active
- the plugin log contains `plugin_ready`

To update, download the latest release and run `./install.sh` again.

## Usage

<p align="center">
  <img src="docs/demo.gif" alt="OpenCode Avatar overlay demo" width="600" />
</p>

### Watch session state

Each active OpenCode session appears as a robot in the overlay. The robot updates as the session changes state.

### Hover for response preview

Hover a robot to see a short preview of the latest assistant response.

### Click to send a prompt

Click a robot to open the prompt input panel, type a message, and send it back to that session.

### Reply to permission requests

When a session is waiting on permission, the overlay shows an Allow/Deny popup next to the robot.

## Troubleshooting

- Confirm OpenCode is running with the plugin enabled.
- Confirm the plugin path in `~/.config/opencode/config.json` points to the unpacked `opencode-avatar-plugin/` directory.
- Confirm the overlay can connect to `ws://127.0.0.1:2728`.
- Check plugin logs at `~/.opencode-avatar/logs/plugin.log`.

See the [Troubleshooting Guide](docs/troubleshooting.md) for more detail.

## More Information

- [Developer Guide](README-dev.md)
- [Release Guide](docs/release.md)
- [Configuration Guide](docs/configuration.md)
- [Troubleshooting Guide](docs/troubleshooting.md)
