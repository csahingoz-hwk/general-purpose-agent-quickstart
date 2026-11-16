# Assistant Feature Parity — Status & Handoff Report

**Branch:** `feat/grokbot-parity` (worktree only — `feature/openai-premium-model-routing` and remotes untouched)  
**Date:** 16 November 2026  
**Owner:** Çağlar (`Europe/London`)

---

## 1. What Was Completed

### Deliverables 1–3: Parity Architecture & Budget Docs
1. **[GAP_ANALYSIS.md](./GAP_ANALYSIS.md)**: Audited all 8 reference assistant capability domains via dedicated lightweight read-only per-area subagents (max 3 concurrent to respect the loaded **8 GB RAM Mac mini**) against the actual security-hardened AI SDK 7 codebase (citing exact `file:line` references, distinguishing tutorial stubs from active features, and scoring Effort `S/M/L`, Value `1–5`, and Priority `P0–P3`).
2. **[PLAN.md](./PLAN.md)**: Sequenced roadmap from **Phase 0** (in-repo safety, approvals, memory split, routines/tasks, vault) → **Phase 1** (resource-aware ~40 MB native `launchd` worker on the 8 GB Mac mini + Colab/RunPod heavy offload, PDF/CSV finance attachments, Gemini Live API voice, read/draft connectors) → **Phase 2** (multi-bot teammates, signed event webhooks, Telegram inline approvals, shareable page snapshots) → **Phase 3** (computer-use browser subagent, git-worktree coder, Imagen/Veo media, meeting copilot), with acceptance criteria and tests per slice.
3. **[BUDGET.md](./BUDGET.md)**: Cheapest-first `£/month` comparison grounded in confirmed Google Cloud billing (`0140A2-72DEB2-62EDCD`: US$100 Nov → US$40/mo Dec Ultra 5x credit + Free Trial to 11 Feb 2027 covering all of Google Cloud), **scale-to-zero Cloud Run** preferred over always-on VMs, and the **8 GB RAM Mac mini** (~40 MB `launchd` poller only — no heavy jobs locally). Recommended Default Stack totals **~£6.50–£15.40/month** out-of-pocket (typical **~£6.50–£11.50/mo**), alongside a Cloud Upgrade Stack (~£30–£48/mo).

### Deliverable 4: Phase 0 + Phase 1 Bonus Slices Implemented

- **Encrypted Secret Vault (`lib/vault/secret-vault.ts`, `app/api/vault/route.ts`):**
  - Server-only **AES-256-GCM** encryption using HKDF-SHA256 key derivation from `SECRET_VAULT_KEY` (≥32 chars) and authenticated additional data (`AAD = userId:secretName`) preventing cross-user or cross-key ciphertext swapping.
  - Owner-only REST API returning masked key hints (`••••abcd`) only; plaintext never leaves server memory or enters LLM context.
- **Long-Term Memory: Profile + Journal Split (`lib/memory/store.ts`, `lib/ai/tools/memory-tools.ts`, `app/api/memory/route.ts`, `app/(chat)/memory/page.tsx`):**
  - Clean separation between keyed **Profile facts** (with `sharedAcrossBots: boolean` for future specialist bots) and chronological **Journal entries** (with tag and keyword filtering).
  - Mobile-first `/memory` inspector & editor, plus opt-in chat tools (`saveProfileFact`, `addJournalEntry`, `recallMemories`) gated behind `MEMORY_TOOLS_ENABLED=true`.
- **Routines Hub & Background Task Runner (`lib/cron/routine-presets.ts`, `lib/tasks/runner.ts`, `app/api/schedules/*`, `app/api/tasks/route.ts`, `app/(chat)/routines/page.tsx`):**
  - Upgraded routines management with 4 UK/finance presets (*Weekday 08:00 Brief*, *Month-End Close WD 1–5*, *Weekday 07:30 FX Pulse*, *Friday 17:00 Wrap-Up*), strict 5-field cron & IANA timezone validation, pause/resume toggles, approval-gated `scheduleTask` tool (`ROUTINES_ENABLED=true`), and a `BackgroundTask` state machine (`queued → running → awaiting_approval → succeeded/failed/cancelled`) with safe dry-run previews.
  - Preserved the fail-closed `401`/`503` lock on unattended `GET /api/cron/tick`.
