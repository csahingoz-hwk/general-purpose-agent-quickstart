# Phase 4 — "Be Like Grok Bot" Capability Ladder Plan

> **Plan only — do not build until the owner approves.** Each rung of this 7-step ladder ships as a standalone, daily-useful upgrade.

## North Star

**You text or talk in chat, and the assistant does the work itself on a real computer** — with live progress in chat and strict approval before anything destructive, outbound, or credit-spending happens:

- **A) Its Own Cloud Computer:** A persistent, sandboxed Linux VM on your Google Cloud project (`hawkeyedlion`, billing `0140A2-72DEB2-62EDCD`, covered at **£0 net** by your $40/mo Google AI Ultra credit) with `bash`, persistent `/workspace` files, `git`, Python/Node, and headless Playwright Chromium.
- **B) Your Mac mini (8 GB RAM):** Reached from Cloud Computer (A) (`tag:bot`) over a locked-down **Tailscale SSH** bridge to **standalone Tailscale** on the Mac (`tag:mac`) as a single dedicated non-admin macOS user (`botrunner`) — running every command inside **`tmux`** with full session logging, driving isolated git worktrees and your `claude`, `codex`, `agy`, and `t3` CLIs within the **8 GB limits** (`≤3` concurrent agents, `≤1` build at a time), with **no `sudo`** and **zero Tailscale Funnel**.
- **C) Visual Browser & Desktop Control (Later):** Computer-use agent streaming live screenshots into chat — first inside Cloud Computer (A)'s virtual display (`Xvfb` + VNC), then optionally on your Mac via macOS Accessibility under strict per-action approval.

### Non-Negotiable Global Rules
1. **Model floor:** Never use `Gemini 3.8 Flash` or any `3.x` text/subagent model (`gemini-4-hydrogen` minimum; `gemini-3.8-live` is isolated to the single constant `DEFAULT_LIVE_MODEL` in `lib/voice/live-protocol.ts` and flips to `gemini-4-live` in one line on release day).
2. **Korn Ferry / employer data firewall:** Zero employer/client data ever leaves to **Cloud Computer (A)**, personal Google/Colab/Flow/`agy`, Suno, `kie.ai`, Lovable, DeepSeek, or free OpenRouter (`containsRestrictedWorkData` hard-blocks pre-flight).
3. **8 GB RAM Mac mini ceiling:** `≤3` concurrent CLI agents, `≤1` global `/tmp/assistant-build.lock`, ~40 MB `launchd` poller, and `vm_stat` `<1.2 GB` free-RAM throttle; heavy containers/renders run on Cloud Computer (A) or Colab.
4. **Zero raw keys in UI & mandatory approvals:** One-tap OAuth / Mac sign-in handoff only; **every** outbound send, `git push`, destructive command, or credit spend pauses on a SHA-256 `ApprovalCard`. **GitHub Copilot Pro** and **Cursor** run **only** on explicit owner request.

---

## 7-Step Capability Ladder Overview

| Step | Rung | What You Can Do Right After It Ships | Effort |
| :--- | :--- | :--- | :---: |
| **1** *(Detailed)* | **Agent Loop + Reliable Tool Calling + Live Task Card** | Ask naturally in EN/TR; the assistant chains multi-step tool calls (`maxSteps = 8`) and updates a live inline **Task Card** right inside chat instead of acting like a one-shot chatbot. | **S–M** *(~1 session)* |
| **2** *(Detailed)* | **Cloud Computer (A): Linux VM + Shell, Files, Git & Browser** | Tell chat *"clone repo X, run the script, scrape page Y, and attach the CSV/chart"* — it executes on its own persistent Linux computer in the cloud and hands you downloadable files in chat. | **M** *(~1.5 sessions)* |
| **3** *(Detailed)* | **Mac mini Bridge (B): Tailscale SSH + `tmux` + Local CLIs** | Cloud VM (`tag:bot`) SSHes over Tailscale to dedicated non-admin `botrunner` on your Mac mini inside logged `tmux` sessions to run tests or drive `claude` / `codex` / `agy` / `t3`, pausing for approval on destructive or sending commands (`no sudo`, `never Funnel`). | **M** *(~1.5 sessions)* |
| **4** *(Brief)* | **Background Jobs + Closed-App iOS Push** | Close Safari or lock your iPhone mid-task; Cloud Computer (A) and Mac Bridge (B) finish in the background and wake your lock screen via Web Push. | **S–M** *(~1 session)* |
| **5** *(Brief)* | **Quota-Aware Multi-Subscription Routing** | Automatic limit/reset tracking and failover across all 9 subscriptions (`agy` 5x, Claude Code, Codex, T3, Gemini Pro `csahingoz`, Flow/Veo, Colab, Lovable, Suno, `kie.ai`; Copilot & Cursor opt-in only). | **M** *(~1.5 sessions)* |
| **6** *(Brief)* | **Visual Browser & Desktop Computer Use (C)** | Watch live screenshots in chat as the agent drives a visual Chromium/desktop session on Cloud Computer (A) (and later optional macOS Accessibility), pausing on logins/payments/CAPTCHAs. | **M–L** *(~2 sessions)* |
| **7** *(Brief)* | **Seamless Voice Operator on Top** | Talk hands-free (`gemini-3.8-live` → `gemini-4-live`), dispatch Step 1–6 computer work in `<80 ms`, lock your phone, and get spoken push briefings with `<100 ms` barge-in. | **S–M** *(~1 session)* |

