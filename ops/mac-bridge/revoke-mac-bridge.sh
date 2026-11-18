#!/usr/bin/env zsh
set -euo pipefail

# Emergency <1s local cutoff on the Mac mini:
# Terminates every running tmux session and CLI child process under `botrunner`
# and disables Tailscale SSH immediately. Pass `--dry-run` to verify without disconnecting.

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

BOTRUNNER_PROCS="$({ pgrep -u botrunner 2>/dev/null || true; } | wc -l | tr -d ' ')"
TS_BIN="$(command -v tailscale || echo '/opt/homebrew/bin/tailscale')"

if (( DRY_RUN == 1 )); then
  echo "[dry-run] Kill switch ready: would terminate ${BOTRUNNER_PROCS} botrunner process(es) via 'sudo pkill -9 -u botrunner' and run 'sudo ${TS_BIN} set --ssh=false' (no TS_AUTHKEY revocation needed when paired interactively)."
  exit 0
fi

echo "Stopping all botrunner tmux & CLI processes..."
sudo pkill -9 -u botrunner 2>/dev/null || true

if [[ -x "$TS_BIN" ]]; then
  sudo "$TS_BIN" set --ssh=false || true
fi

echo "Revoked local Mac bridge access. To remove the cloud node completely, delete 'assistant-computer-01' (tag:bot) in https://login.tailscale.com/admin/machines."
