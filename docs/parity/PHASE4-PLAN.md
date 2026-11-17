# Phase 4 — "Be Like Grok Bot" Capability Ladder Plan

> **Plan only — do not build until the owner approves.** Each rung of this 7-step ladder ships as a standalone, daily-useful upgrade.

## North Star

**You text or talk in chat, and the assistant does the work itself on a real computer** — with live progress in chat and strict approval before anything destructive, outbound, or credit-spending happens:

- **A) Its Own Cloud Computer:** A persistent, sandboxed Linux VM on your Google Cloud project (`hawkeyedlion`, billing `0140A2-72DEB2-62EDCD`, covered at **£0 net** by your $40/mo Google AI Ultra credit) with `bash`, persistent `/workspace` files, `git`, Python/Node, and headless Playwright Chromium.
- **B) Your Mac mini (8 GB RAM):** Reached through the existing ~40 MB `launchd` worker (`scripts/mac-worker.ts`) upgraded into a secure, outbound-only terminal & repo bridge — running logged commands, isolated git worktrees, and your installed `claude`, `codex`, `agy`, and `t3` CLIs within the **8 GB limits** (`≤3` concurrent agents, `≤1` build at a time).
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
| **3** *(Detailed)* | **Mac mini Bridge (B): Logged Terminal + Local CLIs** | Tell chat *"run tests in my local project"* or *"have Claude Code / Codex / agy fix bug Z"* — your Mac mini executes in an isolated git worktree, logs every command, and stops for approval before `git push`. | **M** *(~1.5 sessions)* |
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

## Step 3 (Detailed): Mac mini Bridge (B) — Logged Terminal + Local Subscription CLIs

- **What you can do after Step 3:** Text from anywhere: *"Check `git status` across my projects on the Mac mini"*, *"Run the EOSB reconciliation script locally"*, or *"Have Claude Code (or Codex / Antigravity `agy` / T3) fix the mobile navbar in `general-purpose-agent-quickstart` and prepare a draft PR"* — your Mac mini executes locally through the existing `launchd` worker, streams every command and diff into the chat `TaskCard`, and pauses on an `ApprovalCard` before any destructive command or `git push`.
- **Effort:** **M (~1.5 sessions).**

### Architecture
```
Chat (`macExec`, `macEditFile`, `macRunAgentCli`)
   │  inserts signed `CommandLease` into Neon Postgres `BackgroundTask`
   ▼  (Mac mini polls outbound HTTPS only — ZERO open router/SSH ports)
Mac mini `launchd` Worker (`scripts/mac-worker.ts`, ~40 MB `--jitless` poller)
   ├── `ProcessGovernor` (`≤3` CLI agents, `≤1` `/tmp/assistant-build.lock`, `vm_stat ≥ 1.2 GB`)
   ├── `CommandClassifier` (Allowlisted Read/Test vs. Approval-Required Write/Push/Delete)
   ├── `AppendOnlyAuditLog` (`~/Library/Logs/assistant-worker/commands.jsonl`, token-redacted)
   └── Isolated Worktree + CLI Drivers:
         • `/Users/caglar/.local/bin/claude` (`-p --output-format stream-json`)
         • `/opt/homebrew/bin/codex` (`exec --json --sandbox workspace-write`)
         • `/Users/caglar/.local/bin/agy` (Ultra 5x headless workflow)
         • `/Users/caglar/.local/bin/t3` (repo thread orchestration)
```
- **Routing rule between Cloud Computer (A) and Mac Bridge (B):**
  - **Cloud Computer (A)** is the default for untrusted code, web scraping, heavy builds/Playwright, and clean-room scripts (keeps 8 GB Mac RAM untouched!).
  - **Mac Bridge (B)** is selected when the task needs your **local `~/App_Projects` repos**, **local macOS files**, **residential UK IP**, **deterministic local finance scripts** (where personal GCP is disallowed), or your **logged-in Mac subscription CLIs (`claude`, `codex`, `agy`, `t3`)**.