---

## Step 1 (Detailed): Agent Loop with Tool Calling + Live Task Card in Chat

- **What you can do after Step 1:** Ask naturally (*"Did Ali email me?"*, *"Am I free Friday afternoon?"*, *"Check open PRs and draft a summary doc"*) and watch the assistant plan, call 2–6 tools in sequence, recover from tool errors, and update a clean **inline `TaskCard` inside the chat stream** with live step ticks and 1-tap **Approve / Stop** controls.
- **Effort:** **S–M (~1 session).**

### Architecture
1. **Fix brittle tool gating (`lib/ai/context/select-tools.ts`):**
   - Today, exact-phrase regexes (`check my gmail`, `save to my profile`) miss normal speech and let `isOpenQuestion("Did Ali email me?")` leak into `webSearch` while dropping write tools.
   - Replace literal verb matching with **bilingual capability-group selectors** (`PERSONAL_COMMS`, `WORKSPACE_DOCS`, `COMPUTER_AND_TASKS`, `MEMORY`, `MEDIA`, `PUBLIC_FACTS`). Pure chitchat (*"merhaba"*, *"thanks"*) still sends **0 tools**, while any task/operator turn exposes the core agent toolset.
2. **True multi-step agent loop (`app/(chat)/api/chat/route.ts`):**
   - Raise bounded `stopWhen: isStepCount(8)` on operator turns (keeping `isStepCount(3)` on simple lookups) and emit structured `data-task-step` stream events before/after each tool call (`stepIndex`, `label`, `toolName`, `status`, `elapsedMs`).
   - Persist durable `BackgroundTask` rows (`lib/ai/tools/background-task-tools.ts` + `app/api/tasks/[id]/route.ts`) so the inline card survives page reloads.
3. **Inline `TaskCard` UI (`components/chat/task-card.tsx` → `components/chat/message.tsx`):**
   - Collapsible iOS-styled card inside the assistant message showing current action, completed steps, expandable command/tool output preview, and `min-h-11` (≥44px) **Approve** / **Cancel** buttons.

### Security Model
- **Untrusted-read / state-write separation preserved:** If a step reads untrusted external text (`webSearch`, `gmailReadMessages`, `driveReadFiles`, `githubReadPullRequests`), `prepareStep` strips unapproved outbound/destructive tools unless gated by `needsApproval` + canonical SHA-256 `reviewActionRisk` digest (`lib/safety/risk-reviewer.ts`).
- **Private-query privacy:** Personal inbox/calendar/drive/repo intents hard-disable `webSearch` on that turn so private names never hit a search engine.
- **Loop & spend ceiling:** Hard `8`-step cap + existing `ModelUsage` per-turn token reservation prevents runaway agent loops.

### Cost on Ultra 5x
- **£0 incremental infra** (runs inside existing Vercel + Neon Postgres setup; chat turns stay within the existing `ModelUsage` monthly cap, with chitchat still paying 0 tool-schema tokens).

### Test Plan
1. **Unit (`tests/security/agent-loop-and-tools.test.ts`):** 35 natural EN/TR prompts verifying tool-group routing, zero-tool chitchat, `webSearch` suppression on private mail/calendar prompts, `8`-step loop cap, and untrusted-content approval escalation.
2. **Playwright Mobile E2E (`scripts/test-task-card-e2e.ts`):** In `390×844` Chrome, runs a 3-step tool turn, verifies `TaskCard` updates live (`Step 1/3 → Done`), survives page reload, and honors 1-tap `Approve` and `Cancel`.

---

