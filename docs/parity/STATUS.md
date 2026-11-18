# Assistant Feature Parity — Status & Handoff Report

**Branches:** `feat/grokbot-parity` & `feature/openai-premium-model-routing` (PR #10 Preview `● Ready`)  
**Date:** 17 November 2026  
**Owner:** Çağlar (`Europe/London`) · **Guide:** [docs/OWNER_GUIDE.md](../OWNER_GUIDE.md) · **Next Phase Plan:** [PHASE4-PLAN.md](./PHASE4-PLAN.md)

---

## Phase 4 (Steps 1–3) — Operator Parity Complete & Paused for Review

**Steps 1–3 of [PHASE4-PLAN.md](./PHASE4-PLAN.md)** are implemented, tested (`171 / 171` security/unit tests + real-Chrome audio & tool-calling E2E + live GCP VM E2E + live `tmux` smoke test), and deployed (`● Ready`) on `https://general-purpose-agent-quickstart-git-feat-9b1f26-csahingoz-3779.vercel.app`:

1. **Step 1 — Shared Agent Loop, Task/Connect Cards & Gemini 3.8 Live Tool Calling:** Text Chat (8-step agent loop) and Live Voice (`google/gemini-3.8-live`) share the exact same 23-tool registry (`lib/ai/tools/shared-registry.ts`, `lib/voice/live-protocol.ts`, `app/api/voice/live-tool/route.ts`): Gmail/Calendar/Drive read, Open-Meteo weather (zero key), web search, memory, routines, `delegateTask` (`TaskCard`), Cloud Computer, Mac Bridge, and approval-gated drafts (`ApprovalCard` / `OutboundDraftCard`). Voice speaks a short filler (`"Checking your inbox…"`) while tools run, mirrors cards into chat, and shows a 1-tap `ConnectorConnectCard` whenever Google isn't linked yet (never `"I don't have access"`).
2. **Step 2 — Cloud Computer (A): Sandboxed GCP Linux VM (`assistant-computer-01`):** Provisioned `e2-medium` Ubuntu 24.04 LTS VM (`europe-west1-b`, 30 GB persistent `/workspace`, unprivileged `operator` UID 1001, `169.254.169.254` metadata blocked via `iptables`, 20-min idle auto-stop, **£0 net** on $40/mo Google AI Ultra credit) fronted by scale-to-zero Cloud Run `assistant-computer-relay` (`min-instances=0`, internal VPC only). Chat & Live Voice drive `cloudExec`, `cloudWriteFile`, `cloudExportFileToChat` (signed `/api/files/[token]`), and `cloudBrowseUrl`.
3. **Step 3 — Mac mini Bridge (B): Tailscale SSH + `tmux` + CLI Drivers:** `macExec` & `macRunAgentCli` (`claude`, `codex`, `agy`, `t3`; `copilot`/`cursor` explicit opt-in only), 4-tier command policy (`lib/mac-bridge/policy.ts`, no `sudo`, zero Funnel, `/Users/caglar` & Korn Ferry boundaries enforced), 8 GB Mac governor (`≤3` agents, `≤1` `/tmp/assistant-build.lock`, `1.2 GB` free-RAM guard), `ops/mac-bridge/mac-bridge-exec` (`tmux` + `tmux pipe-pane` redacted `.pty.log` & `commands.jsonl`), `ops/mac-bridge/tailscale-acl.hujson`, `ops/mac-bridge/setup-mac-bridge.sh`, and `ops/mac-bridge/revoke-mac-bridge.sh`.

---

## Final Review Summary (All Phases 0 → 3 + Live Voice & Zero-Key UX Complete — READY FOR REVIEW)

Every slice in **[PLAN.md](./PLAN.md)** — **Phase 0**, **Phase 1 (`P1.1–P1.4b`)**, **Phase 2 (`P2.1–P2.3`)**, **Phase 3 (`P3.1–P3.3`)**, plus **Slice 12 (iOS Safe-Area & Settings)** and **Slice 13 (Zero-Key Setup Checklist, One-Tap OAuth & Full-Duplex Gemini 3.8 Live Voice)** — is implemented, verified in real Chromium + unit/security suites, deployed, and `● Ready` on `https://general-purpose-agent-quickstart-git-feat-9b1f26-csahingoz-3779.vercel.app`.

### Complete Phase 0 → Phase 3 Delivery Matrix

| Phase / Slice | Scope Delivered | Key Files & Routes | Status |
| :--- | :--- | :--- | :--- |
| **Phase 0 (`P0.1–P0.5`)** | AES-256-GCM Secret Vault (HKDF + AAD), Profile + Journal memory split, Routines & `BackgroundTask` hub, `<untrusted_content>` fencing, SHA-256 risk reviewer, universal `ApprovalCard` + `OutboundDraftCard` + `QuestionCard`, Skills library & Results drawer | `lib/vault/secret-vault.ts`, `lib/memory/store.ts`, `lib/tasks/runner.ts`, `lib/safety/*`, `lib/skills/library.ts`, `/memory`, `/routines`, `/skills` | **DONE** |
| **Slice 1 (`P1.2`)** | Owner-only HMAC-signed `/api/files/[token]` proxy, AES-256-GCM encrypted file store, magic-byte PDF (10 MB) & CSV (5 MB) upload + deterministic CSV/PDF parsers fenced in `<untrusted_content>`, Cloud Run scale-to-zero budget | `lib/files/*`, `app/(chat)/api/files/*`, `components/chat/multimodal-input.tsx`, `docs/parity/BUDGET.md` | **DONE** |
| **Slice 2 (`P1.1`)** | ~40 MB native Mac mini `launchd` queue worker (`--jitless --max-old-space-size=24`), heavy-workload Cloud Run routing guard, loopback `/healthz` (`127.0.0.1:4319`), 2 MB × 3 token-redacting log rotation | `lib/worker/*`, `scripts/mac-worker.ts`, `ops/launchd/*`, `app/api/worker/health/route.ts` | **DONE** |
| **Slice 3 (`P1.4`)** | Vault-backed **Gmail** & **Google Drive** read + unsent-draft-only connectors (`ApprovalCard` required, URL guard blocks `/send`, `/delete`, `/trash`, `/permissions`, work-data block) | `lib/connectors/google-vault-auth.ts`, `lib/connectors/google-workspace.ts`, `lib/ai/tools/google-connectors.ts`, `app/api/connectors/route.ts` | **DONE** |
| **Slice 4 (`P1.3`) & Slice 13** | Push-to-talk **Voice Memos** (`gemini-4-hydrogen` floor, 3.x text models hard-blocked) + 1-tap full-duplex **Gemini 3.8 Live** hands-free voice (`DEFAULT_LIVE_MODEL` single config constant ready for `gemini-4-live`, zero-key Vercel AI Gateway OIDC WebSocket, iOS `VoiceProcessingIO` AEC + `EchoGate`, `<100 ms` barge-in, `/setup` checklist with zero raw keys in UI) | `lib/voice/live-protocol.ts`, `lib/voice/live-session.ts`, `components/chat/live-voice-engine.ts`, `components/chat/voice-memo-button.tsx`, `app/(chat)/setup/page.tsx` | **DONE** |
| **Slice 5 (`P1.4b`)** | Vault-backed **Google Calendar** (`sendUpdates=none` private tentative `[DRAFT]` events, zero attendee invites) & **GitHub** (`PENDING` unpublished PR reviews, blocks `/merge`/`/delete`) | `lib/connectors/calendar-and-github.ts`, `lib/ai/tools/calendar-github-connectors.ts` | **DONE** |
| **Slice 6 (`P2.1`)** | **Multi-Bot Specialist Teammate Roster** (*Chief of Staff*, *Finance Controller*, *Vibecoder* + custom bots), `@bot:<slug>` selector, mascot color switching, shared vs. bot-private `MemoryProfileFact` scoping | `lib/bots/roster.ts`, `app/api/bots/route.ts`, `app/(chat)/teammates/page.tsx` | **DONE** |
| **Slice 7 (`P2.2`)** | Constant-time **HMAC-SHA256 Event Webhooks** (`POST /api/webhooks/[source]`) + **Hardened Single-Owner Telegram** inline-keyboard Approve/Deny callbacks bound to SHA-256 action digest | `lib/webhooks/event-triggers.ts`, `app/api/webhooks/[source]/route.ts`, `lib/telegram-hardened.ts`, `app/api/telegram-webhook/route.ts` | **DONE** |
| **Slice 8 (`P2.3`)** | **Read-Only Published Page Snapshots** (`/share/[token]`): SHA-256 hashed 192-bit tokens, owner-email/script scrubbing, work-data block, `GET`-only `proxy.ts` allowlist, instant 1-click revoke | `lib/share/published-pages.ts`, `app/api/share/route.ts`, `app/share/[token]/page.tsx`, `components/chat/results-sheet.tsx` | **DONE** |
| **Slice 9 (`P3.1`)** | **Visual Computer-Use Browser Subagent** safety & trace engine: SSRF block, domain allowlist, hard-pause in `awaiting_approval` on login/password/payment/submit, CAPTCHA human handoff (never bypassed), Cloud Run multi-step offload | `lib/subagents/browser-agent.ts`, `app/api/subagents/browser/route.ts`, `app/(chat)/routines/page.tsx` | **DONE** |
| **Slice 10 (`P3.2`)** | **Isolated Git-Worktree Coding Subagent**: enforces `agent/*` or `draft/*` branches (blocks `main`, `master`, `release/*`, `feature/openai-premium-model-routing`), serializes check+test, requires approval before `git push` | `lib/subagents/worktree-coder.ts`, `app/api/subagents/coder/route.ts` | **DONE** |
| **Slice 11 (`P3.3`)** | **Imagen / Veo Media Studio** (`ModelUsage` spend reservation `$0.04`/`$0.35` *before* API call, `PrivateFileStore` + `artifacts/image` + `MediaPreviewCard`) & **Meeting Copilot** (fenced speaker turns, injection quarantine, `awaiting_approval` review gate) | `lib/media/media-studio.ts`, `lib/ai/tools/generate-media.ts`, `artifacts/image/server.ts`, `components/chat/media-preview-card.tsx`, `lib/meetings/meeting-copilot.ts`, `app/api/media/generate/route.ts`, `app/api/meetings/ingest/route.ts` | **DONE** |

### Final Verification Metrics
- **Biome Lint & Format (`pnpm check`):** **PASS** (`0` errors across `322` files).
- **TypeScript (`tsc --noEmit`):** **PASS** (`0` errors).
- **Impeccable UI Anti-Pattern Audit:** **PASS** (`[]` — `0` issues; zero raw key inputs anywhere in UI; plain-English errors only; `viewportFit: "cover"` + iPhone safe-area insets on every screen, sheet, and overlay).
- **Security & Acceptance Suite (`pnpm test:security`):** **159 / 159 PASS** (`0` failures across 23 test files, including `live-voice-protocol.test.ts` and `voice-memos-live.test.ts`).
- **Real-Browser Chrome Audio & Mobile UI E2E (`scripts/test-live-voice-e2e.ts` + `scripts/test-model-readiness-ui.ts`):** **PASS** (`3 / 3` live-voice WebSocket + fake-mic audio E2E tests verifying 0 leaked echo frames during `-40 dBFS` speaker bleed, cough rejection, `<100 ms` barge-in, and zero-key AI Gateway subprotocol turns, plus mobile readiness & zero-raw-key UI checks).
- **Vercel Preview Build & Live Gemini 3.8 Live Probe:** **PASS (`● Ready`)** — `Live voice self-check: PASS transport=gateway model=google/gemini-3.8-live firstAudio=543ms transcript="Voice check complete."`
- **Model Floor & Single-Value Live Upgrade Rule:** `3.x` text/Flash models remain hard-blocked (`gemini-4-hydrogen` minimum for non-Live Gemini STT/subagents). Owner-approved `gemini-3.8-live` is isolated to the single constant `DEFAULT_LIVE_MODEL` in `lib/voice/live-protocol.ts` (or `GEMINI_LIVE_MODEL` env var) so switching to `gemini-4-live` on release day is a one-value change.

### Live External Items Intentionally Skipped / Deferred Pending Owner Action
No live external APIs, paid subscriptions, `launchctl` daemon loads, shared-DB migrations, or remote git pushes were executed. When ready to activate live external integrations, perform only the ones you want:
1. **Isolated Postgres Schema Apply:** Run `psql "$ISOLATED_POSTGRES_URL" -f lib/db/usage-schema.sql` and `psql "$ISOLATED_POSTGRES_URL" -f lib/db/parity-schema.sql` against an **isolated** database (never a shared preview/prod Neon branch without review).
2. **Master Vault Key & Live Provider Tokens:** Set `SECRET_VAULT_KEY` (`openssl rand -base64 32`) in your local `.env.local`, then save real credentials via `/routines -> Secret Vault` (`GEMINI_API_KEY` for Voice/Imagen/Veo, `GOOGLE_OAUTH_ACCESS_TOKEN` or `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` for personal Gmail/Drive/Calendar, `GITHUB_CONNECTOR_PAT` for GitHub PR read/drafts).
3. **Opt-In Feature Flags (All Default `false`):** Flip only the capabilities you want active (`MEMORY_TOOLS_ENABLED`, `ROUTINES_ENABLED`, `GOOGLE_CONNECTORS_ENABLED`, `GITHUB_CONNECTOR_ENABLED`, `VOICE_ENABLED`, `WEBHOOK_TRIGGERS_ENABLED`, `TELEGRAM_WEBHOOK_ENABLED`, `MEDIA_STUDIO_ENABLED`).
4. **Mac mini `launchd` Daemon & Optional Cloud Run Worker:** Run `./ops/launchd/install-launchd.sh --dry-run` to inspect the rendered plist, then `./ops/launchd/install-launchd.sh` if you want the ~40 MB local poller active on your Mac mini. Deploy a scale-to-zero Cloud Run worker (`CLOUD_RUN_WORKER_URL`) only if you want live cloud execution for multi-step Playwright or batch media jobs.
5. **Live Vision Model Flag (`vision: true`) & Live Local Audio Capture Device:** Image upload + signed `/api/files/[token]` proxy is live; flipping `vision: true` in `lib/ai/models.ts` awaits confirming vision entitlement on your live OpenAI/AI Gateway lane. `POST /api/meetings/ingest` accepts recorded audio clips (`audioBytes`) or transcripts today; native macOS system-audio loopback (`ScreenCaptureKit`/BlackHole) requires local macOS TCC screen/audio permission from the owner.

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

- **Lint & Format (`pnpm check`):** PASS (0 errors across 310 files).
- **TypeScript (`pnpm exec tsc --noEmit`):** PASS (0 errors).
- **Security & Regression Suite (`pnpm test:security`):** **148 / 148 PASS** (103 existing baseline assertions + 45 Phase 0–3 tests covering AES-256-GCM AAD vault integrity, owner-only signed file proxy URLs, PDF/CSV magic-byte & parser safety, ~40 MB `launchd` queue worker + log rotation + loopback `/healthz`, vault-backed Gmail/Drive/Calendar/GitHub read + unsent-draft-only URL guards, push-to-talk voice memos & 3.x model blocks, multi-bot teammate scoping, HMAC event webhooks & signed Telegram inline approvals, revocable `/share/[token]` snapshots, browser subagent & git-worktree coder safety gates, Imagen/Veo `ModelUsage` spend reservations, and fenced Meeting Copilot reviews).
- **Playwright Mobile & Desktop UI Suite (`pnpm test:readiness-ui`):** **5 / 5 PASS** (`390×844` phone and `1440×1000` desktop viewports: 16px composer text, ≥44px touch targets, no horizontal overflow, local inbox filtering, History reload, and `/usage` route slot).
- **Production Dependency Audit (`pnpm audit --prod`):** **0 vulnerabilities found**.
- **Production Build (`POSTGRES_URL="" pnpm build`):** **PASS** (all 56 static/dynamic App Router routes compiled cleanly with 0 warnings and zero live inference or DB writes).

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

### Slice 11 (`P3.3` — Image/Video Generation & Meeting Copilot): DONE
- **What changed (in plain English):** Added opt-in **Media Studio** (`MEDIA_STUDIO_ENABLED=true`, `lib/media/media-studio.ts`, `lib/ai/tools/generate-media.ts`, `components/chat/media-preview-card.tsx`, `POST /api/media/generate`) wiring Google **Imagen** image generation into both an inline signed preview card and the `artifacts/image` viewer, plus approval-gated **Veo** short video generation routed off the 8 GB Mac mini to Google's cloud poller. Every media request decrypts `GEMINI_API_KEY` from your Secret Vault, blocks Korn Ferry/employer prompts, and **reserves spend in `ModelUsage` (`$0.04` per image / `$0.35` per video clip) before calling the API**, aborting with zero spend if your `$10/mo` allowance is reached. Also added **Meeting Copilot** (`lib/meetings/meeting-copilot.ts` + `POST /api/meetings/ingest`) for grounded pre-meeting briefs and post-meeting transcript/audio ingestion: every external speaker turn is wrapped inside `<untrusted_content>` fences, prompt-injection speaker turns are quarantined, and the resulting journal note, candidate profile facts, and unsent follow-up drafts are parked in `awaiting_approval` so nothing is saved to your profile or sent without your review.

### Slice 12 (iOS UX Audit, Mobile Sheet Foreground Fix, Voice Dictation & Settings Alignment): DONE
- **What changed (in plain English):** Fixed all real-iPhone UX regressions and matched secondary screens to the warm iOS shell (`docs/ui/DESIGN.md` & `FOUR_SESSION_BUILD.md`):
  1. **Settings no longer opens behind the mobile sheet:** `SidebarUserNav` and `SidebarProvider` now close the mobile History bottom sheet on every menu selection or route change, and `Chat options (...)` also offers 1-tap access to **Usage & settings**.
  2. **Voice works out-of-the-box on iPhone PWA & Safari:** Wired `POST /api/voice/transcribe` directly into the active Vercel AI Gateway OIDC lane (`openai/gpt-4o-mini-transcribe` with `$0.01` `ModelUsage` spend reservation) when Secret Vault voice keys aren't set, plus synchronous browser `SpeechRecognition` dictation when offline/local — eliminating raw `VOICE_ENABLED=true` error toasts.
  3. **iOS Safe-Area Top Clearance & Docked Preview Toolbar:** Added shared `SubpageHeader` (`env(safe-area-inset-top)` clearance + 1-tap workspace pill switcher + docked Vercel preview toolbar) and safe-top `<Toaster />` offsets so `Back to chat` and toasts never sit inside the iOS clock/status-bar blur zone.
  4. **Unified iOS Settings & Calm Workspace Forms:** Upgraded `/usage` with Appearance (System/Light/Dark), Mascot theme picker, Home location, honest live Capability status badges, a visual spend progress bar, and collapsible call logs; replaced raw cron/developer SQL banners and monospace form inputs across `/routines`, `/memory`, `/skills`, and `/teammates`.

### Slice 13 (Zero-Key Setup Checklist, One-Tap OAuth & Full-Duplex Gemini 3.8 Live Voice): DONE
- **What changed (in plain English):**
  1. **Hands-free full-duplex Live Voice (`gemini-3.8-live`):** Tapping the right-hand waveform button in the empty composer immediately opens a full-screen voice call over Vercel AI Gateway's Realtime WebSocket (`google/gemini-3.8-live` via automatic Vercel OIDC — zero personal API keys required). Uses iPhone `play-and-record` hardware echo cancellation + `EchoGate` digital-silence gating so the assistant never hears its own speaker output, supports natural barge-in (or tapping the mascot orb to interrupt), and mirrors every completed turn into your chat transcript.
  2. **Single-value upgrade to Gemini 4 Live:** `DEFAULT_LIVE_MODEL = "gemini-3.8-live"` in `lib/voice/live-protocol.ts` (overridable via `GEMINI_LIVE_MODEL` in Vercel) is the single source of truth; changing it to `"gemini-4-live"` upgrades both AI Gateway and direct Live sessions automatically.
  3. **Zero raw keys in the UI:** Removed all manual API-key paste fields from `/setup` and `/routines`. Backend keys live strictly in Vercel environment / integrations; `/setup` shows a plain-English status checklist with one-tap **Connect** buttons for personal apps.

---

## 5. Exact Commands to Run & Preview Locally

```bash
cd /Users/caglar/.t3/worktrees/general-purpose-agent-quickstart/feat-grokbot-parity-e6766ad591e9f9aa

# 1. Run lint, typecheck, and all 148 security/acceptance tests (serialized)
pnpm check && pnpm exec tsc --noEmit && pnpm test:security

# 2. (Optional) Apply additive usage + parity tables to an ISOLATED local/dev Postgres ONLY
# psql "$LOCAL_DEV_POSTGRES_URL" -f lib/db/usage-schema.sql
# psql "$LOCAL_DEV_POSTGRES_URL" -f lib/db/parity-schema.sql

# 3. (Optional) Smoke-test or dry-run install the ~40 MB Mac mini launchd queue worker
POSTGRES_URL="" pnpm worker:once
./ops/launchd/install-launchd.sh --dry-run

# 4. Run credential-free production build check
POSTGRES_URL="" OPENAI_API_USAGE_ENABLED="false" AI_GATEWAY_USAGE_ENABLED="false" pnpm build

# 5. Start local dev server and preview new surfaces
pnpm dev
# Visit:
# - http://localhost:3000/           (Chat + PDF/CSV '+' uploads + Mic memo + Results publish drawer + @skill:<slug> + @bot:<slug>)
# - http://localhost:3000/teammates  (Specialist Multi-Bot Teammate Roster & custom bots)
# - http://localhost:3000/routines   (Routines presets, Background Tasks Approve/Cancel, Secret Vault)
# - http://localhost:3000/memory     (Profile facts + Journal timeline)
# - http://localhost:3000/skills     (Built-in & custom Skills Library)
```
