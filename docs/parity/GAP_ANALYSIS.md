# Assistant Feature Parity — Gap Analysis

**Target branch:** `feat/grokbot-parity` (worktree branched from `feature/openai-premium-model-routing` @ `01875e6`)  
**Owner context:** Çağlar (Finance Controller & Vibecoder, `Europe/London`, bilingual EN/TR, single-owner locked assistant)  
**Benchmark:** Reference always-on desktop/mobile personal assistant (persistent "box", connectors, routines, memory, and explicit safety cards)

---

## Executive Context: Tutorial Baseline vs. Security-Hardened Fork

Although `README.md` and `1_TUTORIAL_STRUCTURE.md`–`11_Conclusion.md` describe an open multi-user tutorial stack (Composio + Supermemory + Telegram + Vercel Cron), **this branch intentionally diverged** during the Owner-Only Security Hardening, AI SDK 7, OpenAI Premium Routing (`gpt-6-luna` / `gpt-6.1-terra`), and mobile-first personal assistant UI restyle milestones (`docs/security-hardening.md`, `docs/CURRENT_STATE.md`, `docs/MODEL_ROUTING.md`, `docs/ui/DESIGN.md`):

- **Already ahead of basic chatbots:** Owner-only Google OIDC (`APP_OWNER_EMAIL`), PostgreSQL advisory chat locks (`lib/db/chat-lock.ts`), transactional `$10/mo` spend reservations (`lib/ai/routing/ledger.ts`), grounded `@openuidev` visual cards (`lib/openui/*`), live football fixtures (`lib/ai/tools/get-fixtures.ts`), AI Gateway DeepSeek web search (`lib/ai/tools/web-search.ts`), 10 WCAG AA mascot themes (`lib/bot-theme.ts`), and tamper-proof tool approval state verification (`lib/ai/conversation-state.ts`).
- **Deliberately disconnected pending safe re-architecture:** `@composio/*` and `@supermemory/tools` were removed from `package.json`; `/api/cron/tick` and `/api/telegram-webhook` return `503`; `scheduleTask` returns a disabled error.

---

## Capability-by-Capability Parity Matrix

**Legend:**
- **Effort:** `S` (≤ 0.5–1 day, local code/schema only) · `M` (2–4 days, cross-cutting UI + API + worker/integration) · `L` (1–2+ weeks, external daemon/sandbox/OAuth/realtime infra)
- **Value (for Çağlar):** `5` = daily core leverage · `4` = high personal productivity/safety · `3` = useful workflow multiplier · `2` = nice-to-have · `1` = low priority for single-owner use
- **Priority:** `P0` (implement now in Phase 0) · `P1` (next milestone, Mac mini / Ultra credits) · `P2` (medium-term expansion) · `P3` (defer / optional)