## Step 2 (Detailed): Cloud Computer (A) — Sandboxed Linux VM + Shell, Files, Git & Browser

- **What you can do after Step 2:** Ask in chat: *"Clone repo X, install deps, run the Python analysis on this attached CSV, take a headless screenshot of the chart, and give me the output PDF"* — the assistant wakes **its own Linux computer**, runs real `bash` / `git` / Python / Node / Playwright commands, persists `/workspace` across turns and days, streams command output into the chat `TaskCard`, and attaches generated files back into chat via signed `/api/files/[token]` links.
- **Effort:** **M (~1.5 sessions).**

### Cloud Computer Cost & Architecture Comparison

| Option | Specs & Persistence | Raw Monthly Cost | **Your Net Cost (`£/mo`)** | Verdict |
| :--- | :--- | :--- | :---: | :--- |
| **1. GCE Auto-Suspending VM (`e2-medium`) on `hawkeyedlion`** *(Selected)* | 2 vCPU, 4 GB RAM, **30 GB ext4 Persistent Disk** (`/workspace`), Ubuntu 24.04 LTS; wakes from `SUSPENDED` in ~5s, auto-suspends after 20 min idle | ~$2.00 compute *(60 active hrs/mo)* + $3.00 disk + ~$0.40 suspend state ≈ **~$5.40/mo** *(~$27/mo even if left on 24/7)* | **£0.00 net** *(100% covered by $40/mo Ultra GCP credit on `0140A2-72DEB2-62EDCD` + Free Trial to Feb 2027)* | **WINNER:** Real persistent Linux filesystem (`git`, `apt`, `venv`, Docker/rootless, and Step 6 VNC desktop all work natively) at £0 out-of-pocket, leaving ~$34/mo of GCP credit free. |
| **2. Cloud Run Jobs / Service + GCS FUSE on `hawkeyedlion`** | Ephemeral container (`min-instances=0`) + object-bucket FUSE mount | ~$0 idle · ~$1–$3/mo active | **£0.00 net** *(covered by $40/mo GCP credit)* | **Secondary burst only:** GCS FUSE breaks POSIX file locks (`git`, SQLite, `node_modules`) and loses live shell/VNC state between turns. Keep only for stateless parallel batch jobs. |
| **3. Vercel Sandbox (`@vercel/sandbox`)** | Ephemeral Firecracker microVM; `$0.128`/active vCPU-hr + `$0.0212`/GB-hr memory + `$0.05–$0.08`/GB-mo storage | Hobby hard-pauses at free cap; Pro requires **$20/mo** seat (`$20` credit included) | **~£15.80/mo new cash** *(cannot use your $40/mo Google Cloud credit)* | **Rejected:** Costs new monthly cash, loses native ext4 VM persistence without snapshot juggling, and is awkward for Step 6 persistent VNC. |

### Architecture
```
Vercel Chat Route (`cloudShell`, `cloudFiles`, `cloudBrowser`)
   │  (HMAC-signed request + auto-wake via GCE `instances.resume` if SUSPENDED)
   ▼
Cloud Run Wake/Relay Proxy (`min-instances=0`, GCP internal VPC, `hawkeyedlion`)
   │  (internal-IP WireGuard / VPC connector — VM has ZERO public inbound ports)
   ▼
GCE `e2-medium` Linux VM (`assistant-computer-01`, Ubuntu 24.04, 30 GB ext4 `/workspace`)
   ├── `sandboxd` Go/Node agent (`systemd`, rootless UID 1001 `operator`, cgroup 3.2 GB cap)
   ├── Tools: `bash`, `git`, `gh`, `python3`/`uv`, `node`/`pnpm`, `ffmpeg`, Playwright Chromium
   └── 20-min idle watchdog → syncs `/workspace` & triggers GCE `SUSPEND`
```
- **Chat tools exposed (`lib/ai/tools/cloud-computer.ts`):**
  1. `cloudExec({ command, cwd, timeoutSec })` → streams stdout/stderr tail + exit code into `TaskCard`.
  2. `cloudWriteFile` / `cloudReadFile` / `cloudExportFileToChat` → moves attachments between AES-256-GCM `PrivateFileStore` (`/api/files/[token]`) and `/workspace/<project>/`.
  3. `cloudBrowseUrl({ url, extract })` → runs headless Playwright Chromium on the VM (zero RAM used on your 8 GB Mac mini!), returning `<untrusted_content>`-fenced text or a screenshot artifact.

