# Assistant Feature Parity — Status & Handoff Report

**Branch:** `feat/grokbot-parity` (worktree only — `feature/openai-premium-model-routing` and remotes untouched)  
**Date:** 16 November 2026  
**Owner:** Çağlar (`Europe/London`)

---

## 1. What Was Completed

### Deliverables 1–3: Parity Architecture & Budget Docs
1. **[GAP_ANALYSIS.md](./GAP_ANALYSIS.md)**: Audited all 8 reference assistant capability domains via dedicated lightweight read-only per-area subagents (max 3 concurrent to respect the loaded **8 GB RAM Mac mini**) against the actual security-hardened AI SDK 7 codebase (citing exact `file:line` references, distinguishing tutorial stubs from active features, and scoring Effort `S/M/L`, Value `1–5`, and Priority `P0–P3`).
2. **[PLAN.md](./PLAN.md)**: Sequenced roadmap from **Phase 0** (in-repo safety, approvals, memory split, routines/tasks, vault) → **Phase 1** (resource-aware ~40 MB native `launchd` worker on the 8 GB Mac mini + GCP Linux VM offload, PDF/CSV finance attachments, Gemini Live voice, read/draft connectors) → **Phase 2** (multi-bot teammates, signed event webhooks, Telegram inline approvals, shareable page snapshots) → **Phase 3** (computer-use browser subagent, git-worktree coder, Imagen/Veo media, meeting copilot), with acceptance criteria and tests per slice.
3. **[BUDGET.md](./BUDGET.md)**: Cheapest-first `£/month` comparison leveraging Çağlar's **always-on 8 GB RAM Mac mini** (native `launchd` only — zero Docker Desktop to avoid swap pressure) and **Google AI Ultra** subscription (Colab GPU units + monthly Google Cloud/API credits funding a GCP Linux VM + Gemini 3.8 Live API). Recommended Default Stack comes in at **~£6.50–£11.50/month extra** (well below the £30/mo target), alongside a zero-home-hardware Cloud Upgrade Stack (~£46–£64/mo).

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

- **Lint & Format (`pnpm check`):** PASS (0 errors across 257 files).
- **TypeScript (`pnpm exec tsc --noEmit`):** PASS (0 errors).
- **Security & Regression Suite (`pnpm test:security`):** **120 / 120 PASS** (103 existing baseline assertions + 17 new tests covering AES-256-GCM AAD vault integrity, normalized uppercase secret names, untrusted fence breakouts, EN/TR injection detection, outbound draft approval & `webSearch` exclusion, Profile+Journal isolation, routine validation, background task state transitions, skills triggers, and results extraction).
- **Playwright Mobile & Desktop UI Suite (`pnpm test:readiness-ui`):** **5 / 5 PASS** (`390×844` phone and `1440×1000` desktop viewports: 16px composer text, ≥44px touch targets, no horizontal overflow, local inbox filtering, History reload, and `/usage` route slot).
- **Production Dependency Audit (`pnpm audit --prod`):** **0 vulnerabilities found**.
- **Production Build (`POSTGRES_URL="" pnpm build`):** **PASS** (all 44 static/dynamic App Router routes compiled cleanly with zero live inference or DB writes).

---

## 3. Open Decisions, Credentials & Risks

### Decisions / Setup Deferred to Owner (Not Blocking Local Code)
1. **Isolated Database Schema Provisioning:** Following `lib/db/usage-schema.sql` convention, `lib/db/parity-schema.sql` (`MemoryProfileFact`, `MemoryJournalEntry`, `VaultSecret`, `BackgroundTask`, `SkillEntry`) is **additive and NOT auto-applied during `pnpm build`** because Preview and Production may share Neon settings. Apply it only to an approved isolated database. Until applied, `/memory`, `/routines`, and `/skills` degrade gracefully with clear setup banners.
2. **Explicit Feature Opt-In Flags (Default `false`):**
   - `SECRET_VAULT_KEY`: Generate via `openssl rand -base64 32` locally before saving encrypted vault secrets.
   - `MEMORY_TOOLS_ENABLED=true`: Opt-in to expose `saveProfileFact`, `addJournalEntry`, and `recallMemories` in chat turns.
   - `ROUTINES_ENABLED=true`: Opt-in to expose approval-gated `scheduleTask` in chat turns.
3. **Unattended Cloud Cron & Live Outbound Send:** Intentionally kept in **dry-run / paused mode** until the Phase 1 Mac mini worker daemon and scoped OAuth connectors are reviewed by the owner.

### Key Risks & Mitigations
- **Prompt injection via future email/webhook/PDF connectors:** Mitigated in advance by `fenceUntrustedContent`, `STATE_CHANGING_TOOLS` mutual exclusion on `webSearch` turns, tamper-proof `applyApprovalResponses`, and mandatory `OutboundDraftCard` human approval.
- **Surprise API bills:** All chat calls remain gated by `OPENAI_API_USAGE_ENABLED` / `AI_GATEWAY_USAGE_ENABLED` and the transactional `$10/mo` `ModelUsage` reservation cap; `BUDGET.md` routes voice/heavy compute onto already-paid Google AI Ultra credits + the Mac mini.
- **Mobile viewport regressions:** All new controls use `min-h-11` (≥44px) touch targets and `text-[16px]` inputs (preventing iOS Safari auto-zoom) inside the existing `RouteSlot` layout.

---

## 4. What's Next (Phase 1 Execution Order)

1. **Provision isolated local/preview Postgres** and apply `lib/db/usage-schema.sql` + `lib/db/parity-schema.sql`.
2. **Mac mini Companion Worker (`packages/box-daemon`):** Outbound `launchd` worker over Tailscale polling `BackgroundTask` and `CronJob` (`FOR UPDATE SKIP LOCKED`) + local Playwright runner with `ApprovalCard` gates.
3. **Finance Attachments & Vision:** Private authenticated file proxy + deterministic `pdf-parse` / `papaparse` CSV/PDF table extraction into OpenUI + `vision: true` on `gpt-6-luna` / `gpt-6.1-terra`.
4. **Voice Memos + Gemini 3.8 Live Sheet:** Push-to-talk memo transcription in `MultimodalInput` + ephemeral-token Gemini Live voice session funded by Google AI Ultra credits.

---

## 5. Exact Commands to Run & Preview Locally

```bash
cd /Users/caglar/.t3/worktrees/general-purpose-agent-quickstart/feat-grokbot-parity-e6766ad591e9f9aa

# 1. Run lint, typecheck, and all 120 security/unit tests
pnpm check && pnpm exec tsc --noEmit && pnpm test:security

# 2. (Optional) Apply additive parity tables to an ISOLATED local/dev Postgres ONLY
# psql "$LOCAL_DEV_POSTGRES_URL" -f lib/db/parity-schema.sql

# 3. (Optional) Generate a local-only vault master key in .env.local (never commit!)
# echo "SECRET_VAULT_KEY=$(openssl rand -base64 32)" >> .env.local

# 4. Run credential-free production build check
POSTGRES_URL="" pnpm build

# 5. Start local dev server and preview new surfaces
pnpm dev
# Visit:
# - http://localhost:3000/          (Chat + Results drawer in '...' menu + @skill:<slug>)
# - http://localhost:3000/routines  (Routines presets, Background Tasks, Secret Vault)
# - http://localhost:3000/memory    (Profile facts + Journal timeline)
# - http://localhost:3000/skills    (Built-in & custom Skills Library)
```
