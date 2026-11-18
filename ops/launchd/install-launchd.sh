#!/usr/bin/env zsh
set -euo pipefail

# Lightweight macOS launchd installer for the 8 GB RAM Mac mini queue worker.
# Bundles scripts/mac-worker.ts into a tiny standalone .mjs file so Node runs
# with --jitless --max-old-space-size=24 (~3.5 MB V8 heap, zero tsx bloat).

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
LOG_DIR="${WORKER_LOG_DIR:-$HOME/Library/Logs/assistant-queue-worker}"
BUNDLE_DIR="$REPO_ROOT/.next/worker"
WORKER_BUNDLE="$BUNDLE_DIR/scripts/mac-worker.js"
PLIST_TEMPLATE="$REPO_ROOT/ops/launchd/com.assistant.queue-worker.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.assistant.queue-worker.plist"

mkdir -p "$LOG_DIR" "$BUNDLE_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$LOG_DIR"

echo "Bundling lightweight worker entrypoint -> $WORKER_BUNDLE"
cd "$REPO_ROOT"
npx pnpm@10.32.1 run worker:build

sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__WORKER_BUNDLE__|$WORKER_BUNDLE|g" \
  -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$PLIST_TEMPLATE" > "$PLIST_DEST"

chmod 600 "$PLIST_DEST"
plutil -lint "$PLIST_DEST"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Dry-run complete. Validated plist at $PLIST_DEST (not loaded)."
  exit 0
fi

GUI_DOMAIN="gui/$(id -u)"
launchctl bootout "$GUI_DOMAIN/com.assistant.queue-worker" 2>/dev/null || true
launchctl bootstrap "$GUI_DOMAIN" "$PLIST_DEST"
launchctl kickstart -k "$GUI_DOMAIN/com.assistant.queue-worker"

echo "Installed and started com.assistant.queue-worker."
echo "Health check: curl -fsS http://127.0.0.1:4319/healthz"