### Security Model
- **Zero public inbound attack surface:** GCE VM has **no public IP ingress** (firewall denies `0.0.0.0/0` inbound; reached only via authenticated Cloud Run VPC relay using short-lived IAM OIDC + constant-time HMAC request signing).
- **Least-privilege VM isolation:** Commands run as unprivileged `operator` inside `/workspace` with `NoNewPrivileges=yes`, `ProtectSystem=strict`, outbound metadata-server block (`169.254.169.254` iptables drop so shell code can never steal GCP service-account tokens!), and private-RFC1918 SSRF block.
- **No app database/vault secrets on the VM:** The VM holds **zero** Neon `POSTGRES_URL`, `AUTH_SECRET`, or Google OAuth refresh tokens. Git pushes or external authenticated calls require scoped short-lived tokens injected per approved action only.
- **Korn Ferry firewall + approval gates:** `containsRestrictedWorkData` blocks employer data before waking/calling the personal GCP VM. Outbound `git push`, package publishing, bulk network uploads, or `rm -rf` outside `/workspace/tmp` pause on `ApprovalCard`.

### Cost on Ultra 5x
- **~$5.40/mo raw GCP usage → £0.00/mo net out-of-pocket** on `0140A2-72DEB2-62EDCD` ($40/mo Ultra 5x credit + Free Trial through 11 Feb 2027), protected by your existing £5/mo GCP budget alert + hard VM billing cap (`e2-medium` max theoretical 24/7 ceiling is ~$27/mo, so it can never exceed the $40/mo credit even if busy all month).

### Test Plan
1. **Unit & Sandbox Security (`tests/security/cloud-computer.test.ts`):** Verifies HMAC relay signing, metadata-IP (`169.254.169.254`) & private-CIDR SSRF refusal, Korn Ferry prompt/file block, path-traversal confinement to `/workspace`, and approval pause on `git push` / destructive patterns.
2. **Live Cloud VM Smoke Test (`scripts/test-cloud-computer-e2e.ts`):** Resumes the VM, writes a Python script to `/workspace`, runs it via `cloudExec`, exports a generated PNG/CSV to `/api/files/[token]`, verifies persistence across a simulated turn, and confirms idle auto-suspend timer arms cleanly.

---

## Step 3 (Detailed): Mac mini Bridge (B) — Tailscale (`tag:bot` → Mac) + `tmux` + Local CLIs

- **What you can do after Step 3:** Text from anywhere: *"Check `git status` on my Mac"*, *"Run tests in my repo"*, or *"Have Claude Code (or Codex / Antigravity `agy` / T3) fix the mobile navbar and open a draft PR"* — Cloud Computer (A) (`tag:bot`) connects over private Tailscale SSH to a dedicated non-admin `botrunner` account on your Mac mini, runs inside a named **`tmux`** session, logs every byte of session I/O, streams live steps into the chat `TaskCard`, and pauses on an `ApprovalCard` before any destructive or sending command.
- **Effort:** **M (~1.5 sessions).**

### Architecture
```
Cloud Computer (A) GCE VM (`assistant-computer-01`, `tag:bot`)
   │  Private WireGuard tunnel — Tailscale ACL allows ONLY `tag:bot` → `tag:mac:22`
   │  (ZERO public ports, ZERO router port-forwarding, Funnel strictly forbidden)
   ▼
Mac mini (`tag:mac`, Standalone Tailscale + Tailscale SSH or `sshd` on `100.x.y.z:22`)
   └── Dedicated Standard (non-admin) macOS user: `botrunner` (NO `sudo`, NO `admin`/`wheel`)
         ├── `mac-bridge-exec` wrapper → enforces 8 GB Governor (`≤3` agents, `≤1` `/tmp/assistant-build.lock`, `vm_stat ≥ 1.2 GB`)
         ├── Named `tmux` session (`/opt/homebrew/bin/tmux` 3.8, `task-<id>`) + `tmux pipe-pane` full session transcript log
         └── Isolated `/Users/botrunner/workspaces/<repo>` git worktrees + local CLIs:
               • `claude` (`-p --output-format stream-json`)   • `codex` (`exec --json --sandbox workspace-write`)
               • `agy` (Ultra 5x headless workflow)            • `t3` (repo thread orchestration)
```
- **Routing rule (A vs. B) & `launchd` role:** Cloud Computer (A) handles untrusted code, heavy Playwright/builds, and clean-room scripts; Mac Bridge (B) handles local repos, residential UK IP tasks, and your Mac subscription CLIs (`claude`, `codex`, `agy`, `t3`). Note: because commands reach the Mac via Cloud Computer (A), **Korn Ferry / employer data remains strictly blocked** from this cloud-initiated path (local deterministic scripts stay offline on your own Mac account). Your existing ~40 MB `launchd` worker (`scripts/mac-worker.ts`) stays local-only for health checks and log rotation.