### 1. Chat, Rich Cards & Interactive Widgets

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 1.1 | **Streaming & Interruption Recovery** | AI SDK v7 `streamText` + `createUIMessageStream` (`app/(chat)/api/chat/route.ts:319-519`); Postgres advisory lock (`lib/db/chat-lock.ts:4-43`); interrupted partial replies saved with `data-reply-status` and canonical single-turn retry (`lib/ai/conversation-state.ts:18-29, 90-117`). `GET /api/chat/[id]/stream` is stubbed to `204` (`app/(chat)/api/chat/[id]/stream/route.ts:1-3`). | Stream resumption across mid-generation tab refreshes is a no-op (`204`); otherwise streaming & retry recovery are production-grade. | S | 4 | P2 |
| 1.2 | **Threads & History** | Single-shell SPA via `ActiveChatProvider` (`hooks/use-active-chat.tsx:64-327`) + `RouteSlot` (`components/chat/route-slot.tsx:16-29`), paginated sidebar history (`components/chat/sidebar-history.tsx:137-340`), edit-and-truncate (`app/(chat)/actions.ts:38-66`), slash commands (`components/chat/slash-commands.tsx:23-66`). `MessageBranch` UI exists unused (`components/ai-elements/message.tsx:154-328`). | Flat chat list only: no sub-threads/side-threads inside a conversation, no full-text search across chat history, and draft `localStorage` key (`input`) is shared globally rather than per-chat. | S | 3 | P1 |
| 1.3 | **Voice Memos & Audio Replies** | Zero microphone, `MediaRecorder`, STT, or TTS code in `app/`, `components/`, or `lib/`. | Missing push-to-record voice memo button in composer, server transcription (Gemini/Whisper), audio attachment playback pill, and spoken summaries. | M | 4 | P1 |
| 1.4 | **Attachments (Images, PDFs, Sheets)** | `POST /api/files/upload` uploads JPEG/PNG ≤5 MB to Vercel Blob (`app/(chat)/api/files/upload/route.ts:7-66`); `MultimodalInput` has upload + paste (`components/chat/multimodal-input.tsx:287-397`). However, `getCapabilities()` hardcodes `vision: false` (`lib/ai/models.ts:55`), disabling `AttachmentsButton` (`multimodal-input.tsx:632-645`), and Blob uploads use `access: "public"`. | Image attach is locked off by `vision: false`; PDFs, CSVs, XLSX, and DOCX attachments (critical for finance controller workflows) are unsupported, and Blob URLs need private/signed proxy handling. | M | 5 | P1 |
| 1.5 | **Rich Domain Cards (Weather, Sports, Search, Products, Flights, Shipments)** | Weather (`components/chat/weather.tsx`), Football Fixtures (`components/chat/fixture-card.tsx`, `lib/ai/tools/get-fixtures.ts`), Web Search sources (`components/chat/web-search-card.tsx`), Fictional Inbox (`components/chat/fictional-inbox-card.tsx`), and grounded `@openuidev` Chart/Table/Stat/Slider/Tabs/Map cards (`lib/openui/*`, `components/chat/openui-card.tsx`). | Strong OpenUI foundation, but missing structured **Product comparison**, **Flight status/itinerary**, and **Parcel/shipment tracking** card schemas & extractors, plus a unified "Results in this chat" drawer. | M | 3 | P2 |
| 1.6 | **Widgets / Clarifying Question Cards** | Empty-state `SuggestedActions` chips (`components/chat/suggested-actions.tsx:19-77`) only. | Missing interactive inline **Question Widget Card** (`askUserQuestion` tool rendering tappable single/multi-select options + custom answer pill inside the stream). | S | 4 | P0 |

### 2. Long-Term Memory, Skills Library & Routines

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 2.1 | **Long-Term Memory (Profile + Journal + Cross-Bot Shared)** | `User.soul` (`lib/db/schema.ts:29`, `/admin/agent`) stores agent persona; `User.homeLocation` (`schema.ts:30`) stores home city/TZ; `budgetModelMessages` (`lib/ai/context/budget.ts:64-173`) compacts older in-chat turns. `@supermemory/tools` is uninstalled; `lib/ai/prompts.ts:41-43` forbids claiming durable memory exists. | Missing durable **Profile** (structured keyed user facts/preferences with `sharedAcrossBots` flag) + **Journal** (timestamped episodic log of decisions, tasks, daily notes) + Memory Inspector UI (`/memory`) + opt-in recall/save tools. | S | 5 | P0 |
| 2.2 | **Skills Library** | Static regex-based `selectActiveTools` (`lib/ai/context/select-tools.ts:145-262`) only. | No user-editable **Skills Library** (reusable prompt playbooks / finance SOPs / domain instructions triggerable via `/skill` or intent match, with CRUD UI). | S | 4 | P1 |
| 2.3 | **Routines — Scheduled (Cron)** | `CronJob` table (`lib/db/schema.ts:129-145`), queries (`lib/db/queries.ts:658-761`), `cron-parser` utils (`lib/cron/cron-utils.ts`), `listMySchedules`/`cancelSchedule` tools, and minimal `/admin/schedules` delete-only page (`app/admin/schedules/page.tsx`). `scheduleTask` is disabled (`lib/ai/tools/schedule-task.ts:29-31`), `/api/cron/tick` returns `503` (`app/api/cron/tick/route.ts:15-21`), no `vercel.json` cron, no sidebar link. | Missing dedicated **Routines UI** (`/routines` reachable from user menu) with Create form + presets, Enable/Pause toggle, Run-Now preview/enqueue, approval-gated `scheduleTask` tool, and local Mac mini / opt-in tick runner. | S | 5 | P0 |
| 2.4 | **Routines — Event Triggers (Slack, GitHub, Email, Webhook)** | Zero inbound event trigger routes or trigger-matching rules. | Missing HMAC-verified webhook ingress (`/api/webhooks/[source]`), event-to-routine matcher (e.g., GitHub PR failed, VIP email, Stripe/finance alert), and untrusted-payload quarantine before agent run. | M | 4 | P2 |

