#!/usr/bin/env zsh
set -euo pipefail

# Emergency <1s local cutoff on the Mac mini:
# Terminates every running tmux session and CLI child process under `botrunner`
# and disables Tailscale SSH immediately.

echo "Stopping all botrunner tmux & CLI processes..."
sudo pkill -9 -u botrunner 2>/dev/null || true

if command -v tailscale >/dev/null 2>&1; then
  sudo tailscale set --ssh=false || true
fi

echo "Revoked local Mac bridge access. Also remove 'assistant-computer-01' (tag:bot) and revoke its key in https://login.tailscale.com/admin/machines."