### Setup Steps (Mac mini, Tailscale Admin & Cloud VM)

1. **Mac mini — Replace App Store Tailscale with Standalone Tailscale:**
   - **Baseline check (verified on disk):** `/Applications/Tailscale.app` is currently `io.tailscale.ipn.macos` (the sandboxed **Mac App Store** build), and `/opt/homebrew/bin/tmux` (`3.8`) is already installed. Quit Tailscale, delete `/Applications/Tailscale.app`, and remove its old VPN/Network Extension profile in **System Settings → Network → VPN & Filters** so extensions never conflict.
   - **Option 1A (Recommended — Unsandboxed Open-Source `tailscaled` + Tailscale SSH, zero SSH keys to manage):**
     ```bash
     brew install tailscale
     sudo brew services start tailscale
     sudo tailscale up --ssh --advertise-tags=tag:mac --accept-routes=false
     ```
     *(Runs before GUI login as a `LaunchDaemon` and hosts native Tailscale SSH directly — sandboxed GUI builds cannot run the Tailscale SSH server on macOS.)*
   - **Option 1B (Alternative — Standalone GUI `.pkg` `io.tailscale.ipn.macsys` + macOS Remote Login):** Install the standalone `.pkg` from `pkgs.tailscale.com/stable/` (`brew install --cask tailscale-app`), enable **System Settings → General → Sharing → Remote Login** for **Only these users: `botrunner`**, place a dedicated `tag:bot` Ed25519 public key in `~botrunner/.ssh/authorized_keys`, and lock `/etc/ssh/sshd_config.d/10-tailscale-only.conf` to:
     ```sshconfig
     ListenAddress <100.x.y.z-mac-tailscale-ip>
     AllowUsers botrunner
     PasswordAuthentication no
     KbdInteractiveAuthentication no
     PermitRootLogin no
     ```
     *(Binds `sshd` exclusively to the Tailscale interface — LAN and internet port 22 stay closed.)*

2. **Mac mini — Create Dedicated Non-Admin `botrunner` User & Workspaces:**
   ```bash
   sudo sysadminctl -addUser botrunner -fullName "Assistant Bot Runner" -shell /bin/zsh -password -
   # Verify Standard (non-admin) status — must NOT contain 'admin' or 'wheel', and NO /etc/sudoers entry:
   id -Gn botrunner
   sudo -u botrunner mkdir -p /Users/botrunner/{workspaces,logs,bin}
   sudo chmod 700 /Users/botrunner /Users/botrunner/logs /Users/botrunner/workspaces
   ```
   - Authenticate `claude`, `codex`, `agy`, and `t3` once inside `botrunner`'s own home (`sudo su - botrunner` → `claude auth login`, `codex login`, `agy auth login`) so `botrunner` never touches `/Users/caglar` or your personal macOS Keychain.

3. **Tailscale Admin Console — Locked-Down ACL Policy, `check` Mode & Tagged Auth Key:**
   - In **Tailscale Admin → Access Controls**, apply this policy (replacing `<owner-email>` with your tailnet admin login):
     ```jsonc
     {
       "tagOwners": {
         "tag:bot": ["autogroup:admin"],
         "tag:mac": ["autogroup:admin"]
       },
       "acls": [
         // Strict inbound rule for Mac (`tag:mac`): ONLY `tag:bot` (plus optional owner `check`-mode SSH) on port 22 — zero other ports or devices
         { "action": "accept", "src": ["tag:bot"], "dst": ["tag:mac:22"] },
         { "action": "accept", "src": ["autogroup:admin"], "dst": ["autogroup:self:*", "tag:bot:22", "tag:mac:22"] }
       ],
       "ssh": [
         // Machine-to-machine bridge: ONLY tag:bot -> tag:mac, ONLY as non-admin 'botrunner'
         {
           "action": "accept",
           "src": ["tag:bot"],
           "dst": ["tag:mac"],
           "users": ["botrunner"]
         },
         // Human SSH step-up re-auth: check mode forces periodic IdP re-authentication (every 12h)
         {
           "action": "check",
           "src": ["autogroup:admin"],
           "dst": ["tag:mac", "tag:bot"],
           "users": ["autogroup:nonroot"],
           "checkPeriod": "12h"
         }
       ]
       // Note: `nodeAttrs` intentionally omits `funnel` everywhere — Tailscale Funnel is NEVER enabled.
     }
     ```
   - **Important Tailscale `check` mode nuance:** Tailscale's policy compiler enforces *"An SSH access rule from a tagged device cannot be in check mode"* because `tag:bot` is a headless server identity with no browser OIDC session to answer an interactive re-auth prompt. Setting **`action: "check"` (`checkPeriod: "12h"`)** on `autogroup:admin` enforces re-auth on all human SSH sessions (and re-auth when rotating keys in Admin), while `src: ["tag:bot"]` uses `action: "accept"` pinned strictly to `users: ["botrunner"]` + our app-level cryptographic `ApprovalCard` check before any destructive/sending command.
   - In **Settings → Keys → Generate auth key**: create a **Pre-authorized**, **Tagged (`tag:bot`)** auth key (90-day expiry) and store it only in GCP Secret Manager (`TS_BOT_AUTHKEY`) on `hawkeyedlion`.