- **Safety: Untrusted-Content Fencing, Risk Reviewer, Universal Approval Cards & Draft-Before-Send (`lib/safety/*`, `lib/ai/tools/draft-outbound.ts`, `lib/ai/tools/ask-question.ts`, `components/chat/*`):**
  - `fenceUntrustedContent` strips hidden control/bidi override characters, escapes nested `</untrusted_content>` breakout tags, and flags EN/TR prompt-injection patterns.
  - `reviewActionRisk` computes canonical SHA-256 action digests and escalates state-changing/outbound actions when untrusted content is present.
  - Wired `ApprovalCard` for *all* `needsApproval` tools, `OutboundDraftCard` for `draftOutboundMessage` (exact recipient/subject/body + SHA-256 digest + dry-run receipt), and `QuestionCard` for structured clarifying multi-choice prompts (`askUserQuestion`).
  - Added all write/draft/memory/routine tools to `STATE_CHANGING_TOOLS` in `selectActiveTools` so they never coexist with untrusted `webSearch` results.
- **Phase 1 Bonus — Skills Library & Conversation Results Drawer (`lib/skills/library.ts`, `app/(chat)/skills/page.tsx`, `lib/results-extractor.ts`, `components/chat/results-sheet.tsx`):**
  - Built-in finance & vibecoding playbooks (`@skill:month-end-close`, `@skill:ksa-eosb-audit`, `@skill:variance-commentary`, `@skill:vibecode-audit`) plus custom per-owner skills in `/skills` (`SkillEntry` table), injected only when explicitly invoked via `@skill:<slug>` (or `/skill:<slug>`, bypassed from slash-menu collision).
  - Added **Results in this chat** drawer inside the Chat Options popover summarizing OpenUI cards, Fixtures, Weather, Outbound Drafts, and Canvas Artifacts and scrolling directly to `data-message-id`.

---

## 2. Verification Summary

- **Lint & Format (`pnpm check`):** PASS (0 errors across 276 files).
- **TypeScript (`pnpm exec tsc --noEmit`):** PASS (0 errors).
- **Security & Regression Suite (`pnpm test:security`):** **133 / 133 PASS** (103 existing baseline assertions + 30 Phase 0/Phase 1 tests covering AES-256-GCM AAD vault integrity, owner-only signed file proxy URLs, PDF/CSV magic-byte & parser safety, ~40 MB `launchd` queue worker + log rotation + loopback `/healthz`, vault-backed Gmail/Drive read + unsent-draft-only URL guards, untrusted fence breakouts, Profile+Journal isolation, routines/tasks, skills, and results extraction).
- **Playwright Mobile & Desktop UI Suite (`pnpm test:readiness-ui`):** **5 / 5 PASS** (`390×844` phone and `1440×1000` desktop viewports: 16px composer text, ≥44px touch targets, no horizontal overflow, local inbox filtering, History reload, and `/usage` route slot).
- **Production Dependency Audit (`pnpm audit --prod`):** **0 vulnerabilities found**.
- **Production Build (`POSTGRES_URL="" pnpm build`):** **PASS** (all 46 static/dynamic App Router routes compiled cleanly with zero live inference or DB writes).

---

## 3. Open Decisions, Credentials & Risks

### Decisions / Setup Deferred to Owner (Not Blocking Local Code)
1. **Isolated Database Schema Provisioning:** Following `lib/db/usage-schema.sql` convention, `lib/db/parity-schema.sql` (`MemoryProfileFact`, `MemoryJournalEntry`, `VaultSecret`, `BackgroundTask`, `SkillEntry`) is **additive and NOT auto-applied during `pnpm build`** because Preview and Production may share Neon settings. Apply it only to an approved isolated database. Until applied, `/memory`, `/routines`, and `/skills` degrade gracefully with clear setup banners.
2. **Explicit Feature Opt-In Flags (Default `false`):**
   - `SECRET_VAULT_KEY`: Generate via `openssl rand -base64 32` locally before saving encrypted vault secrets.
   - `MEMORY_TOOLS_ENABLED=true`: Opt-in to expose `saveProfileFact`, `addJournalEntry`, and `recallMemories` in chat turns.
   - `ROUTINES_ENABLED=true`: Opt-in to expose approval-gated `scheduleTask` in chat turns.