### Security Model
- **Outbound-only pull bridge:** Your Mac mini never exposes an inbound port or tunnel; `scripts/mac-worker.ts` pulls `CommandLease` rows over TLS from Neon Postgres and verifies an **HMAC-SHA256 lease signature** (`AUTH_SECRET`-derived subkey) binding `(taskId, kind, command, cwd, expiresAt)` so even a compromised text stream cannot forge arbitrary shell execution.
- **3-Tier Command Policy (`lib/worker/command-policy.ts`):**
  1. **Tier 0 — Auto-Allowed Read/Inspect:** `git status/diff/log`, `ls`, `rg`, `cat` inside allowlisted roots (`~/App_Projects`), `pnpm check`, unit tests (under `/tmp/assistant-build.lock`).
  2. **Tier 1 — Isolated Worktree Edit (`agent/<slug>` / `draft/<slug>`):** File edits and CLI runs (`claude`, `codex`, `agy`, `t3`) restricted to a disposable git worktree; `main`, `master`, `release/*`, and `feature/openai-premium-model-routing` stay hard-blocked (`lib/subagents/worktree-coder.ts`).
  3. **Tier 2 — Mandatory `ApprovalCard` (SHA-256 digest):** Any `git push`, `gh pr create/merge`, `rm`/`mv` outside the disposable worktree, `brew`/`npm install -g`, `launchctl`, outbound curl/upload, or send action **hard-pauses in `awaiting_approval`** until you tap Approve.
  4. **Tier 3 — Hard-Blocked Always:** `sudo`, `security dump-keychain`, reading `~/.ssh` private keys or `.env*` secrets, `rm -rf ~`, disk/system modification, and CAPTCHA/auth-bypass tools.
- **Full append-only audit trail:** Every executed Mac command logs `{ timestamp, taskId, driver, command, cwd, exitCode, durationMs, redactedOutputHead }` to both `BackgroundTask.steps` (visible in chat) and rotated local `commands.jsonl`. Child processes receive a minimal scrubbed `env` (`PATH`, `HOME`, `USER`, `LANG`).

### Cost on Ultra 5x
- **£0.00 cloud spend** — uses your owned Mac mini (~£3.50/mo existing idle UK electricity) and your already-paid `Claude Pro`, `ChatGPT Plus`, and `Google AI Ultra 5x (agy)` subscriptions instead of burning per-token API credits.

### Test Plan
1. **Unit & Policy Suite (`tests/security/mac-bridge-policy.test.ts`):** Tests HMAC `CommandLease` tamper rejection, Tier 0/1/2/3 command classification (blocking `sudo`, `~/.ssh`, `.env`, `rm -rf`), `ProcessGovernor` (`≤3` agents, `≤1` `/tmp/assistant-build.lock`, `<1.2 GB` free-RAM throttle), scrubbed child `env`, and Korn Ferry block on personal `agy` CLI.
2. **Mock + Live CLI Smoke Test (`scripts/test-mac-bridge-smoke.ts`):** Runs a safe Tier 0 `git status` + a disposable Tier 1 `claude` / `codex` edit on `agent/bridge-smoke`, verifies audit log entry + live `TaskCard` diff summary in chat, and confirms `git push` halts in `awaiting_approval`.

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
| **Secure bridge to your personal Mac + local repos** | Desktop app only (not from phone) | SSH / manual setup | No | **Yes — outbound-only `launchd` bridge (`≤3` agents, `≤1` build lock)** |
| **Drives Claude Code + Codex + Antigravity (`agy`) + T3 together** | Multi-model inside T3 only | Generic scripts, no seat routing | xAI models only | **Yes — unified CLI drivers + automatic quota/reset failover** |
| **Visual browser/desktop computer use with chat screenshots** | Preview tab only | Add-on browser | Cloud browser only | **Yes — Cloud VM VNC first, optional macOS Accessibility second** |
| **Hands-free mobile Live Voice + `<100 ms` echo-free barge-in** | No | Basic TTS/STT | **Yes** | **Yes — Gemini 3.8→4 Live + iOS hardware AEC + `EchoGate`** |
| **Works with app closed / phone locked + iOS Push** | Desktop must stay active | Telegram/CLI only | Cloud tasks only | **Yes — Neon queue + Web Push + Telegram inline fallback** |
| **Creative & UI stack (Flow/Veo + Suno + kie.ai + Lovable)** | No | Manual plugins | Basic image/video | **Yes — native credit-checked creative drivers** |
| **Cryptographic approval gate (destructive, `git push`, sends, spend)** | Local prompts | Coarse / optional | Minimal | **Yes — SHA-256 `ApprovalCard` + Tier 0–3 command policy** |
| **Hard employer / Korn Ferry data firewall** | Manual | None | None | **Yes — pre-flight block across Cloud VM, voice & personal seats** |
| **Incremental monthly cloud bill** | API/seat cost | VPS cost (£5–£20/mo) | £30–£300/mo tier | **£0.00 / month net** *(covered by $40/mo Google AI Ultra credit)* |

**Why we win:** We match **Grok Bot's** core magic — *text or talk from your phone and an actual Linux computer does the work end-to-end* — while adding what Grok Bot cannot touch: **your own Mac mini repos & logged-in CLIs (`claude` + `codex` + `agy` + `t3`), 9-subscription quota arbitrage, a hard Korn Ferry data firewall, cryptographic approval gates, and £0 net cloud cost on your Ultra 5x credit.**