### 3. Background Subagents & Cloud Coding Agents

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 3.1 | **Background Subagents (Executor, Browser, Knowledge Worker)** | All LLM execution is synchronous inside `POST /api/chat` (`maxDuration = 60`, `AbortSignal.timeout(50_000)`, `stopWhen: isStepCount(1..3)` in `app/(chat)/api/chat/route.ts:81, 394-411`). Nested artifact streams share the HTTP request. | Missing durable **Background Task Runner** (`queued → running → awaiting_approval → succeeded/failed`), multi-step worker loop (>60s), live task drawer/cards, and specialized subagent profiles (Researcher, Browser Use, Finance Analyst). | M | 5 | P0 (Core Queue + UI) / P1 (Worker Daemon) |
| 3.2 | **Cloud / Worktree Coding Agents** | Code artifacts (`artifacts/code/server.ts`) generate standalone snippets only. | Missing autonomous repo-cloning / git-worktree coding agent that edits files, runs `pnpm test`, and opens draft PRs (best delegated to Mac mini daemon or GitHub Actions/Copilot). | L | 3 | P3 |

### 4. Persistent Computer ("Box") & Local Machine Access

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 4.1 | **Persistent Linux/macOS "Box" (Shell, Browser, Desktop)** | Client-side Pyodide v0.23.4 Python runner in browser (`artifacts/code/client.tsx:119-215`) with no filesystem persistence or network. | Missing server/companion persistent execution environment with bash/zsh, persistent workspace files, headless/headed Playwright browser, and screenshot streaming. | L | 5 | P1 |
| 4.2 | **Access to User's Own Computers (Per-Action Approval)** | Not implemented. | Missing lightweight **Mac mini Companion Daemon** connecting outbound (WebSocket/Tailscale) to execute approved local shell/file/Playwright commands with mandatory per-command `ApprovalCard` verification. | M | 5 | P1 |

### 5. Connectors (MCP), Plugin Discovery & OAuth

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 5.1 | **Connectors (Gmail, Drive, Calendar, GitHub, Vercel, X)** | `lib/composio/server.ts:4-6` returns `null`; `app/admin/page.tsx:10-13` shows static disconnected notice; `demoInbox` (`lib/ai/tools/demo-inbox.ts`) is synthetic only. | No live external app connectors. Need direct least-privilege MCP / REST connectors (starting with read-only Calendar, Gmail read+draft, GitHub, Drive) backed by the encrypted Secret Vault. | M | 5 | P1 |
| 5.2 | **MCP Client & Plugin Search/Install** | Zero `@modelcontextprotocol/sdk` or MCP transport code. | Missing MCP server registry, stdio/SSE/Streamable-HTTP client adapter (on Mac mini / server), and `/connectors` catalog UI to toggle toolpacks on/off per turn. | M | 4 | P1 |
| 5.3 | **Connector OAuth Flows** | Google OAuth in `lib/google-owner.ts:3` requests `openid email profile` for owner login only (no refresh tokens stored). | Missing incremental OAuth consent flow storing encrypted refresh tokens in Secret Vault (separate from login session cookies) with per-connector revoke buttons. | M | 4 | P1 |

