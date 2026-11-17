# Phase 4 — Capability Ladder Plan (From Basic Chat to Full Voice Operator)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to ship this ladder **one step at a time, only after explicit owner approval**. Each step ships as a working, independently useful upgrade.

**Honest Baseline Today:** Right now the app works cleanly as a mobile chat + 1-tap Live Voice shell, but in daily use it still behaves like a **basic chat**:
1. `lib/ai/context/select-tools.ts` gates tools behind ultra-literal phrases (e.g. *"check my gmail"* works, while *"did Ali email me?"* or *"any meetings tomorrow?"* misses the connector regex and falls through to web search), and there is no chat tool to kick off or track background work.
2. Chat has no live inline **Task / Progress Card** — `BackgroundTask` rows only appear if you manually leave chat and open `/routines`.
3. `lib/worker/queue-worker.ts` (`line 630`) still writes a placeholder string instead of executing real jobs or Mac CLIs, and cannot push-notify your iPhone when closed.

**Goal:** Climb from basic chat to a seamless multi-subscription voice operator in **5 small, shippable steps**, where **every single step gives you a real capability you can use immediately**.

## Global Rules Across Every Step

- **Model floor:** Never use `Gemini 3.8 Flash` or any `3.x` text/subagent model (`gemini-4-hydrogen` minimum; `gemini-3.8-live` is isolated to the single `DEFAULT_LIVE_MODEL` constant in `lib/voice/live-protocol.ts` and switches to `gemini-4-live` on release day).
- **Work-data firewall:** Zero Korn Ferry / employer data in any personal Google, Colab, Flow, Antigravity, Suno, kie.ai, Lovable, DeepSeek, or free OpenRouter path (`containsRestrictedWorkData` pre-flight check on every tool & task).
- **8 GB RAM Mac mini ceiling:** Max **3 concurrent CLI agents** (`MAX_CONCURRENT_AGENTS = 3`) and **1 build/test at a time** (`/tmp/assistant-build.lock`); ~40 MB `launchd` poller; heavy containers/renders offload to scale-to-zero Cloud Run or Colab.
- **Zero raw keys & mandatory approvals:** One-tap OAuth / Mac sign-in handoff only; **every** outbound send and **every** credit/money spend pauses on a SHA-256 `ApprovalCard`. **Copilot Pro** and **Cursor** stay locked (`optInOnly: true`) unless you explicitly ask for them by name.

---

## Ladder Overview

| Step | Shippable Upgrade | What You Can Do Right After It Ships | Effort |
| :--- | :--- | :--- | :---: |
| **Step 1** *(Detailed)* | **Reliable Tool Calling + Live Task Card in Chat** | Natural phrasing (*"any emails from HMRC?"*, *"what's on my calendar Friday?"*, *"remember my BA number"*, *"queue a background task"*) reliably calls the right tool and renders a live inline **Task / Progress Card** right inside chat. | **S–M** *(~1 session)* |
| **Step 2** *(Detailed)* | **Real Mac Worker Jobs + Closed-App Web Push** | Start a research, routine, or repo check in chat, **close Safari / lock your iPhone**, let your Mac mini finish it in the background, and get an **iPhone lock-screen push notification** that opens straight to the finished card. | **M** *(~1–1.5 sessions)* |
| **Step 3** *(Detailed)* | **One Real Subscription CLI End-to-End (`Claude Code` on Mac)** | Say in chat: *"Fix the mobile header spacing in repo X and open a draft PR"* → your Mac mini runs `/Users/caglar/.local/bin/claude` in an isolated `agent/*` git worktree, streams live steps into the chat card, runs checks under the 1-build lock, and pauses on an **Approve PR / Push** card. | **M** *(~1.5 sessions)* |
| **Step 4** *(Brief)* | **Quota-Aware Multi-Subscription Router + 1-Tap OAuth** | Automatically routes & fails over across all 9 subscriptions (`agy` 5x, `claude`, `codex`, `t3`, Gemini Pro `csahingoz`, Flow/Veo, Colab, Lovable, Suno, `kie.ai`; Copilot & Cursor opt-in only) with live reset tracking. | **M–L** *(~2 sessions)* |
| **Step 5** *(Brief)* | **Seamless Hands-Free Voice Operator on Top** | Talk hands-free, delegate Step 1–4 jobs in `<80 ms`, lock your phone, get buzzed when done, and tap to hear a spoken briefing with `<100 ms` barge-in. | **S–M** *(~1 session)* |

