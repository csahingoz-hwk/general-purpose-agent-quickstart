# Phase 4 — Seamless Multi-Subscription Voice Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task **only after explicit owner approval**. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the personal assistant into a voice-first human-grade AI operator that orchestrates all nine of the owner's paid AI subscriptions across phone and Mac mini, keeps working while the iPhone is locked, reports back by voice and push notification with `<100 ms` barge-in, and targets **£0 net incremental cloud spend** on Google AI Ultra 5x.

**Architecture:** The iPhone PWA's full-duplex Live Voice session (`DEFAULT_LIVE_MODEL = "gemini-3.8-live"`, single-value switch to `"gemini-4-live"`) acts as a sub-second dispatcher that writes durable jobs to Neon Postgres (`BackgroundTask` + `SubscriptionQuota`) instead of tying execution to the phone socket. On the 8 GB RAM Mac mini, the existing ~40 MB `launchd` worker (`scripts/mac-worker.ts`) enforces a strict **3-agent / 1-build semaphore** and drives local subscription CLIs (`claude`, `codex`, `agy`, `t3`) plus cloud creative/compute lanes (Flow/Veo, Colab, Lovable, Suno, kie.ai) through a quota-aware router, pushing native iOS Web Push + spoken summaries back when tasks finish or pause at an `ApprovalCard`.

**Tech Stack:** Next.js 16 App Router, AI SDK 7 (`@ai-sdk/gateway`), Gemini Live (`gemini-3.8-live` → `gemini-4-live`), Neon Postgres, Web Push (`VAPID` service worker + Telegram inline fallback), macOS `launchd` (`--jitless` ~40 MB poller), Cloud Run (scale-to-zero) & Google Colab.

**Spec:** Owner Phase 4 directive (17 Nov 2026) + [BUDGET.md](./BUDGET.md) + [STATUS.md](./STATUS.md).

## Global Constraints

- **Model floor:** Never use `Gemini 3.8 Flash` or any `3.x` text/subagent model; minimum light/subagent model is **`gemini-4-hydrogen`** (`gemini-4-carbon` / `claude-opus` / `gpt-6.1-terra` for synthesis & coding).
- **Live Voice exception & single-switch rule:** `gemini-3.8-live` is approved strictly for the Live Voice lane via the single constant `DEFAULT_LIVE_MODEL` in `lib/voice/live-protocol.ts` (or `GEMINI_LIVE_MODEL`), switching to `gemini-4-live` automatically once released.
- **Work-data firewall (hard rule):** Zero Korn Ferry or employer/client data in any personal subscription, Google project, Colab, Flow, Antigravity, Suno, kie.ai, Lovable, DeepSeek, or free OpenRouter path (`containsRestrictedWorkData` pre-flight block on every task, prompt, file, and voice turn).
- **8 GB RAM Mac mini ceiling:** Maximum **3 concurrent CLI agents** (`MAX_CONCURRENT_AGENTS = 3`) and **1 build/test process at a time** (`MAX_CONCURRENT_BUILDS = 1` via `/tmp/assistant-build.lock`); zero local Docker/video rendering; heavy jobs offload to scale-to-zero Cloud Run or Colab.
- **Explicit-request-only seats:** **GitHub Copilot Pro** and **Cursor** are hard-locked (`optInOnly: true`) and never selected by autonomous routing unless the owner explicitly names them and approves the card.
- **Zero manual keys in UI:** All personal connectors use **one-tap OAuth / browser-handoff only** in `/setup`; backend keys stay in Vercel env / macOS Keychain; plain-English errors only.
- **Mandatory approvals:** Outbound sends (email, calendar invites, PR comments/merges/pushes, public shares) and credit/money-spending actions (kie.ai, Suno, Veo/Flow high-burn renders, paid API bursts, Copilot/Cursor overrides) always pause in `awaiting_approval` with a SHA-256 action digest.

## Review Focus