### 6. Safety, Approvals, Secrets & Untrusted-Content Fencing

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 6.1 | **Auto-Review of Risky Actions** | Static `STATE_CHANGING_TOOLS` exclusion on web-search turns (`lib/ai/context/select-tools.ts:60-69, 252-259`) and `$10` spend ledger (`lib/ai/routing/ledger.ts`). | Missing structured **Action Risk Classifier** (`low | medium | high | critical`) that evaluates tool name, destination/recipient, untrusted-context taint, and enforces approval or blocks execution. | S | 5 | P0 |
| 6.2 | **Approval Cards (`needsApproval`)** | Server `applyApprovalResponses` (`lib/ai/conversation-state.ts:32-72`) is tamper-proof, and `useActiveChat` (`hooks/use-active-chat.tsx:138-149`) auto-submits approvals, **but** UI Allow/Deny buttons only exist inside `tool-getWeather` (`components/chat/message.tsx:277-305`) and no tool sets `needsApproval: true`. | Generic `tool-*` renderer in `components/chat/message.tsx:395-432` lacks an interactive **Approval Card**! Any new approval-gated tool would get stuck in `approval-requested` with no buttons to click. | S | 5 | P0 |
| 6.3 | **Draft-Before-Send for Outbound Messages** | Prompt rule only (`lib/ai/prompts.ts:43`) + static preview in `FictionalInboxCard` (`components/chat/fictional-inbox-card.tsx:181-206`). | Missing real `draftOutboundMessage` tool (`needsApproval: true`) + **Outbound Draft Review Card** displaying channel, recipient, subject, exact body hash, risk summary, and Approve/Cancel buttons. | S | 5 | P0 |
| 6.4 | **Secret Vault** | All secrets live solely in `process.env` (`.env.local` / Vercel env). | Missing server-side **AES-256-GCM Secret Vault** (`lib/vault/`) for storing connector tokens/API keys per owner with masked hints (`••••4f9a`), rotation, and zero plaintext exposure to client or LLM context. | S | 5 | P0 |
| 6.5 | **Untrusted-Content Fencing** | `dropWebSearchHistory` (`app/(chat)/api/chat/route.ts:114-123`), `webSearchPrompt` (`lib/ai/prompts.ts:60`), URL/badge sanitizers (`lib/web-search-sources.ts`, `lib/fixtures.ts`), and OpenUI validator (`lib/openui/validate.ts`). | Strong for web search, but missing a reusable **Untrusted Content Envelope & Injection Scanner** (`lib/safety/untrusted-content.ts`) for emails, webhooks, scraped pages, and MCP tool outputs. | S | 5 | P0 |

### 7. Multi-Bot Teammates & Messaging Channels

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 7.1 | **Teammates / Multi-Bot Roster** | 10 animated mascot color themes (`lib/mascot.ts`, `lib/bot-theme.ts`) + single `User.soul` (`lib/db/schema.ts:29`). | Single assistant persona only; missing named **Bot Teammates** (e.g., *MENA Finance Controller*, *Vibecode Architect*, *Daily Chief of Staff*) with distinct souls, default models, mascots, and toolsets. | M | 4 | P2 |
| 7.2 | **Group Rooms & Agent-to-Agent Messaging** | Single owner ↔ single assistant chat (`Chat` + `Message_v2`). | Missing multi-agent group rooms (`@mention` another specialist bot in the same thread or delegate sub-tasks between bots). Low urgency for a single-user personal assistant compared to subagents. | L | 2 | P3 |
| 7.3 | **Channels: Telegram, Slack, iMessage** | Telegram DB schema (`TelegramTurn`, `User.telegramChatId`), `lib/telegram.ts`, and `/admin/telegram` UI exist, **but** `/api/telegram-webhook` returns `503` (`app/api/telegram-webhook/route.ts:1-7`). Slack & iMessage are absent. | Re-enable **Telegram** safely (owner-only `telegramChatId` match + rate/spend ledger + inline-button approvals); optional **iMessage** via Mac mini local `imsg`/SQLite + AppleScript bridge; **Slack** Bolt webhook. | M | 4 | P2 |

### 8. Pages/Canvases, Media Generation, Calls & Meetings

| # | Capability | Current State in Repo (File Refs) | Gap vs. Reference Assistant | Effort | Value (1–5) | Priority |
|---|---|---|---|---|---|---|
| 8.1 | **Pages / Shareable Dashboards & Results Sheet** | Side-by-side `Artifact` canvas (`text`, `code`, `sheet` in `components/chat/artifact.tsx`) + inline `OpenUiCard` (`components/chat/openui-card.tsx`). Public chat sharing is blocked by `proxy.ts:36-49` and `app/(chat)/api/messages/route.ts:28-30`. | Missing current-chat **Results Drawer** (revisiting cards/artifacts without scrolling) and signed, read-only **Shareable Page Snapshots** (`/share/[token]`) for publishing static executive/finance dashboards safely. | M | 4 | P1 (Results Drawer) / P2 (Signed Share) |
| 8.2 | **Image & Video Generation** | Orphan base64 viewer in `artifacts/image/client.tsx` with no server handler or tool. | Missing `generateImage` / `generateVideo` tools wired to Gemini Imagen / Veo (covered by Google AI Ultra credits) stored in private Blob/artifacts. | M | 3 | P2 |
| 8.3 | **Phone Calls / Realtime Live Voice** | Not implemented. | Missing WebRTC / WebSocket **Gemini Live (`gemini-3.8-live`)** voice call sheet inside the chat shell using short-lived server-minted ephemeral tokens and writing transcripts back to `Chat`. | M | 4 | P1 |
| 8.4 | **Meetings (Prep, Live Notes, Action Items)** | Not implemented. | Missing pre-meeting briefing routine (Calendar + Memory lookup) and Mac mini local system-audio capture / transcript → Journal + Draft follow-ups pipeline. | L | 4 | P2 |