---

## Step 1 (Detailed): Reliable Tool Calling + Live Task/Progress Card in Chat

### What You Can Do After Step 1
- Ask naturally in English or Turkish — *"Did anyone email me about Friday?"*, *"Am I free tomorrow at 2pm?"*, *"What PRs are open?"*, *"Remember I prefer aisle seats"*, *"Make an image of…"* — and the assistant **reliably invokes the real tool** instead of falling back to generic prose or accidental web search.
- Every multi-step tool or queued job renders a clean **inline `TaskProgressCard` right inside the chat stream** showing status (`Queued` → `Running` → `Needs approval` → `Done`), live step checklist, elapsed time, and 1-tap **Approve / Cancel** buttons — without hunting in `/routines`.

### Effort
- **Small–Medium (~1 focused session, ~4–5 files touched, zero new infra).**

### Files & Interfaces
- **Modify:** `lib/ai/context/select-tools.ts`
  - Replace brittle exact-verb regexes (`check my gmail`, `save to my profile`) with **broad bilingual domain-intent buckets** (`MAIL_INTENT`, `CALENDAR_INTENT`, `DRIVE_INTENT`, `GITHUB_INTENT`, `MEMORY_INTENT`, `MEDIA_INTENT`, `TASK_INTENT`) while keeping two existing safety invariants intact:
    1. Pure greetings/chitchat still send **zero** tool schemas (`0` extra tokens on *"merhaba"* / *"thanks"*).
    2. Untrusted read tools (`webSearch`, `gmailReadMessages`, `driveReadFiles`, `calendarReadEvents`, `githubReadPullRequests`) still **never** coexist with `STATE_CHANGING_TOOLS` in the same model step (`select-tools.ts:443-464`).
  - Fix the `isOpenQuestion` trap (`select-tools.ts:152-173`): when a personal connector intent matches (*"Did Ali email me?"*, *"What's on my calendar?"*), route to the personal connector and **suppress `webSearch`** so private questions never leak into web search queries.
- **Create:** `lib/ai/tools/background-task-tools.ts`
  - `enqueueBackgroundTask`: creates a real `BackgroundTask` row in Neon Postgres (`kind`, `title`, `prompt`, `riskLevel`) and returns `{ taskId, status, title, steps, riskLevel }`.
  - `getBackgroundTask`: fetches latest `{ taskId, status, steps, output, error }` by ID for follow-up questions (*"How's that task going?"*).