1. **Phone locks 500 ms after speaking a command:** Voice dispatch writes `BackgroundTask` in `<80 ms` before speaking its acknowledgement; closing the iPhone WebSocket never cancels a `queued` or `running` worker task, and completion wakes the phone via VAPID Web Push.
2. **Simultaneous quota exhaustion mid-chain (e.g., Claude 5h window hits 429 during review):** CLI driver parses exit/stderr quota markers + reset timestamps, marks `claude_pro` cooling down until `resetAt`, and seamlessly resumes the task in the same git worktree on `agy` (`gemini-4-carbon`) or `codex` without losing uncommitted diffs.
3. **Voice confirmation injection from untrusted email/PR text:** Spoken `"approve"` in Live Voice can only approve an `awaiting_approval` task whose `actionDigest` was already read aloud in the current voice session and never executes when untrusted content arrived in the same turn.
4. **Mac mini memory spike (<1.2 GB free RAM while 2 CLIs are open):** `ProcessGovernor` reads macOS `vm_stat` before every spawn; below `1,200 MB` free+speculative RAM it throttles concurrency to `1` and defers container/media tasks to Cloud Run / Colab instead of swapping.
5. **Accidental Copilot Pro or Cursor credit burn:** Router unit tests prove `selectSubscriptionLane` throws `OptInRequiredError` for `copilot_pro` and `cursor` even when all other coding lanes are in cooldown, unless `explicitOwnerRequest === true` + approved digest.

---

## 1. Voice-First Orchestration & Locked-Phone Continuity

```
iPhone Mic ──► Gemini 3.8/4 Live (AI Gateway WS, EchoGate + <100ms Barge-In)
                    │
                    ▼  (server-relayed voice tool call <80ms)
         POST /api/voice/operator  ──► Neon Postgres `BackgroundTask` (durable)
                    │                                │
    "On it — running on Mac mini"                    ▼ (continues while phone is locked)
                                       Mac mini `launchd` Worker (~40 MB poller)
                                       ├── ProcessGovernor (≤3 agents, ≤1 build lock)
                                       ├── QuotaRouter (9 subscriptions + reset ledger)
                                       └── CLI / Cloud Drivers (agy, claude, codex, t3, Colab, Flow, Suno, kie)
                                                     │
                                                     ▼ (on finish or `awaiting_approval`)
                                       iOS Home-Screen Web Push (VAPID) + Telegram Card
                                       + Spoken Briefing queued for next Live Voice open
```

- **Decoupled execution:** Live Voice never blocks waiting on a 4-minute coding or media run. Calling `dispatchOperatorTask` enqueues the job in Postgres and returns an immediate spoken receipt (*"Started in Vibecoder with Antigravity; lock your phone anytime — I'll buzz you when checks pass"*).
- **Proactive voice + push report-back:** When a task transitions to `awaiting_approval`, `succeeded`, or `failed`, the worker sends an iOS Home-Screen PWA Web Push notification (`app/sw.ts` + `POST /api/push/send`) with a 1-line plain-English summary and deep link (`/?voiceBrief=<taskId>`). Opening the notification starts Live Voice with the completed report preloaded into the session greeting — fully interruptible via `<100 ms` `EchoGate` barge-in (*"Skip to the test results"* or *"Approve the PR draft"*).

---

## 2. Subscription Matrix, Mac mini Governor & Quota-Aware Routing

### Subscription Routing Policy (All 9 Subscriptions)