3. **Unattended Cloud Cron & Live Outbound Send:** Intentionally kept in **dry-run / paused mode** until the Phase 1 Mac mini worker daemon and scoped OAuth connectors are reviewed by the owner.

### Key Risks, Governance Constraints & Mitigations
- **Korn Ferry / employer data confidentiality (HARD CONSTRAINT):** Work/Korn Ferry material must **never** be sent to the personal Google project (Colab, AI Studio, Gemini API, Antigravity/`agy`, personal Cloud Run/Drive), **DeepSeek** (including AI Gateway search routes backed by DeepSeek), or **free OpenRouter / `opencode` models**. Keep work data strictly local/deterministic or inside employer-approved enterprise tenants.
- **Model floor & Copilot burn:** Never use `Gemini 3.8 Flash` or any `3.x Flash` model (minimum light/subagent model is **`gemini-4-hydrogen`**, or `GPT-6.1 Terra` / `Claude Haiku 5.5`), and avoid GitHub Copilot for agentic loops due to rapid credit burn.
- **8 GB RAM Mac mini memory pressure:** Never run rendering, Docker Desktop, or heavy containers on the 8 GB Mac mini; keep it strictly as a ~40 MB native `launchd` poller and route heavy/rendering jobs to **Colab** (personal data only) or **RunPod**.
- **Prompt injection via future email/webhook/PDF connectors:** Mitigated in advance by `fenceUntrustedContent`, `STATE_CHANGING_TOOLS` mutual exclusion on `webSearch` turns, tamper-proof `applyApprovalResponses`, and mandatory `OutboundDraftCard` human approval.
- **Surprise API & Cloud bills:** Chat calls remain gated by `OPENAI_API_USAGE_ENABLED` / `AI_GATEWAY_USAGE_ENABLED` and the `$10/mo` `ModelUsage` reservation cap; personal GCP retains its ~£5/mo budget alert; **Cloud Run (scale-to-zero)** is preferred over always-on VMs so idle compute costs £0 and preserves the confirmed US$40/mo GCP credit (plus Free Trial through 11 Feb 2027) for active runs and per-use **Gemini Live API (current model)** / `gemini-4-hydrogen` calls.
- **Mobile viewport regressions:** All new controls use `min-h-11` (≥44px) touch targets and `text-[16px]` inputs (preventing iOS Safari auto-zoom) inside the existing `RouteSlot` layout.

---

## 4. Phase 1 Slices — Plain-English Progress Log

### Slice 1 (`P1.2` — Private File Proxy + PDF & CSV Attachments): DONE
- **What changed (in plain English):** You can now attach **PDFs** (up to 10 MB) and **CSVs** (up to 5 MB), alongside JPEG/PNG images (up to 5 MB), directly from the `+` button in chat. Uploaded files are no longer exposed on public URLs: every file is checked for real file headers (blocking disguised or password-locked files), encrypted at rest with **AES-256-GCM**, and served only through an **owner-only signed `/api/files/[token]` link** that checks both your login session and a cryptographic signature. When you send a PDF or CSV in chat, the server converts it into clean, structured text (including exact column totals for CSV spreadsheets) wrapped inside an untrusted-content safety fence so hidden prompt instructions inside a document cannot trick the assistant.

### Slice 2 (`P1.1` — Lightweight Mac mini `launchd` Queue Worker): DONE
- **What changed (in plain English):** Added a tiny background queue worker (`pnpm worker:once` / `ops/launchd/install-launchd.sh`) tailored specifically for the **8 GB RAM Mac mini**. It compiles to plain JavaScript so Node runs without `tsx` bloat (`--jitless --max-old-space-size=24`, ~40 MB target cap), claims due scheduled routines and queued background tasks one at a time, pauses risky tasks for your approval, and automatically refuses heavy video/container/batch jobs locally (deferring them to scale-to-zero Cloud Run while blocking employer/Korn Ferry material from personal cloud endpoints). It exposes a local-only health check (`http://127.0.0.1:4319/healthz` + `/api/worker/health`), rotates logs automatically at 2 MB × 3 backups (redacting any tokens), and self-recycles cleanly for `launchd` auto-restart if memory ever creeps up.