- **Create:** `app/api/tasks/[id]/route.ts`
  - Owner-only `GET` returning a single `BackgroundTaskRecord` (used by the chat card's lightweight SWR poller: every `2s` while `queued`/`running`, `0` requests once terminal) and `PATCH` (`cancel` / `approve` bound to `actionDigest`).
- **Create:** `components/chat/task-progress-card.tsx` & **Modify:** `components/chat/message.tsx`
  - Renders `tool-enqueueBackgroundTask` and `tool-getBackgroundTask` parts inline in chat with live SWR status badge, collapsible step log, plain-English error box, and `min-h-11` (≥44px) **Approve** / **Cancel** buttons.

### Implementation Checklist
- [ ] **1.1** Write failing intent-matrix tests in `tests/security/tool-selection-natural.test.ts` covering 30 natural EN/TR phrasings (mail, calendar, drive, PRs, memory, media, tasks, chitchat, and untrusted-read vs. write separation).
- [ ] **1.2** Refactor `selectActiveTools` & `shouldOfferWebSearch` in `lib/ai/context/select-tools.ts` until both the new 30-case suite and all existing `tests/security/*.test.ts` pass.
- [ ] **1.3** Implement `lib/ai/tools/background-task-tools.ts` + `app/api/tasks/[id]/route.ts` and register both tools in `app/(chat)/api/chat/route.ts`.
- [ ] **1.4** Build `components/chat/task-progress-card.tsx`, wire into `components/chat/message.tsx`, and verify iPhone safe-area/touch sizing.

### How Step 1 Is Tested
1. **Unit & Security:** `node --import tsx --test tests/security/tool-selection-natural.test.ts` + full `pnpm test:security` (verifies natural EN/TR phrasing hits the right tool, chitchat sends 0 tools, and private mail/calendar questions never trigger `webSearch`).
2. **Real-Browser Playwright E2E (`scripts/test-task-card-e2e.ts`):** Sends a task prompt in mobile `390×844` Chrome, asserts `TaskProgressCard` renders inline in chat, transitions live from `Queued` → `Running` → `Done` as `/api/tasks/[id]` updates, and handles `Cancel` / `Approve` in one tap.

---

## Step 2 (Detailed): Real Mac mini Worker Jobs + Closed-App Push Notifications

### What You Can Do After Step 2
- Kick off a slow job in chat (e.g., *"Summarise my open PRs and calendar conflicts for tomorrow"* or a scheduled routine), **swipe Safari closed or lock your iPhone**, and walk away.
- Your always-on Mac mini (`launchd` daemon) claims the job from Neon Postgres within seconds, executes it for real (replacing the stub string at `lib/worker/queue-worker.ts:630`), writes live step updates to Postgres, and sends a **native iOS Home-Screen Web Push notification** (plus optional Telegram ping) that deep-links straight back to the finished chat card.

### Effort
- **Medium (~1–1.5 sessions).**

### Files & Interfaces
- **Create:** `lib/db/phase4-push-schema.sql` (wired into `lib/db/ensure-parity-schema.ts`)
  - Additive `PushSubscription` table (`id`, `userId`, `endpoint`, `p256dh`, `auth`, `userAgent`, `createdAt`) + `chatId` / `messageId` columns on `BackgroundTask` so push taps open `/chat/<chatId>`.
- **Create:** `public/sw.js` + `lib/push/web-push.ts` + `app/api/push/subscribe/route.ts`
  - Minimal standards-compliant Web Push service worker (`push` + `notificationclick` focusing or opening `/chat/<chatId>`) using server-side VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` generated once and set via Vercel CLI — zero keys in UI).
  - Plain-English **1-tap "Turn on notifications" row** in `/setup` (and `/usage`) for iPhone Home-Screen PWA (`iOS 16.4+`), with automatic fallback to the existing hardened single-owner Telegram notifier if Web Push isn't enabled.
- **Modify:** `lib/worker/queue-worker.ts` & **Create:** `lib/worker/executors/local-task-executor.ts`
  - Replace the placeholder string on `line 630` with a real task dispatcher (`executeClaimedTask`) that streams step heartbeats (`appendTaskStep`) to Neon Postgres, enforces `containsRestrictedWorkData` before any external call, and calls `notifyOwnerTaskEvent(task)` on `awaiting_approval`, `succeeded`, or `failed`.
  - Keep `scripts/mac-worker.ts` within its ~40 MB RSS cap by running heavy work in short-lived child processes rather than inside the poller V8 heap.

### Implementation Checklist
- [ ] **2.1** Add `PushSubscription` + `BackgroundTask.chatId` schema migration and unit-test VAPID payload encryption & owner-only `/api/push/subscribe` in `tests/security/web-push.test.ts`.
- [ ] **2.2** Add `public/sw.js` and a 1-tap **"Notifications on this iPhone"** toggle in `/setup` (`app/(chat)/setup/page.tsx`).
- [ ] **2.3** Replace the stub in `lib/worker/queue-worker.ts:629-643` with `executeClaimedTask` + live step streaming + push notification trigger on completion/approval.
- [ ] **2.4** Verify `ops/launchd/install-launchd.sh` against the live Neon `POSTGRES_URL` on the Mac mini (`pnpm worker:once` smoke check).

### How Step 2 Is Tested
1. **Automated Worker + Push Test (`tests/security/web-push.test.ts` + `tests/security/mac-worker.test.ts`):** Enqueues a real `BackgroundTask` in `createInMemoryWorkerAdapter`, runs `QueueWorkerEngine.runPollTick()`, verifies real executor output + step logs replace the old stub, and asserts the VAPID push + deep-link payload is emitted on `succeeded` and `awaiting_approval`.
2. **Real Closed-App Smoke Test:** Enqueue a 15-second background task from the iPhone PWA, close the browser tab immediately, let `pnpm worker:once` (or `launchd`) process the row on the Mac mini, confirm the push notification arrives, and tap it to verify `/chat/<chatId>` opens with the completed `TaskProgressCard`.

---

## Step 3 (Detailed): One Subscription Driven End-to-End (`Claude Code` on Mac mini)

### What You Can Do After Step 3
- Type in chat from your iPhone: *"Ask Claude Code to add a unit test for X (or fix bug Y) in `general-purpose-agent-quickstart`"* →
  1. Chat shows an inline **Coding Task Card** (`Creating isolated worktree agent/<slug>…` → `Claude Code editing files…` → `Running biome + tests (1-build lock)…`).
  2. Your Mac mini runs the already-installed `/Users/caglar/.local/bin/claude` CLI using your existing **Claude Pro** subscription login (zero API token spend) inside an isolated git worktree under the **8 GB RAM governor** (`≤3` agents, `≤1` build lock).
  3. When checks pass, the task pauses in **`awaiting_approval`** showing the exact files changed, diff summary, test pass count, and SHA-256 action digest — nothing is pushed or opened as a PR until you tap **Approve**.

### Effort
- **Medium (~1.5 sessions).** *(Picking `Claude Code` first because `/Users/caglar/.local/bin/claude` is already installed on this Mac mini and emits structured `--output-format stream-json` progress events; `codex` and `agy` plug into the exact same `CliAgentDriver` interface in Step 4.)*

### Files & Interfaces
- **Create:** `lib/worker/process-governor.ts`
  - Enforces the 8 GB Mac mini hardware rules before any child spawn:
    - `MAX_CONCURRENT_AGENTS = 3` semaphore across active CLI processes.
    - `withBuildLock(fn)` acquiring `/tmp/assistant-build.lock` so `pnpm check` / `tsc` / `pnpm build` never run two at once.
    - `checkMacMemoryPressure()` reading `vm_stat`: throttles local agent slots to `1` if free+inactive RAM `< 1.2 GB`.
- **Create:** `lib/worker/cli-drivers/types.ts` & `lib/worker/cli-drivers/claude-code.ts`
  ```ts
  export interface CliAgentDriver {
    readonly id: "claude_code" | "codex" | "agy" | "t3";
    checkAuthStatus(): Promise<{ ready: boolean; detail: string }>;
    runInWorktree(opts: {
      worktreePath: string;
      branch: `agent/${string}` | `draft/${string}`;
      prompt: string;
      signal: AbortSignal;
      onStep: (message: string) => Promise<void>;
    }): Promise<{ summary: string; changedFiles: string[]; quotaExhausted?: { resetAt: Date | null } }>;
  }
  ```
  - Spawns `/Users/caglar/.local/bin/claude -p <prompt> --output-format stream-json --max-turns 12` inside a temporary git worktree created via `lib/subagents/worktree-coder.ts` (which already blocks `main`, `master`, `release/*`, and `feature/openai-premium-model-routing`), with a scrubbed `env` (`PATH`, `HOME`, `USER`, `LANG` only — zero app vault secrets leaked into child env) and a 10-minute watchdog timeout.
  - Runs `pnpm check && pnpm test:security` inside `withBuildLock`, captures `git diff --stat`, computes `reviewActionRisk` SHA-256 digest, and parks the task in `awaiting_approval` before any `git push` / `gh pr create`.
- **Modify:** `lib/ai/tools/background-task-tools.ts` & `app/api/setup-status/route.ts`
  - Allow `kind: "coding_worktree"` from chat (*"use Claude Code to…"*, *"fix in repo…"*), and show live **Claude Code on Mac (`Ready` / `Sign in needed`)** status in `/setup` via worker heartbeat.

### Implementation Checklist
- [ ] **3.1** Write failing unit tests in `tests/security/process-governor.test.ts` and `tests/security/claude-driver.test.ts` testing the `≤3` agent cap, `/tmp/assistant-build.lock` serialization, scrubbed child `env`, protected-branch refusal, `429 / Resets in` detection, and mandatory `awaiting_approval` stop before `git push`.
- [ ] **3.2** Implement `lib/worker/process-governor.ts` and `lib/worker/cli-drivers/claude-code.ts` wired into `lib/subagents/worktree-coder.ts` + `lib/worker/queue-worker.ts`.
- [ ] **3.3** Wire `coding_worktree` into `TaskProgressCard` so changed files and **Approve git push & draft PR** render cleanly in chat on iPhone.

### How Step 3 Is Tested
1. **Unit & Mock-CLI Integration:** Fake `claude` fixture script emitting real `stream-json` lines + exit codes (`0`, `429 Resets in 2h`, failing test) verifies worktree creation, live step streaming, build-lock serialization, worktree cleanup, and `awaiting_approval` gating without burning quota.
2. **Live End-to-End Mac Run:** From chat, ask Claude Code to make a tiny harmless doc/test edit on a disposable `agent/smoke-test` branch → verify live progress steps in chat, verify `git status` on the main checkout stays untouched, tap **Approve** (or **Cancel** to discard the worktree cleanly), and confirm push notification fires.

---

## Step 4 (Brief): Quota-Aware Multi-Subscription Router + 1-Tap OAuth

- **What you can do after it:** Ask for any coding, research, UI prototype, song, or video task without naming a tool — the assistant picks the best subscription, tracks rolling limits/reset times (`SubscriptionQuota` table), and fails over automatically mid-task:
  - **Coding & review:** `Antigravity (agy, Ultra 5x)` ↔ `Claude Code (Pro 5h window)` ↔ `Codex CLI (ChatGPT Plus)` + `T3` multi-thread repo runs; **GitHub Copilot Pro** and **Cursor** remain hard-locked (`optInOnly: true`, never used unless you explicitly ask + approve).
  - **Research & offload:** `Gemini Ultra` + secondary `Gemini Pro (csahingoz)` + **Colab** (`1,000` units/mo for heavy Python/`ffmpeg`) + scale-to-zero **Cloud Run** (`$40/mo` GCP credit).
  - **UI & creative media (always approval-gated before credit spend):** **Flow/Veo** (`10,000` Ultra credits first) → **kie.ai** (pre-flight balance check) + **Suno** + **Lovable Pro** (1-tap GitHub OAuth repo sync / Mac sign-in handoff — zero manual keys).
- **Effort:** **Medium–Large (~2 sessions, split into 4a Coding CLIs and 4b Creative/OAuth).**
- **How it's tested:** `tests/security/quota-router.test.ts` simulating `429` / window exhaustion across `claude` → `agy` → `codex`, asserting `OptInRequiredError` on Copilot/Cursor without explicit approval, asserting `BlockedWorkDataError` on Korn Ferry terms across all personal seats, and verifying zero password/key inputs in `/setup`.

---

## Step 5 (Brief): Seamless Hands-Free Voice Operator on Top

- **What you can do after it:** Tap the Live Voice waveform, say *"Have Vibecoder fix the dark-mode badge and ping me when tests pass"*, **lock your iPhone immediately**, get a push notification 3 minutes later, and tap it to hear a 15-second spoken summary with `<100 ms` barge-in (*"Skip the summary — approve the draft PR"*), bound cryptographically to the active `actionDigest`.
- **Effort:** **Small–Medium (~1 session — thin voice relay `POST /api/voice/operator` on top of Steps 1–4 + `DEFAULT_LIVE_MODEL` ready for `gemini-4-live`).**
- **How it's tested:** Extend `scripts/test-live-voice-e2e.ts` in real Chrome: voice turn dispatches a background task in `<80 ms`, WebSocket closes immediately (simulating phone lock), worker completes task, reopening Live Voice speaks the result, and fake-mic barge-in interrupts cleanly with zero echo loop.

---

## Supporting Reference (Compact)

### Where This Beats T3 Code, Hermes Agent & Grok Bot
- **vs. T3 Code:** T3 is desktop-bound and manual on quota limits; our assistant works **hands-free from a locked iPhone**, enforces an **8 GB Mac mini RAM governor**, and fails over automatically across `agy` + `claude` + `codex` + `t3` + creative tools.
- **vs. Hermes Agent:** Hermes requires `.env`/YAML keys and lacks mobile full-duplex voice, iOS push, and cryptographic send/spend approval cards.
- **vs. Grok Bot:** Grok is single-vendor cloud chat with no local Mac git-worktree execution, multi-subscription arbitrage, or hard employer/Korn Ferry firewall.

### Ultra 5x Budget (£0 Net Incremental Cloud Target) & Key Risks
- **£0 net cloud math:** Owned subscriptions are sunk; **US$40/mo (~£31.60/mo) Google AI Ultra GCP credit** (`0140A2-72DEB2-62EDCD` + Free Trial to 11 Feb 2027) covers scale-to-zero Cloud Run, Firebase, `gemini-4-hydrogen`, and Live Voice (~£2–£5/mo raw); **1,000 Colab units** + **10,000 Flow credits** + owned **8 GB Mac mini** (~40 MB poller) handle compute/media; `ModelUsage` ledger caps metered gateway spend.
- **Top risks controlled at every step:** (1) Korn Ferry data blocked pre-flight across all personal tools, (2) 8 GB Mac mini protected by `≤3` agents / `≤1` build lock / `1.2 GB` free-RAM guard, (3) every send & credit spend gated behind SHA-256 approval cards, (4) Copilot Pro & Cursor hard-locked to explicit owner opt-in.