| Subscription | Execution Driver | Primary Operator Role | Quota / Reset Signal | Automatic Fallback Chain |
| :--- | :--- | :--- | :--- | :--- |
| **1. Google AI Ultra** *(Gemini, `agy`, Flow/Veo, Colab, $40 GCP credit)* | `agy` CLI + Vertex/Cloud Run + Colab + Flow | Default autonomous multi-file coding (`agy` 5x), `gemini-4-hydrogen` subagents, `gemini-3.8-live` voice, Veo/Flow video (10k credits), Colab GPU/Python (1k units), scale-to-zero Cloud Run ($40 credit) | `agy` window reset, Flow credit counter, Colab unit counter, GCP billing budget API (`$40/mo`) | `codex` (coding) · `gemini_pro_secondary` (research) · `kie_ai` (video, approval-gated) |
| **2. Gemini Pro (`csahingoz`)** | Isolated OAuth profile (`~/.gemini-pro-csahingoz`) | Secondary deep research, long-context synthesis & overflow lane when primary Ultra interactive rate cools down | Per-window 429 / reset header | `agy` (`gemini-4-hydrogen`) → `chatgpt_plus` |
| **3. ChatGPT Plus / Codex CLI** | `codex exec --json --sandbox workspace-write` | Repo refactoring, TypeScript/test surgical fixes, independent diff verification before PR creation | `~/.codex` Plus rolling window / exit 429 | `agy` (`gemini-4-carbon`) → `claude_code` |
| **4. Claude Pro / Claude Code** | `claude -p --output-format stream-json` | Architecture specs, adversarial security/audio code review, executive/finance prose | 5-hour rolling window (`Resets in XhYm` parser) | `agy` (`gemini-4-carbon`) → `codex` |
| **5. Lovable Pro** | 1-tap GitHub OAuth repo sync + Mac mini browser session | Rapid interactive UI/prototype scaffolding synced to `draft/lovable-*` branches | Monthly message credit counter | Local `agy` + `frontend-design` / `shadcn` build |
| **6. Suno** | Mac mini authenticated session + `suno-hook-video` pipeline | Personal song & backing-track generation (**always `awaiting_approval` before credit spend**) | Remaining song credits | Pause & notify owner (no silent substitute) |
| **7. kie.ai** | Server Vault / Keychain REST driver (`lib/connectors/kie-ai.ts`) | 9:16 story hook videos, shot-to-video, music/image bursts (**pre-flight credit check + `awaiting_approval`**) | Live credit balance endpoint prior to reserve | Google Flow/Veo (10k Ultra credits) |
| **8. GitHub Copilot Pro** | `gh copilot` / VS Code bridge (**`optInOnly: true`**) | **Disabled for autonomous routing** (protects 300-request cap); runs **only** when owner says *"use Copilot"* + approves | Monthly premium request counter | Never auto-selected; defaults to `agy` / `codex` |
| **9. Cursor** | `cursor` CLI bridge (**`optInOnly: true`**) | **Disabled for autonomous routing**; runs **only** on explicit owner request + approval | Fast-request counter | Never auto-selected; defaults to `agy` / `codex` |

### 8 GB RAM Mac mini Execution Rules (`lib/worker/process-governor.ts`)
- **Daemon footprint:** `scripts/mac-worker.ts` stays at `--jitless --max-old-space-size=24` (~40 MB RSS).
- **Hard concurrency caps:**
  1. `activeCliAgents <= 3` across `agy`, `claude`, `codex`, and `t3`. A 4th task stays `queued` in Postgres with live queue position reported to voice/UI.
  2. `activeBuilds <= 1` enforced via advisory file lock `/tmp/assistant-build.lock` around `pnpm build`, `tsc`, `biome`, and Playwright so two agents never compile at once.
  3. **RAM pressure valve:** Before spawning any CLI, reads `vm_stat`; if available RAM `< 1.2 GB`, caps `activeCliAgents` at `1` and routes container/Playwright/ffmpeg jobs to **Cloud Run (scale-to-zero)** or **Colab**.

---

## 3. One-Tap OAuth & Zero-Key Connector Model

