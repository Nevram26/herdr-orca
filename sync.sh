#!/bin/sh
# Copies this layout's mods and layout from your Herdr home into the repo, so a commit
# captures what you're running. Leaves out the type files Herdr writes itself.
set -e
cd "$(dirname "$0")"
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
for mod in mods/*/; do
  name=$(basename "$mod")
  rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json \
    --exclude node_modules --exclude .cache --exclude .DS_Store --exclude CHANGES.md \
    "$HOME_DIR/mods/$name/" "mods/$name/"
done
# The layout is orca-2 in the author's Herdr; here it's orca.
jq 'del(.cloned_from)' "$HOME_DIR/layouts/orca-2.json" > layouts/orca.json
echo "Synced $(ls mods | wc -l | tr -d ' ') mods and layouts/orca.json"
