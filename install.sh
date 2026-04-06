#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="opencode-avatar.app"
PLUGIN_DIR_NAME="opencode-avatar-plugin"
PLUGIN_INSTALL_DIR="$HOME/Library/Application Support/opencode-avatar/$PLUGIN_DIR_NAME"
OPENCODE_CONFIG="$HOME/.config/opencode/config.json"

# ── Locate the DMG ──────────────────────────────────────────────────────────

shopt -s nullglob
dmg_files=("$SCRIPT_DIR"/*.dmg)

if [ ${#dmg_files[@]} -eq 0 ]; then
	printf 'Error: no .dmg found in %s\n' "$SCRIPT_DIR" >&2
	exit 1
fi

dmg="${dmg_files[0]}"

# ── Locate the plugin bundle ───────────────────────────────────────────────

if [ ! -d "$SCRIPT_DIR/$PLUGIN_DIR_NAME" ]; then
	printf 'Error: plugin directory %s not found\n' "$SCRIPT_DIR/$PLUGIN_DIR_NAME" >&2
	exit 1
fi

# ── Install the app ────────────────────────────────────────────────────────

printf 'Installing %s to /Applications...\n' "$APP_NAME"
mount_point="$(mktemp -d "/tmp/opencode-avatar-dmg.XXXXXX")"
hdiutil attach "$dmg" -nobrowse -noverify -quiet -mountpoint "$mount_point"
trap 'hdiutil detach "$mount_point" -quiet 2>/dev/null' EXIT

run=()
if [ ! -w /Applications ]; then
	printf '  Elevated privileges required for /Applications.\n'
	sudo -v || {
		printf 'Error: failed to acquire sudo.\n' >&2
		exit 1
	}
	run=(sudo)
fi

if [ -d "/Applications/$APP_NAME" ]; then
	"${run[@]}" rm -rf "/Applications/$APP_NAME"
fi

"${run[@]}" cp -R "$mount_point/$APP_NAME" /Applications/
hdiutil detach "$mount_point" -quiet
trap - EXIT
printf '  Done.\n'

# ── Install the plugin ─────────────────────────────────────────────────────

printf 'Installing plugin to %s...\n' "$PLUGIN_INSTALL_DIR"
mkdir -p "$(dirname "$PLUGIN_INSTALL_DIR")"

if [ -d "$PLUGIN_INSTALL_DIR" ]; then
	rm -rf "$PLUGIN_INSTALL_DIR"
fi

cp -R "$SCRIPT_DIR/$PLUGIN_DIR_NAME" "$PLUGIN_INSTALL_DIR"
printf '  Done.\n'

# ── Register plugin in OpenCode config ─────────────────────────────────────

printf 'Registering plugin in %s...\n' "$OPENCODE_CONFIG"
mkdir -p "$(dirname "$OPENCODE_CONFIG")"

if [ ! -f "$OPENCODE_CONFIG" ]; then
	# No config exists — create one with the plugin entry.
	cat >"$OPENCODE_CONFIG" <<-JSON
		{
		  "plugin": [
		    "$PLUGIN_INSTALL_DIR"
		  ]
		}
	JSON
	printf '  Created config with plugin entry.\n'
elif ! command -v node &>/dev/null; then
	printf '  Warning: node not found — cannot update config automatically.\n'
	printf '  Add this manually to %s:\n' "$OPENCODE_CONFIG"
	printf '    "plugin": ["%s"]\n' "$PLUGIN_INSTALL_DIR"
else
	# Use node to safely merge the plugin path into existing config.
	node -e "
		const fs = require('fs');
		const path = '$PLUGIN_INSTALL_DIR';
		const file = '$OPENCODE_CONFIG';
		const config = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (!Array.isArray(config.plugin)) config.plugin = [];
		if (!config.plugin.includes(path)) config.plugin.push(path);
		fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
	"
	printf '  Done.\n'
fi

# ── Summary ────────────────────────────────────────────────────────────────

printf '\nInstallation complete.\n'
printf '  App:    /Applications/%s\n' "$APP_NAME"
printf '  Plugin: %s\n' "$PLUGIN_INSTALL_DIR"
printf '  Config: %s\n' "$OPENCODE_CONFIG"
printf '\nStart or restart OpenCode, then launch the app.\n'