Every personal integration in `/setup` uses a single **Connect** button (zero raw token/cookie pasting):
- **Gmail, Calendar & Drive:** Live 1-tap Google OAuth PKCE (`connectGoogleWorkspace`), scoped to read + unsent drafts (`sendUpdates=none`).
- **GitHub:** Live 1-tap GitHub OAuth (`connectGithubAccount`), scoped to PR/issue reads + `PENDING` unpublished draft reviews.
- **Lovable Pro & Suno:** 1-tap **Mac mini Sign-In Handoff** (`POST /api/connectors/handoff` → opens a single native macOS sign-in window via the local worker or uses the connected GitHub OAuth repo bridge for Lovable; session state is sealed inside macOS Keychain + AES-256-GCM `VaultSecret` and refreshed automatically).
- **Local Subscription CLIs (`claude`, `codex`, `agy`, `t3`, secondary `gemini-pro`):** Worker health snapshot reports live login state (`connected` / `re-login needed`) to `/setup`, with a 1-tap **"Sign in on Mac"** button that launches the official browser OAuth flow (`claude auth login`, `codex login`, `agy auth login`).

---

## 4. Memory, Routines, Teammates & Approval Firewall

- **Teammate-to-Subscription affinity:**
  - *Chief of Staff* (Blue): `gemini-3.8-live` voice + `claude_code` / `gemini-4-hydrogen` + Gmail/Calendar/Drive drafts + 08:00 weekday voice-ready brief.
  - *Finance Controller* (Green): Deterministic local CSV/PDF parsers + `gpt-6.1-terra` / `claude_code` — **strictly blocked from personal Google/Colab/DeepSeek whenever employer terms appear**.
  - *Vibecoder* (Purple): `agy` (primary 5x) + `codex` (diff verifier) + `claude_code` (reviewer) + `t3` multi-thread repo orchestration + Lovable UI sync on `agent/*` worktrees.
  - *Creative Studio* (Amber — new preset): Google Flow/Veo (10k Ultra credits) + Suno + `kie.ai` (`suno-hook-video` pipeline).
- **Universal Send & Spend Approval Gate:**
  - Outbound actions (sending an email, inviting calendar guests, posting/merging a GitHub PR, publishing a share link) and credit-spending generations (Suno song, `kie.ai` render, Flow/Veo render above threshold, Copilot/Cursor opt-in) compute a canonical SHA-256 `actionDigest` (`lib/safety/risk-reviewer.ts`) and park in `awaiting_approval`.
  - Approvable via **iPhone UI card**, **Web Push / Telegram HMAC button**, or **verified voice confirmation** bound to the active `actionDigest`.

---

## 5. Benchmark vs. T3 Code, Hermes Agent & Grok Bot

| Capability | T3 Code | Hermes Agent | Grok Bot | **Our Phase 4 Voice Operator** |
| :--- | :---: | :---: | :---: | :---: |
| **Hands-free mobile Live Voice + `<100 ms` echo-free barge-in** | Desktop-first | Text / basic TTS | Strong voice, single vendor | **Yes — Gemini 3.8→4 Live + iOS hardware AEC + `EchoGate`** |
| **Keeps working while iPhone is locked + iOS Lock-Screen Push** | Desktop app must stay open or manual check | Server daemon, weak mobile voice UX | Cloud chat only, no local repo/CLI control | **Yes — Postgres durable queue + Mac mini `launchd` + VAPID Push → spoken brief** |
| **Drives Claude Code + Codex + Antigravity (`agy`) + T3 together** | Multi-model inside T3, not cross-CLI | Generic tool runner, no subscription awareness | Locked to xAI models | **Yes — unified CLI drivers + cross-vendor review (`agy` builds, `claude`/`codex` review)** |
| **Live subscription quota & reset tracking with auto-fallback** | Manual model switch on 429 | Static config | Single-provider quota | **Yes — tracks 5h/daily/monthly resets across all 9 seats & fails over mid-task** |
| **Creative & UI suite (Flow/Veo + Suno + kie.ai + Lovable)** | Code only | Custom scripts only | Basic image gen | **Yes — native `Creative Studio` teammate with credit pre-checks** |
| **8 GB RAM hardware governor (≤3 agents, ≤1 build lock)** | Unbounded parallel worktrees can swap-thrash | Unbounded container/Python RAM | Cloud-only | **Yes — `vm_stat` pressure valve + `/tmp/assistant-build.lock` + Cloud Run offload** |
| **Zero manual API keys (1-tap OAuth + Vercel OIDC)** | Requires provider keys / CLI setup | Heavy `.env` / YAML key setup | Consumer login, no personal repo/Mac control | **Yes — 1-tap `/setup` checklist, zero key-paste inputs** |
| **Cryptographic approval gate on every send & spend** | Local permission prompts | Optional / coarse | None | **Yes — SHA-256 digest cards across PWA, Push, Telegram & Voice** |
| **Hard employer / Korn Ferry data firewall** | Manual discipline | None | None | **Yes — deterministic pre-flight block across all personal cloud/voice tools** |

