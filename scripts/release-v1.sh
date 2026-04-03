#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
PLUGIN_RELEASE_DIR="$RELEASE_DIR/opencode-avatar-plugin"
BUNDLE_DIR="$ROOT_DIR/app/src-tauri/target/release/bundle"
VERSION="$(node -e "const fs = require('fs'); const file = process.argv[1]; console.log(JSON.parse(fs.readFileSync(file, 'utf8')).version);" "$ROOT_DIR/app/src-tauri/tauri.conf.json")"
PLUGIN_ZIP="$RELEASE_DIR/opencode-avatar-plugin_${VERSION}.zip"

cd "$ROOT_DIR"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

corepack pnpm build
corepack pnpm --dir app tauri:build
corepack pnpm --filter @opencode-avatar/plugin --prod deploy --legacy "$PLUGIN_RELEASE_DIR"

# Keep the shipped plugin bundle focused on the runtime entrypoint and dependencies.
rm -rf "$PLUGIN_RELEASE_DIR/src" "$PLUGIN_RELEASE_DIR/test"
rm -f "$PLUGIN_RELEASE_DIR/tsconfig.json" "$PLUGIN_RELEASE_DIR/vitest.config.ts"

shopt -s nullglob
dmg_files=("$BUNDLE_DIR"/dmg/*.dmg)

if [ ${#dmg_files[@]} -eq 0 ]; then
	printf 'No DMG artifacts found in %s\n' "$BUNDLE_DIR/dmg" >&2
	exit 1
fi

cp "${dmg_files[@]}" "$RELEASE_DIR/"

rm -f "$PLUGIN_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$PLUGIN_RELEASE_DIR" "$PLUGIN_ZIP"

printf 'Release artifacts created in %s\n' "$RELEASE_DIR"
for dmg in "${dmg_files[@]}"; do
	printf ' - %s\n' "$(basename "$dmg")"
done
printf ' - %s\n' "$(basename "$PLUGIN_ZIP")"
printf ' - %s\n' "$(basename "$PLUGIN_RELEASE_DIR")/"
