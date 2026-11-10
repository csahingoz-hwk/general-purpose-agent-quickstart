# Current state — SDK 7 and premium routing, 8 November 2026

## Boundaries and product direction

Private cloud-hosted EN/TR assistant; Next 16 / React / AI SDK 7 / Auth.js owner-only
Google login / Neon / Vercel. No PR is merged. Main, production settings, existing
working testing URL and all credentials are untouched. No billing, real paid
inference, Gmail scopes/send, unattended actions, sandbox or voice service is
activated. No credentials were read, configured or logged.

Read the shared [AGENTS instructions](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/AGENTS.md),
[product vision](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/PRODUCT_VISION.md),
[roadmap](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/ROADMAP.md),
[conversation/UI ADR](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/architecture/ADR-0001-unified-conversation-openui.md)
and [experience benchmark](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/architecture/EXPERIENCE-BENCHMARK.md)
at the beginning of tasks. Those source documents remain on their separate draft
branch; do not overwrite them or merge unrelated work. The latest owner mission
supersedes their old SDK 6/free-Groq-only assumptions: implement SDK 7, then Luna
with selective Terra, while keeping all API spending disabled pending approval.

## Phase A — SDK 7 baseline, draft PR #9

[PR #9](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/9)
targets `feature/conversation-engine-v1` (draft PR #8). Installed locked graph:
Node 24.x (local 24.22.1), pnpm 10.32.1, ai 7.0.165, React adapter 4.0.169,
OpenAI adapter 4.0.111, provider 4.0.37 and matching OTel 1.0.165. No unrelated
framework/dependency upgrades. See [migration details](AI_SDK_7_MIGRATION.md).

The original head d9e4e61 failed **42524007091**. A delayed-finish-frame fixture
reproduced its exact English-follow-up assertion. Request tracing showed only
the Turkish POST: the follow-up never reached backend/model/storage. The composer
showed Send during `streaming` while its handler refused submission. Show Stop
through submitted **and streaming**; preserve drafts; enable Send only when ready.
The stronger regression drafts English during the delayed tail, tries Enter,
asserts no new turn/draft loss, checks the accepted POST/latest input/model/200,
then retains the exact English response and four persisted messages assertions.

Also fixed inherited delayed autofocus stealing the inbox slider's keyboard
focus. Commit fb580b5 passed every step in **42525603432**. Wider tests then found
a real long-History defect: the bottom-sheet `h-auto` variant overrode the intended
70dvh height, growing above the phone viewport. Backported bounded sheet/content
scrolling and a direct mobile History toggle to PR #9. Its regression seeds 30 old
chats, asserts the drawer's real bounds and clicks the saved conversation.
Measure slider-triggered calls after the existing tool/prose steps finish; a
visible tool card does not mean its follow-up generation has ended.

Latest baseline: `ea6fd35`; final CI run **42527245768 passed every check**.
The prior original migration protections remain: explicit composed-stream outcome,
canonical/single-turn retry, direct PostgreSQL chat lock, same-ID partial-text
replacement, no automatic tool-effect replay, constrained approvals, compact
model-facing tool results/full stored UI data, bounded artifacts and safe errors.

## Phase B — separate premium-routing branch

`feature/openai-premium-model-routing` is stacked on the verified SDK branch;
[draft PR #10](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/10)
targets `feature/ai-sdk7-migration`. Production is untouched.
See [implemented routing, official sources, prices, policy and setup](MODEL_ROUTING.md).

- Default `gpt-6-luna`, selective `gpt-6.1-terra`: official OpenAI Responses API
  using the installed SDK V4 adapter. Both identifiers/prices/capabilities verified
  against official docs; **the owner's account entitlements are unverified**.
- Fail closed without server-only key **and explicit API-spending enablement**.
  Luna must be in the configured catalog; no silent default substitution. Cache
  catalog readiness briefly to avoid network lookup on every turn. No paid probe
  runs at build time. Groq needs two explicit legacy flags and never falls back
  automatically. No Groq configuration is required for OpenAI.
- One pre-exposure fallback at most for HTTP 5xx or validated structured-output
  failure. No shared-rate/credit/auth/context/cancel/tool fallback; none after
  partial output or a tool boundary. Hard reasoning can use the explicit Detailed
  choice; no length/keyword classifier or routine extra paid call.
- Model-aware 32K/64K context budgets and 2K/4K output caps, largest fitting recent
  window, full Neon History retained, existing preferences in instructions.
  Structured JSON stays bounded/validated; no arbitrary generated JS/renderer.
- Per-invocation provider token usage, cache reads/writes, output/reasoning,
  estimated cost, fallback reason/frequency/cost and daily/monthly UTC totals.
  Unknown usage conservatively keeps reservations. Fixed outcome categories
  record why exposed/tool work did not fallback. No sensitive content is logged.
- Transactional cross-chat spending reservations, default $10 allowance; missing
  ledger fails closed. `/usage` in the user menu and owner-only `/api/usage`.
  `lib/db/usage-schema.sql` is additive and **not auto-applied by preview builds**:
  preview and production could share Neon. Only disposable PostgreSQL was changed.

## Verification and remaining acceptance

- Locked install, TypeScript, Biome and production audit: PASS. Production audit
  zero findings; full graph retains one inherited low dev-only deepmerge/Ultracite
  advisory GHSA-gcqx-w48m-w2h4, no patch reported, no moderate/high/critical finding.
- Security/SDK/premium policy regressions: **45/45 PASS**, including Responses
  adapter shape, token/cache accounting, schema validation before exposure,
  cancellation, actual multi-step tool no-replay and long inference context.
- Integrated browser suites run actual Next routes, SDK adapters and PostgreSQL
  with **synthetic provider/weather responses**, never actual API credits.
  Both model selections, EN/TR, English follow-up, weather, inbox/local slider,
  long History drawer, reload, artifacts, Retry, concurrency and chat-lock release.
  Premium tests also verify three recorded calls for nested artifact generation,
  transient fallback, billing exhaustion, retained messages, allowance stop before
  inference and atomic cross-request spending. See PR checks for final exact-head
  CI/mobile/build results; do not infer cloud acceptance from synthetic tests.
- Local existing mobile suite 3/3, legacy integrated mobile 3/3, OpenAI integrated
  mobile 3/3, spending tests 2/2, credential-free build and diff checks: PASS.
  Token-limited output is treated as interrupted, with reported usage retained,
  rather than silently accepting a truncated reply as complete.
- Initial premium preview provisioning failed before compilation (no build logs):
  Vercel reported `Resource provisioning failed`. A same-commit Preview-only retry
  failed identically (`dpl_H1cbyLQzAjDiJ79gEYXiipddf81n`), still before build.
  This is an unresolved Vercel provisioning blocker, not a compiler error or
  evidence of live acceptance. No production/environment/credential configuration
  changed, and no paid capacity was enabled.

Real OpenAI inference, account quota/credit availability, real owner Google OAuth,
Neon cloud acceptance, latency/bilingual quality and iPhone Safari remain pending.
The existing inbox dataset/card persists; slider selection still resets on reload.
Older excerpts are not semantic memory. No OpenUI/voice/Gmail feature was added.
Provider hard spending limits are recommended; the application counter alone is
not a guaranteed billing cap. Official provider enforcement can also lag slightly.

## Next owner action

Review the two draft PRs. Real-provider acceptance requires **explicit bounded API
spending approval**, then private branch-specific account/Google/database settings,
usage-ledger provisioning on an approved database and a real owner browser session.
Do not configure Groq for this task, paste keys in chat, broaden all Preview secrets,
change the established testing URL, merge, or promote production as a shortcut.
Guide the nondeveloper owner through one account step at a time after approval.
Update this file after acceptance; report synthetic and real results separately.

## Personal assistant UI — Session 1 (shell and visual foundation)

Presentation and navigation only; no backend, schema, provider, auth or
`use-active-chat` state/transport changes. Not committed or pushed by this work.

**IMPLEMENTED**
- One route slot (`components/chat/route-slot.tsx`) inside the single
  `ActiveChatProvider`: chat routes render `ChatShell`, `/usage` renders only its
  own page. The provider is not keyed by URL.
- Header: vendor logos, Deploy CTA and visibility selector removed. Shows
  Assistant, the conversation title when it is in the already-loaded History
  page (same SWR key as the sidebar, no new endpoint), a static Private pill
  (or "Shared link" when a chat really is public) and the home-city control.
  The header now also renders when the desktop sidebar is collapsed.
- Sidebar: Assistant brand, prominent New chat, "Delete all chats…" moved into
  the account menu (danger area, same confirmation and handler), "Usage &
  settings" menu item.
- Personal greeting and the four supported suggestions; `/usage` is a
  standalone scrollable surface with a 44px Back to chat link.
- Muted-text tokens tuned for AA contrast (light 5.75:1 on background, dark
  6.84:1); faint opacity text removed from touched files.
- Typed EN/TR copy module `lib/ui-copy.ts` (default `en`).
- Synthetic Chromium "personal shell" test at 390x844 and 1440x1000.

**MOCKED / SYNTHETIC**
- Browser evidence uses a synthetic owner cookie and intercepted
  models/history/messages/usage responses in desktop Chromium emulation.

**PENDING**
- No language switcher: Turkish strings exist but are not selectable yet.
- No real iPhone/Safari check; no protected Vercel preview; isolated database
  and the Vercel provisioning problem remain open.
- Sessions 2 (composer), 3 (rich results) and 4 (usage redesign, settings,
  language) are not started.