**Where we win:** T3 Code excels at desktop coding threads, Hermes excels at unattended server scripts, and Grok excels at casual single-model voice chat — **none of them combine phone-in-pocket hands-free voice, cross-subscription CLI arbitrage (`agy` + `claude` + `codex` + `t3` + creative seats), 8 GB Mac mini hardware protection, and cryptographic send/spend safety at £0 net cloud cost.**

---

## 6. Budget on Google AI Ultra 5x (£0 Net Cloud Target) & Risks

### Steady-State Monthly Cloud Ledger (`£/month`)

| Line Item | Source / Seat | Incremental Out-of-Pocket (`£/mo`) | How £0 Net Cloud Is Maintained |
| :--- | :--- | :---: | :--- |
| **Subscriptions (already owned / sunk)** | Ultra 5x, Gemini Pro, ChatGPT Plus, Claude Pro, Lovable, Suno, kie.ai, Copilot*, Cursor* | **£0 incremental** | Treated as existing fixed seats; QuotaRouter maximizes included 5x `agy`, 10k Flow, 1k Colab, Claude 5h, and Codex Plus windows before touching metered APIs |
| **Cloud Run (scale-to-zero) + Firebase + Gemini API** | GCP Billing `0140A2-72DEB2-62EDCD` (**US$40/mo ≈ £31.60/mo** Ultra credit + Free Trial to 11 Feb 2027) | **£0 net** | `min-instances=0` on Cloud Run workers (`~£0` idle); `gemini-4-hydrogen` + Live Voice (~60–120 min/mo ≈ £2–£5 raw) easily fit inside the US$40/mo credit; £5/mo GCP budget alert stays active |
| **Heavy Python / Media / GPU Offload** | Google Colab (**1,000 Ultra units/mo**) + Flow (**10,000 credits/mo**) | **£0 net** | Offloads video stitching (`ffmpeg`/Remotion) and Veo renders off both the 8 GB Mac mini and paid APIs |
| **PWA Hosting, DB & Push** | Existing Vercel plan + Neon Postgres Free/Launch tier + VAPID Web Push | **£0 net** | Zero third-party push SaaS; AI Gateway spend hard-capped via `ModelUsage` ledger (`AI_MONTHLY_ALLOWANCE_USD` lowered to `$2` emergency buffer once CLI/Vertex routing is live) |
| **Local Always-On Poller** | Owned 8 GB Mac mini (`~40 MB` `launchd` daemon, ~12W idle) | **£0 cloud** *(~£3.50 electricity)* | Runs existing home hardware with zero cloud VM rental |
| **Target Incremental Cloud Bill** | | **£0.00 / month net** | Hard circuit-breaker aborts metered calls before exceeding included credits |

