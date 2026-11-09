#!/bin/sh
# Spends one Codex rate-limit reset credit and prints Codex's answer as one JSON line.
#
# Asks `codex app-server` (JSON-RPC: initialize, initialized,
# account/rateLimitResetCredit/consume); Codex authenticates itself and this script
# reads no tokens. $1 is the attempt's key: trying again with the same key can't
# spend a second credit.
#
# Exit: 0 = printed the answer, 127 = codex CLI not found, 2 = bad key,
# 1 = no answer in 30 s, so it's unknown whether a credit was spent.
# Override the binary with HERDR_USAGE_CODEX_BIN.

CODEX=$(command -v "${HERDR_USAGE_CODEX_BIN:-codex}" 2>/dev/null) || exit 127

# The key goes into the JSON below.
case "$1" in ''|*[!0-9a-z-]*) exit 2 ;; esac

dir=$(mktemp -d "${TMPDIR:-/tmp}/herdr-codex-reset.XXXXXX") || exit 1
out="$dir/out"

# A plain pipe, not a FIFO, as in codex-limits.sh.
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"herdr-usage-limits","version":"1.0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"initialized"}'
  printf '{"jsonrpc":"2.0","id":2,"method":"account/rateLimitResetCredit/consume","params":{"idempotencyKey":"%s"}}\n' "$1"
  i=0
  while [ "$i" -lt 150 ]; do
    if grep -q '"id":2' "$out" 2>/dev/null; then break; fi
    sleep 0.2
    i=$((i + 1))
  done
} | "$CODEX" app-server >"$out" 2>/dev/null

status=1
if grep -m1 '"id":2' "$out"; then status=0; fi
rm -rf "$dir"
exit $status