---

## Top Priority Summary (Value ÷ Effort) & Phase 0/1 Post-Implementation Snapshot

*(Synthesized across 8 dedicated read-only capability-area audits; items marked **DONE on branch** were implemented in Phase 0 + Phase 1 quick-win commits on this worktree.)*

1. **P0 Quick Wins — Implemented on Branch (`Effort S`, `Value 4–5`):**
   - **6.1 + 6.2 + 6.3 (`DONE on branch`):** Universal `ApprovalCard` (`components/chat/approval-card.tsx:46-163`) wired into `components/chat/message.tsx`, deterministic 4-tier `reviewActionRisk` + SHA-256 digest (`lib/safety/action-review.ts:59-144`), and `draftOutboundMessage` (`lib/ai/tools/draft-outbound.ts:22-75`) with `OutboundDraftCard` (`components/chat/outbound-draft-card.tsx:44-187`) in explicit dry-run mode until live connectors are enabled.
   - **6.5 (`DONE on branch`):** Reusable `fenceUntrustedContent` + EN/TR prompt-injection scanner & Unicode Tag/bidi stripping (`lib/safety/untrusted-content.ts:8-111`) paired with strict `STATE_CHANGING_TOOLS` mutual exclusion on `webSearch` turns (`lib/ai/context/select-tools.ts:68-81, 332-346`).
   - **6.4 (`DONE on branch`):** Server-side AES-256-GCM `SecretVault` with HKDF (`assistant-parity-vault-v1`) and `userId:NAME` AAD binding (`lib/vault/secret-vault.ts:10-376`) + masked-only `/api/vault` (`app/api/vault/route.ts`).
   - **2.1 (`DONE on branch`):** Long-term Memory split into **Profile** (`MemoryProfileFact` with `sharedAcrossBots`) and **Journal** (`MemoryJournalEntry`) (`lib/memory/store.ts`, `lib/db/parity-schema.sql`) + `/memory` UI (`app/(chat)/memory/page.tsx`) + opt-in tools (`lib/ai/tools/memory-tools.ts`).
   - **2.2 + 8.1a (`DONE on branch — Phase 1 Quick Wins`):** Skills Library (`lib/skills/library.ts`, `app/(chat)/skills/page.tsx`) with `@skill:<slug>` explicit invocation, plus current-chat **Results Sheet** (`components/chat/results-sheet.tsx:16-91`, `lib/results-extractor.ts:21-115`).
   - **2.3 + 3.1a (`DONE on branch`):** Dedicated **Routines & Background Tasks Hub** (`app/(chat)/routines/page.tsx`, `lib/cron/routine-presets.ts`, `lib/tasks/runner.ts`, `app/api/schedules/[id]/route.ts`, `app/api/tasks/route.ts`) + approval-gated `scheduleTask` (`ROUTINES_ENABLED=true`), while preserving `/api/cron/tick` `401`/`503` lock.
   - **1.6 (`DONE on branch`):** Interactive `QuestionCard` widget (`components/chat/question-card.tsx`, `lib/ai/tools/ask-question.ts`).
2. **P1 Next Wave (8 GB Mac Mini Native Worker + Google AI Ultra Offload — `Effort M`, `Value 4–5`):**
   - Lightweight native `launchd` companion worker (~40 MB RSS, no Docker on the 8 GB RAM Mac mini) paired with an Ultra-funded GCP Linux VM (`e2-medium`/`e2-standard-2`) for Docker/multi-tab browser sandboxes; private authenticated PDF/CSV/XLSX finance attachments + Vision unlock; Gemini 3.8 Live voice + voice memos; and vault-backed Google/GitHub read+draft MCP connectors.