### Key Risks & Mitigations
1. **Employer / Korn Ferry data leakage (Critical):** Enforced by `containsRestrictedWorkData` before *every* voice turn, CLI spawn (`agy`, personal `gemini-pro`, Colab, Flow, Lovable, Suno, kie.ai), and share snapshot; Finance Controller defaults to deterministic local CSV/PDF tools.
2. **Consumer CLI auth expiry or ToS rate throttling (High):** CLIs use official local login commands (`claude`, `codex`, `agy`) at human-operator concurrency (`≤3`), never scrape web UIs with fake headers, and surface clean *"Tap to re-authenticate Claude on Mac"* status in `/setup` on token expiry.
3. **8 GB Mac mini swap thrashing (High):** Hard `≤3` CLI semaphore + `≤1` global `/tmp/assistant-build.lock` + `1.2 GB` free-RAM `vm_stat` circuit breaker.
4. **Depleted creative credits (`kie.ai` / Suno) or accidental Copilot/Cursor burn (Medium):** Pre-flight balance check + mandatory `ApprovalCard` on creative spend; hard `optInOnly: true` lock on Copilot Pro and Cursor.
5. **iOS Safari Web Push requirements (Medium):** Requires Home-Screen PWA install (`iOS 16.4+`) + 1-tap notification permission; falls back automatically to hardened single-owner Telegram push if Web Push isn't granted.

---

## File Structure & Implementation Tasks (Execute Only After Owner Approval)

- **Create:** `lib/db/phase4-schema.sql` — additive `SubscriptionQuota`, `PushSubscription`, and `OperatorReport` tables.
- **Create:** `lib/orchestrator/subscriptions.ts` — typed catalog of all 9 subscriptions, `optInOnly` locks (`copilot_pro`, `cursor`), and work-data eligibility flags.
- **Create:** `lib/orchestrator/quota-router.ts` — rolling window & reset tracker, `429`/`Resets in` parser, and ranked fallback selector.
- **Create:** `lib/worker/process-governor.ts` — `MAX_CONCURRENT_AGENTS = 3`, `/tmp/assistant-build.lock` (`MAX_CONCURRENT_BUILDS = 1`), and `vm_stat` 1.2 GB RAM guard.
- **Create:** `lib/worker/cli-drivers/{claude,codex,agy,t3,creative}.ts` — scrubbed-env child-process runners writing streamed progress to `BackgroundTask`.
- **Create:** `lib/push/web-push.ts`, `app/sw.ts`, `app/api/push/route.ts` — VAPID iOS Home-Screen Web Push + deep-link voice briefing queue.
- **Create:** `app/api/voice/operator/route.ts` & modify `components/chat/live-voice-engine.ts` — non-blocking voice tool relay (`dispatchOperatorTask`, `checkTaskStatus`, `resolveApprovalByVoice`) + spoken briefing on wake.
- **Modify:** `app/(chat)/setup/page.tsx` & `app/api/setup-status/route.ts` — 1-tap OAuth / Mac sign-in status rows for all subscriptions & creative connectors (zero raw keys).

### Task 1: Subscription Catalog & Quota-Aware Router (`lib/orchestrator/*`)
- **Files:** Create `lib/db/phase4-schema.sql`, `lib/orchestrator/subscriptions.ts`, `lib/orchestrator/quota-router.ts`; Test `tests/security/quota-router.test.ts`.
- **Interfaces:** Produces `selectSubscriptionLane(req: OperatorTaskRequest, quotas: QuotaSnapshot[]): SelectedLane` and `parseQuotaResetFromError(stderr: string, now: Date): Date | null`.
- [ ] **Step 1:** Write failing tests in `tests/security/quota-router.test.ts` pinning: (a) all 9 subscriptions registered, (b) `claude_code → agy → codex` failover when Claude 5h window is exhausted, (c) `OptInRequiredError` on `copilot_pro` and `cursor` without `explicitOwnerRequest + approvedDigest`, (d) `BlockedWorkDataError` on personal Google/Colab/Flow/Suno/kie/Lovable when Korn Ferry markers appear, and (e) zero `3.x` text models.
- [ ] **Step 2:** Run `node --import tsx --test tests/security/quota-router.test.ts` → confirm FAIL.
- [ ] **Step 3:** Implement `subscriptions.ts`, `quota-router.ts`, and `phase4-schema.sql`.
- [ ] **Step 4:** Re-run `node --import tsx --test tests/security/quota-router.test.ts` → confirm PASS; commit.

