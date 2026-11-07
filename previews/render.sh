#!/bin/sh
# Renders each previews/<name>.html to <name>/preview.png at 2x with headless Chrome.
# Usage: previews/render.sh [name ...]   (default: every page). Set CHROME to override the binary.
set -e
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
pages="${*:-$(ls *.html | sed 's/\.html$//')}"
for name in $pages; do
  size=$(sed -n 's/.*body { width: \([0-9]*\)px; height: \([0-9]*\)px.*/\1,\2/p' "$name.html" | head -1)
  out="../$name/preview.png"
  [ -d "../$name" ] || out="../preview.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=4000 --window-size="${size:-1600,1000}" \
    --screenshot="$PWD/$out" "file://$PWD/$name.html" >/dev/null 2>&1
  echo "rendered $out ($size)"
done