4. **Cloud VM (`assistant-computer-01`) — Join Tailnet as `tag:bot`:**
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --auth-key="$TS_BOT_AUTHKEY" --advertise-tags=tag:bot --ssh=false --accept-routes=false --hostname=assistant-computer-01
   ```
   - `--ssh=false` ensures the Mac cannot SSH backward into the VM unless explicitly opened for owner `check`-mode admin debugging.

5. **`tmux` Execution & Dual-Layer Session Logging (`mac-bridge-exec`):**
   - Every command dispatched from `tag:bot` invokes `/Users/botrunner/bin/mac-bridge-exec <taskId> <cwd> <cmd>`, which:
     1. Checks the 8 GB Governor (`≤3` active `claude`/`codex`/`agy`/`t3` processes, `/tmp/assistant-build.lock`, `vm_stat ≥ 1.2 GB`).
     2. Starts or attaches to a detached `tmux` session (`tmux new-session -d -s "task-$ID" -c "$CWD"`) and immediately binds **`tmux pipe-pane -o -t "task-$ID"`** to `/Users/botrunner/logs/YYYY-MM-DD-task-$ID.pty.log` (capturing every character of stdin/stdout/stderr, token-redacted) plus an append-only JSONL record in `/Users/botrunner/logs/commands.jsonl` (`timestamp`, `taskId`, `tmuxSession`, `command`, `cwd`, `exitCode`, `durationMs`, `approvalDigest`).
     3. Streams live tail chunks back to Cloud Computer (A) → chat `TaskCard`, while letting you inspect live locally anytime via `sudo -u botrunner tmux attach -r -t task-<id>`.

### Security Model
- **Zero lateral movement & zero public ingress:** `tag:bot` can reach **only `tag:mac:22`** — it cannot ping or connect to your iPhone, router, other tailnet devices, or any non-22 port on the Mac. **Tailscale Funnel and `tailscale serve` are never enabled** in `nodeAttrs` and are hard-blocked in the command policy.
- **OS-enforced non-admin boundary (`botrunner`, no `sudo`):** `botrunner` is a Standard macOS user outside `admin`/`wheel` and absent from `/etc/sudoers`, so macOS PAM/kernel rejects `sudo`, `launchctl system`, and `security` keychain dumps even before our wrapper runs; `/Users/caglar` (`700` permissions) keeps your personal Desktop, Documents, Mail, iCloud, `.ssh`, and `.env*` unreadable to `botrunner`.
- **Mandatory `ApprovalCard` for destructive & sending commands (`lib/worker/command-policy.ts`):**
  - **Auto-allowed (logged inside `tmux`):** Read/test commands (`git status/diff/log`, `rg`, `pnpm check`, unit tests) and isolated edits inside disposable `/Users/botrunner/workspaces/<repo>` `agent/<slug>` worktrees (`main`, `master`, `release/*`, and `feature/openai-premium-model-routing` stay branch-guarded).
  - **Approval-gated (`awaiting_approval` + SHA-256 `ApprovalCard`):** **Every destructive or sending command** pauses before execution until you tap **Approve** in chat — including `git push`, `gh pr create/merge/comment`, `rm` / `mv` / `git clean` / `git reset --hard` outside `/tmp`, emails/messages/webhooks/curl uploads, `brew`/`npm install -g`, and paid credit triggers.
  - **Hard-blocked always:** `sudo`, `su`, `tailscale funnel`, `tailscale serve`, `tailscale up/logout`, `ssh-keygen`/`~/.ssh` reads, `.env*` secret dumps, `osascript` UI clicks (reserved for Step 6b), and CAPTCHA/auth bypasses.

### Revocation & Emergency Kill-Switch Steps
1. **Instant remote cutoff from your iPhone (`<2 seconds`, from anywhere):**
   - Open **Tailscale Admin Console (`login.tailscale.com/admin/machines`)** → tap `assistant-computer-01` (`tag:bot`) → **Remove** (or toggle temporary quarantine ACL removing `{ "src": ["tag:bot"], "dst": ["tag:mac:22"] }`). Tailscale's control plane revokes the node key and drops active WireGuard + Tailscale SSH sessions immediately.
   - Open **Settings → Keys** → **Revoke** the `tag:bot` auth key (and delete/rotate `TS_BOT_AUTHKEY` in GCP Secret Manager) so the VM cannot re-register.
2. **Local Mac mini one-liner cutoff (`<1 second` at home):**
   ```bash
   # Kill every running tmux session & CLI child under botrunner immediately, then shut off SSH:
   sudo pkill -9 -u botrunner && sudo tailscale set --ssh=false
   # Optional if using Option 1B (macOS Remote Login):
   sudo systemsetup -setremotelogin off
   # Optional full wipe of the bridge user:
   sudo sysadminctl -deleteUser botrunner
   ```

### Cost on Ultra 5x
- **£0.00 incremental cost:** Tailscale's Personal **Free** plan includes up to 3 users and 100 devices (with tagged nodes, ACLs, and Tailscale SSH included at $0), paired with your owned Mac mini and existing `Claude Pro`, `ChatGPT Plus`, and `Google AI Ultra 5x (agy)` seats.

### Test Plan
1. **Unit & Policy Suite (`tests/security/mac-bridge-policy.test.ts`):** Verifies command classification — auto-allowing safe reads/worktree tests, forcing `awaiting_approval` on every destructive (`rm`, `git reset --hard`, `git branch -D`) and sending (`git push`, `gh pr`, outbound `curl -X POST`) command, and hard-blocking `sudo`, `tailscale funnel`, `tailscale serve`, `~/.ssh`, and `.env*` — plus 8 GB `ProcessGovernor` limits and Korn Ferry data refusal.
2. **Tailscale ACL & `tmux` Live Smoke Test (`scripts/test-mac-bridge-smoke.ts`):** Verifies from `tag:bot`: (a) `ssh caglar@<mac>` and `ssh root@<mac>` are **rejected** by Tailscale ACLs; (b) non-22 ports (`curl <mac>:3000`) time out; (c) `sudo id` as `botrunner` fails; (d) a disposable `agent/bridge-smoke` `tmux` run (`git status` + `claude`/`codex` dry edit) writes both `.pty.log` and `commands.jsonl` and streams into `TaskCard`; and (e) `git push` halts cleanly on `ApprovalCard`.

---

## Steps 4–7 (Brief)

### Step 4: Background Jobs & Closed-App Push Notifications *(Effort: S–M, ~1 session)*
- **What you can do:** Start any Cloud Computer (A) or Mac Bridge (B) job, close Safari / lock your iPhone, and receive a native **iOS Home-Screen Web Push notification** (VAPID `public/sw.js` + hardened Telegram fallback) when the job finishes or pauses on an `ApprovalCard`, deep-linking straight to `/chat/<chatId>`.
- **How it's tested:** `tests/security/web-push.test.ts` + live closed-Safari iPhone test verifying push delivery and deep-link open.

### Step 5: Quota-Aware Multi-Subscription Routing & 1-Tap OAuth *(Effort: M, ~1.5 sessions)*
- **What you can do:** The assistant tracks rolling windows/resets (`SubscriptionQuota` table) and routes/fails over automatically across all **9 subscriptions**: **Google AI Ultra 5x** (`agy`, Gemini, **Flow/Veo** 10k credits, **Colab** 1k units, **$40 GCP credit**), **Gemini Pro (`csahingoz`)**, **ChatGPT Plus / Codex CLI**, **Claude Pro / Claude Code**, **Lovable Pro**, **Suno**, and **kie.ai** (pre-flight balance check + approval before credit spend), while keeping **GitHub Copilot Pro** and **Cursor** strictly `optInOnly: true`. Personal apps connect via 1-tap OAuth / Mac sign-in handoff in `/setup` (zero manual keys).
- **How it's tested:** `tests/security/quota-router.test.ts` simulating `429` / 5h-window rollovers (`claude ↔ agy ↔ codex`), `OptInRequiredError` on Copilot/Cursor, and `BlockedWorkDataError` on Korn Ferry inputs.

### Step 6: Visual Browser & Desktop Computer Use (C) *(Effort: M–L, ~2 sessions)*
- **What you can do:** Watch a live screenshot strip inside the chat `TaskCard` as a computer-use agent drives a full graphical browser/desktop — **Phase 6a** inside Cloud Computer (A)'s virtual display (`Xvfb` + `x11vnc` + computer-use model, zero risk to your personal screen), and **Phase 6b (optional)** on your Mac mini via macOS Accessibility + `ScreenCaptureKit` with a live "Stop control" kill-switch. Hard-pauses and hands control to you on any login, password, checkout/payment, or CAPTCHA (never solves/bypasses CAPTCHAs).
- **How it's tested:** Mock + Cloud VM `Xvfb` E2E test streaming PNG frames into chat and asserting immediate `awaiting_approval` pause on login/payment/CAPTCHA fixtures.

### Step 7: Seamless Voice Operator on Top *(Effort: S–M, ~1 session)*
- **What you can do:** Tap the Live Voice waveform (`DEFAULT_LIVE_MODEL = "gemini-3.8-live"` → single-value switch to `"gemini-4-live"`), tell the assistant what to build, research, or run on Cloud Computer (A) or Mac Bridge (B) in `<80 ms`, lock your iPhone, and tap the completion push notification to hear a concise spoken briefing with `<100 ms` barge-in and digest-bound voice approval.
- **How it's tested:** Extend `scripts/test-live-voice-e2e.ts` in real Chrome verifying `<80 ms` voice dispatch, socket-close survival, spoken wake briefing, and zero-echo barge-in.

---

## Benchmark: Versus T3 Code, Hermes Agent & Grok Bot

| Capability | T3 Code | Hermes Agent | Grok Bot | **Our Assistant (Steps 1 → 7)** |
| :--- | :---: | :---: | :---: | :---: |
| **Own persistent Cloud Linux Computer (shell, files, git, browser)** | No (local worktrees only) | Self-hosted server required | **Yes** | **Yes — GCE `e2-medium` on `hawkeyedlion` (£0 net on $40 Ultra credit)** |
| **Secure bridge to your personal Mac + local repos** | Desktop app only (not from phone) | Manual SSH | No | **Yes — Tailscale SSH (`tag:bot` → non-admin `botrunner`, `tmux` logs, zero Funnel)** |
| **Drives Claude Code + Codex + Antigravity (`agy`) + T3 together** | Multi-model inside T3 only | Generic scripts, no seat routing | xAI models only | **Yes — unified CLI drivers + automatic quota/reset failover** |
| **Visual browser/desktop computer use with chat screenshots** | Preview tab only | Add-on browser | Cloud browser only | **Yes — Cloud VM VNC first, optional macOS Accessibility second** |
| **Hands-free mobile Live Voice + `<100 ms` echo-free barge-in** | No | Basic TTS/STT | **Yes** | **Yes — Gemini 3.8→4 Live + iOS hardware AEC + `EchoGate`** |
| **Works with app closed / phone locked + iOS Push** | Desktop must stay active | Telegram/CLI only | Cloud tasks only | **Yes — Neon queue + Web Push + Telegram inline fallback** |
| **Creative & UI stack (Flow/Veo + Suno + kie.ai + Lovable)** | No | Manual plugins | Basic image/video | **Yes — native credit-checked creative drivers** |
| **Cryptographic approval gate (destructive, `git push`, sends, spend)** | Local prompts | Coarse / optional | Minimal | **Yes — SHA-256 `ApprovalCard` + Tier 0–3 command policy** |
| **Hard employer / Korn Ferry data firewall** | Manual | None | None | **Yes — pre-flight block across Cloud VM, voice & personal seats** |
| **Incremental monthly cloud bill** | API/seat cost | VPS cost (£5–£20/mo) | £30–£300/mo tier | **£0.00 / month net** *(covered by $40/mo Google AI Ultra credit)* |

**Why we win:** We match **Grok Bot's** core magic — *text or talk from your phone and an actual Linux computer does the work end-to-end* — while adding what Grok Bot cannot touch: **your own Mac mini repos & logged-in CLIs (`claude` + `codex` + `agy` + `t3`), 9-subscription quota arbitrage, a hard Korn Ferry data firewall, cryptographic approval gates, and £0 net cloud cost on your Ultra 5x credit.**