### Task 2: 8 GB Mac mini Process Governor & CLI Drivers (`lib/worker/*`)
- **Files:** Create `lib/worker/process-governor.ts`, `lib/worker/cli-drivers/{types,claude,codex,agy,t3}.ts`; Modify `lib/worker/queue-worker.ts`; Test `tests/security/process-governor.test.ts`.
- **Interfaces:** Consumes `selectSubscriptionLane`; Produces `ProcessGovernor.acquireAgentSlot()`, `ProcessGovernor.withBuildLock(fn)`, and `runCliDriver(lane, task, worktreePath)`.
- [ ] **Step 1:** Write failing tests in `tests/security/process-governor.test.ts` asserting: 4th concurrent agent queues until one exits (`<=3`), 2nd simultaneous build waits on `/tmp/assistant-build.lock` (`<=1`), `<1,200 MB` free RAM throttles local slots to `1` and routes container jobs to Cloud Run, and worktree branches block `main`/`feature/openai-premium-model-routing`.
- [ ] **Step 2:** Run `node --import tsx --test tests/security/process-governor.test.ts` → confirm FAIL.
- [ ] **Step 3:** Implement `ProcessGovernor` and the 4 CLI drivers (`claude`, `codex`, `agy`, `t3`) with scrubbed `env` and automatic mid-task quota failover.
- [ ] **Step 4:** Run `node --import tsx --test tests/security/process-governor.test.ts` + `POSTGRES_URL="" pnpm worker:once` → confirm PASS; commit.

### Task 3: Creative & UI Connectors + One-Tap `/setup` Handoff (Flow, Colab, Lovable, Suno, kie.ai)
- **Files:** Create `lib/worker/cli-drivers/creative.ts`, `lib/connectors/oauth-broker.ts`, `app/api/connectors/handoff/route.ts`; Modify `app/api/setup-status/route.ts`, `app/(chat)/setup/page.tsx`; Test `tests/security/creative-and-oauth.test.ts`.
- **Interfaces:** Produces `preflightCreditCheck(provider: "kie" | "suno" | "flow")` and 1-tap `/setup` connection actions with zero raw key inputs.
- [ ] **Step 1:** Write failing tests verifying pre-flight credit balance check, mandatory `awaiting_approval` digest before any `kie.ai`/Suno credit spend, Flow-before-kie priority under Ultra 10k credits, and zero `input[type="password"]` in `/setup`.
- [ ] **Step 2:** Run test → confirm FAIL; implement drivers + 1-tap OAuth/Mac sign-in handoff; re-run test → confirm PASS; commit.

### Task 4: Locked-Phone Voice Dispatch, Web Push & Barge-In Briefings
- **Files:** Create `lib/push/web-push.ts`, `app/sw.ts`, `app/api/push/route.ts`, `app/api/voice/operator/route.ts`; Modify `components/chat/live-voice-engine.ts`, `components/chat/voice-memo-button.tsx`, `lib/bots/roster.ts`; Test `tests/security/voice-operator.test.ts` + `scripts/test-live-voice-e2e.ts`.
- **Interfaces:** Consumes `BackgroundTask`, `ProcessGovernor`, `reviewActionRisk`; Produces `POST /api/voice/operator` (`dispatch`, `status`, `approveByDigest`) and iOS VAPID push notification with `/?voiceBrief=<taskId>` resume.
- [ ] **Step 1:** Write failing unit + Chrome E2E tests proving: (a) voice command enqueues `BackgroundTask` in `<80 ms` and survives immediate WebSocket close (locked phone), (b) completion fires Web Push + stores `OperatorReport`, (c) reopening Live Voice speaks the report with `<100 ms` barge-in, and (d) spoken approval refuses mismatched digests or untrusted-content turns.
- [ ] **Step 2:** Run tests → confirm FAIL; implement voice operator relay, VAPID service worker, and *Creative Studio* teammate; run full `pnpm check && tsc --noEmit && pnpm test:security && pnpm build` + Chrome E2E → confirm PASS; commit.