### Slice 3 (`P1.4` — Vault-Backed Gmail & Google Drive Read + Draft Connectors): DONE
- **What changed (in plain English):** Added opt-in **Gmail** and **Google Drive** connectors (`GOOGLE_CONNECTORS_ENABLED=true`) whose OAuth tokens are decrypted on the server directly from your **AES-256-GCM Secret Vault** (supporting either a direct token or auto-refreshing OAuth credentials, with masked status at `/api/connectors`). The connectors can **read** recent Gmail emails and Google Drive docs (wrapping all external text inside `<untrusted_content>` prompt-injection fences and keeping reads separated from state-changing tools) and can **save unsent Gmail drafts** (`gmailCreateDraft`) or **private `[DRAFT]` Google Docs** (`driveCreateDraftDoc`) only after you click Allow on the **reused `ApprovalCard`**. Live sending, deleting, trashing, or sharing files is hard-blocked at the URL safety layer, and Korn Ferry/employer terms are blocked from personal Gmail/Drive.

### Slice 4 (`P1.3` — Voice Memos & Gemini Live Voice Sheet): DONE
- **What changed (in plain English):** Added a push-to-record **microphone button** in the chat composer (`components/chat/voice-memo-button.tsx`) and a **Live Voice Session sheet** (`POST /api/voice/transcribe` + `POST /api/voice/live-session`). Dictated voice clips (up to 10 MB in WebM/MP4/Ogg/WAV/MP3) are transcribed into editable composer text using **`gemini-4-hydrogen`** (or `OPENAI_VOICE_API_KEY` if preferred — hard-blocking any `3.x` model), with automatic fallback to text chat if mic permission is denied. Live voice sessions use **Gemini Live API (current model)** via keys decrypted on the server from your Secret Vault (`VOICE_ENABLED=true`, never exposing raw API keys to the browser, estimating audio token usage, and blocking Korn Ferry/employer material from personal voice endpoints).

### Slice 5 (`P1.4b` — Vault-Backed Google Calendar & GitHub Read + Draft Connectors): DONE
- **What changed (in plain English):** Completed the remaining Phase 1 connectors for **Google Calendar** (`calendarReadEvents` + `calendarCreateDraftEvent`) and **GitHub** (`githubReadPullRequests` + `githubCreateDraftReview`, gated behind `GITHUB_CONNECTOR_ENABLED=true` and `GITHUB_CONNECTOR_PAT` in your Secret Vault). Calendar drafts are saved strictly as private tentative `[DRAFT]` entries with `sendUpdates=none` so **no attendee invites are ever emailed**, and GitHub review drafts omit the submit event so GitHub stores them as **unpublished `PENDING` draft reviews** visible only to you — after you approve them via `ApprovalCard`. Merges, deletes, and public broadcasts are blocked at the URL guard layer.

### Slice 6 (`P2.1` — Multi-Bot Teammate Roster & Scoped Shared Memory): DONE
- **What changed (in plain English):** Added a `/teammates` roster page (reachable from the user menu and `/teammates` slash command, or inline in chat via `@bot:<slug>`) pre-seeded with three specialist teammates: **Chief of Staff** (`blue`), **Finance Controller** (`green`), and **Vibecoder** (`purple`), plus custom teammate creation (`BotProfile` table). Activating a teammate switches the mascot color theme, applies that teammate's domain persona and default skills in chat, shares core profile facts marked `sharedAcrossBots: true`, and keeps private `sharedAcrossBots: false` facts isolated to the teammate that saved them.

### Slice 7 (`P2.2` — HMAC Event Webhooks & Hardened Telegram Inline Approvals): DONE
- **What changed (in plain English):** Added an opt-in signed event webhook endpoint (`POST /api/webhooks/[source]`, gated behind `WEBHOOK_TRIGGERS_ENABLED=true`) that verifies GitHub/custom **HMAC-SHA256** signatures in constant time, wraps payloads in `<untrusted_content>` fences, and queues matching background tasks (auto-escalating suspicious payloads to require approval). Also built the hardened single-owner Telegram handler (`TELEGRAM_WEBHOOK_ENABLED=true` — staying locked at `503` by default) that drops unlinked `chat.id` messages with zero spend and verifies compact **HMAC-signed inline-keyboard Approve/Deny buttons** bound to the exact SHA-256 action digest.

