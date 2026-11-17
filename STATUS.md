# Personal Assistant — Current Status

**Updated:** 17 November 2026  
**Preview URL:** `https://general-purpose-agent-quickstart-git-feat-9b1f26-csahingoz-3779.vercel.app` (`● Ready`)  
**State:** **PHASE 4 STEPS 1–3 COMPLETE & READY FOR REVIEW** (Paused after Step 3 per owner instruction before Steps 4–7)

- **Phase 4 Capability Ladder Plan:** [docs/parity/PHASE4-PLAN.md](./docs/parity/PHASE4-PLAN.md)
- **Detailed Delivery & Verification Report:** [docs/parity/STATUS.md](./docs/parity/STATUS.md)
- **Plain-English Owner Guide:** [docs/OWNER_GUIDE.md](./docs/OWNER_GUIDE.md)
- **Infrastructure & Ultra 5x Budget (`£/month`):** [docs/parity/BUDGET.md](./docs/parity/BUDGET.md)

## Phase 4 (Steps 1–3) Snapshot

| Rung | Delivered | Status |
| :--- | :--- | :--- |
| **Step 1 — Agent Loop, Task/Connect Cards & Live Voice Tools** | Shared tool registry across Text Chat & Gemini 3.8 Live (`gmailReadMessages`, `calendarReadEvents`, `driveReadFiles`, `getWeather` via Open-Meteo, `webSearch`, `recallMemories`, `listMySchedules`, `delegateTask`, approval-gated drafts), spoken fillers (`"Checking your inbox…"`), mirrored chat cards (`TaskCard`, 1-tap `ConnectorConnectCard`, `ApprovalCard`), owner name (`Çağlar`), `Europe/London`, EN/TR matching, 8-step agent loop | **LIVE (`● Ready`)** |
| **Step 2 — Cloud Computer (A): Sandboxed GCP Linux VM** | Provisioned `assistant-computer-01` (`e2-medium`, Ubuntu 24.04 LTS, 30 GB persistent `/workspace`, `europe-west1-b`) + scale-to-zero Cloud Run relay (`assistant-computer-relay`, internal VPC only, auto-wake + 20-min idle auto-stop, `169.254.169.254` metadata blocked, **£0 net** on $40/mo Ultra credit) + `cloudExec` / `cloudWriteFile` / `cloudExportFileToChat` / `cloudBrowseUrl` | **LIVE (`● Ready`)** |
| **Step 3 — Mac mini Bridge (B): Tailscale SSH + `tmux` + CLIs** | `macExec` & `macRunAgentCli` (`claude`, `codex`, `agy`, `t3`; `copilot`/`cursor` opt-in only), 8 GB Mac governor (`≤3` agents, `≤1` `/tmp/assistant-build.lock`, `1.2 GB` free-RAM floor), `ops/mac-bridge/mac-bridge-exec` (`tmux` + `tmux pipe-pane` redacted `.pty.log` & `commands.jsonl`), `tailscale-acl.hujson` (`tag:bot` → `tag:mac:22` as `botrunner` only, `check` mode re-auth, zero Funnel, no `sudo`), setup & `<1s` revocation scripts | **LIVE (`● Ready`)** |
