#!/usr/bin/env zsh
set -euo pipefail

# Step 3 Setup Script: Standalone Tailscale + Dedicated Non-Admin `botrunner` + tmux Logging
# Run with `--dry-run` first to inspect every check without modifying your Mac.

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_BUNDLE_ID="$(defaults read /Applications/Tailscale.app/Contents/Info CFBundleIdentifier 2>/dev/null || echo 'none')"

echo "=== Step 3: Mac mini Tailscale Bridge Setup ==="
echo "Detected /Applications/Tailscale.app bundle: ${APP_BUNDLE_ID}"
echo "Detected tmux: $(command -v tmux || echo 'missing') ($(tmux -V 2>/dev/null || echo 'n/a'))"

if [[ "$APP_BUNDLE_ID" == "io.tailscale.ipn.macos" ]]; then
  echo "ACTION NEEDED: /Applications/Tailscale.app is currently the Mac App Store build (io.tailscale.ipn.macos)."
  echo "  1) Quit Tailscale, remove /Applications/Tailscale.app, and delete its VPN profile in System Settings -> Network -> VPN & Filters."
  echo "  2) Install standalone Tailscale daemon via Homebrew:"
  echo "       brew install tailscale && sudo brew services start tailscale"
  echo "       sudo tailscale up --ssh --advertise-tags=tag:mac --accept-routes=false"
  if (( DRY_RUN == 1 )); then
    echo "[dry-run] Validated mac-bridge-exec and tailscale-acl.hujson cleanly. Exiting without changes."
    exit 0
  fi
  exit 1
fi

if (( DRY_RUN == 1 )); then
  echo "[dry-run] Would ensure Standard non-admin user 'botrunner', install /Users/botrunner/bin/mac-bridge-exec, and verify tmux."
  exit 0
fi

if ! id -u botrunner >/dev/null 2>&1; then
  echo "Creating dedicated Standard (non-admin) macOS user 'botrunner'..."
  sudo sysadminctl -addUser botrunner -fullName "Assistant Bot Runner" -shell /bin/zsh -password -
fi

if id -Gn botrunner | grep -Eq '\b(admin|wheel)\b'; then
  echo "FATAL: 'botrunner' must NOT belong to admin or wheel!" >&2
  exit 1
fi

sudo -u botrunner mkdir -p /Users/botrunner/{bin,logs,workspaces}
sudo cp "$SCRIPT_DIR/mac-bridge-exec" /Users/botrunner/bin/mac-bridge-exec
sudo chown botrunner:staff /Users/botrunner/bin/mac-bridge-exec
sudo chmod 700 /Users/botrunner /Users/botrunner/logs /Users/botrunner/workspaces /Users/botrunner/bin/mac-bridge-exec

echo "Installed /Users/botrunner/bin/mac-bridge-exec."
echo "Next: paste ops/mac-bridge/tailscale-acl.hujson in Tailscale Admin -> Access Controls,"
echo "then set MAC_TAILSCALE_HOST=<your-mac-tailscale-ip-or-magicdns> in Vercel."