### Slice 8 (`P2.3` — Read-Only Published Page Snapshots `/share/[token]`): DONE
- **What changed (in plain English):** Added 1-click **"Publish read-only snapshot"** and **"Revoke"** controls inside the **Results in this chat** drawer (`components/chat/results-sheet.tsx`), backed by `PublishedPage` (`app/api/share/route.ts` + `app/share/[token]/page.tsx`). Published links store only the SHA-256 hash of a 192-bit random token, scrub your email address and scripts, block Korn Ferry/employer terms, never expose chat messages or other documents, allow unauthenticated `GET /share/[token]` only, and return `404` the instant you click Revoke.

### Slice 9 (`P3.1` — Visual Computer-Use Browser Subagent Safety & Trace Engine): DONE
- **What changed (in plain English):** Added the `browser_agent` task runner (`lib/subagents/browser-agent.ts` + `POST /api/subagents/browser`) plus an **Approve** button on `awaiting_approval` tasks in `/routines`. Every browser step checks a domain allowlist, blocks private-network SSRF URLs, routes multi-step sessions to scale-to-zero Cloud Run (protecting the 8 GB RAM Mac mini), and immediately hard-pauses in `awaiting_approval` if it encounters a non-allowlisted domain, login/password field, checkout/payment/submit button, or anti-bot/CAPTCHA screen (handing back to you rather than ever attempting a bypass), saving the full step trace in `BackgroundTask`.

### Slice 10 (`P3.2` — Isolated Git-Worktree Coding Subagent): DONE
- **What changed (in plain English):** Added the `coding_worktree` task profile (`lib/subagents/worktree-coder.ts` + `POST /api/subagents/coder`) that restricts coding tasks strictly to isolated `agent/<slug>` or `draft/<slug>` worktree branches — hard-blocking `main`, `master`, `release/*`, and `feature/openai-premium-model-routing`. It serializes `pnpm check` and `pnpm test:security` so two builds never run at once on the 8 GB Mac mini, fails the task immediately if checks or tests fail, and pauses in `awaiting_approval` with a SHA-256 action digest before any `git push` can happen.

### Remaining / Next Up (Wait for Owner Go-Ahead)
1. **Provision isolated local/preview Postgres** and apply `lib/db/usage-schema.sql` + `lib/db/parity-schema.sql`.
2. **P1.3 Voice Memos + Gemini Live Sheet:** Push-to-talk memo transcription (`gemini-4-hydrogen` / OpenAI STT) in `MultimodalInput` + ephemeral-token **Gemini Live API (current model)** voice session billed against the confirmed US$40/mo GCP credit (personal/non-KF use only).
3. **Phase 2:** Multi-bot specialist teammates, HMAC event webhooks, hardened Telegram inline approvals, and signed read-only `/share/[token]` page snapshots.

---

## 5. Exact Commands to Run & Preview Locally

```bash
cd /Users/caglar/.t3/worktrees/general-purpose-agent-quickstart/feat-grokbot-parity-e6766ad591e9f9aa

# 1. Run lint, typecheck, and all 133 security/unit tests
pnpm check && pnpm exec tsc --noEmit && pnpm test:security

# 2. (Optional) Apply additive parity tables to an ISOLATED local/dev Postgres ONLY
# psql "$LOCAL_DEV_POSTGRES_URL" -f lib/db/parity-schema.sql

# 3. (Optional) Smoke-test or dry-run install the ~40 MB Mac mini launchd queue worker
POSTGRES_URL="" pnpm worker:once
./ops/launchd/install-launchd.sh --dry-run

# 4. Run credential-free production build check
POSTGRES_URL="" pnpm build

# 5. Start local dev server and preview new surfaces
pnpm dev
# Visit:
# - http://localhost:3000/          (Chat + PDF/CSV '+' attachments + Results drawer + @skill:<slug>)
# - http://localhost:3000/routines  (Routines presets, Background Tasks, Secret Vault)
# - http://localhost:3000/memory    (Profile facts + Journal timeline)
# - http://localhost:3000/skills    (Built-in & custom Skills Library)
```
