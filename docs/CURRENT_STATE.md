# Current state — SDK 7 migration, 8 November 2026

## Active work and boundaries

The owner explicitly authorized completing SDK 7 on the existing
`feature/ai-sdk7-migration` branch. [Draft PR #9](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/9)
is stacked on [draft PR #8](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/8),
`feature/conversation-engine-v1` at `970b612`. Neither is merged into main or a
testing branch. Production settings/deployments are untouched. No paid model,
Gateway billing, Gmail scope/send, recurring execution or unrestricted tool is
activated. Owner-only Auth.js and existing Neon history/schema remain.

The product remains the private cloud-hosted English/Turkish assistant. Read the
shared [project instructions](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/AGENTS.md),
[vision](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/PRODUCT_VISION.md),
[roadmap](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/ROADMAP.md),
[OpenUI/conversation ADR](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/blob/docs/holistic-ui-model-architecture/docs/architecture/ADR-0001-unified-conversation-openui.md)
and its experience benchmark before future product changes. Those documents live
on a separate documentation draft; this task inspected them rather than merging
unrelated feature branches. The owner's current SDK 7 instruction supersedes
older statements proposing to stay on SDK 6.

## Implemented in this branch

See [AI_SDK_7_MIGRATION.md](AI_SDK_7_MIGRATION.md) for exact APIs, reasoning,
tests, inherited defects and limits. SDK 7.0.165, React adapter 4.0.169, OpenAI
adapter 4.0.111 and provider 4.0.37 are installed from the locked graph on Node
24.22.1/pnpm 10.32.1. Node is pinned to 24.x. Only the SDK's matching OTel adapter
was added; Next/React/Auth.js and the database schema were not upgraded.

- Migrated chat/artifact calls and stateless UI adapters; explicitly propagate
  composed-stream outcome and persist the single response via onEnd.
- Preserved useChat's installed onFinish contract, transport/regeneration,
  direct Groq Chat Completions and full persisted tool/UI parts.
- Corrected retry races and partial-reply recovery using a direct PostgreSQL
  advisory lock and additive JSON reply status. No new table/migration. Retried
  text replaces the same assistant ID; completed/tool-effect turns cannot be
  blindly replayed. Existing user input is canonical. Edits check the lock too.
- Fixed approval-part over-trust, previous-tool carry-over on explicit topic
  changes, underestimated schema costs and impossible artifact prompt budgets.
- Bounded nested artifact calls, cancellation and validated suggestion elements;
  prevent empty/failed artifact saves, sanitize UI errors and restrict trace capture.
- Added a credential-isolated local PostgreSQL/SDK/mobile integration harness
  and CI coverage. No production authentication/testing bypass exists.

## Actual verification

- Locked install, TypeScript and Biome: PASS.
- Security/SDK regressions: **34/34 PASS**.
- Credential-free production build: PASS, no model probe without a key.
- Existing Playwright phone-size suite: **3/3 PASS**, synthetic UI fixtures.
- New integrated phone-size suite: **3/3 PASS**, real Next handlers and disposable
  PostgreSQL 17, synthetic Groq/Open-Meteo responses through the actual SDK 7 V4
  adapter. Both model selections, Turkish→English follow-up, tool cards, inbox
  slider (zero model calls), actual History navigation/reload, saved artifacts,
  rate-failure Retry, partial-stream Retry, replay denial, simultaneous requests
  and advisory-lock release. Not real Groq or iPhone Safari acceptance.
- Dependency audit: production zero findings; full graph one existing low
  development-only deepmerge/Ultracite advisory, GHSA-gcqx-w48m-w2h4, no reported
  patch. No moderate/high/critical findings. Inherited next-themes/React and
  OTel-log peer warnings remain; no unrelated upgrade was made to hide them.
- `git diff --check`: PASS. CI and the preview run automatically on push; check
  [PR #9 checks](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/9/checks)
  for the exact current commit/result. Do not infer CI or cloud inference from
  local success. Runtime preview evidence belongs in the PR review handoff.

## Protected-preview acceptance — blocked on setup/session

Runtime commit **8c70ca6** passed [GitHub run 42523660161](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/actions/runs/42523660161), including all 34 regressions and both browser suites. Protected Preview **dpl_BBzCbpNUFCvGhNPyKQvkzikGeFCm** is READY:
[stable SDK 7 preview](https://general-purpose-agent-quickstart-git-feat-53ce7e-csahingoz-3779.vercel.app). Build logs confirm Node 24.x from package engines overrides the existing project default 26.x; project settings were not changed. Existing migrations completed, with no new schema migration. Deployment Protection remains enabled (`all_except_custom_domains`). Fresh protected fetches: login 200, providers `{}`, guest 403. Build model readiness is `not_configured`, zero verified candidates, as expected without the branch key. This verifies fail-closed deployment, not live inference.


Metadata inspection showed **no** branch-specific owner, Google or Groq settings
for `feature/ai-sdk7-migration`. The existing four settings remain scoped only to
`security/owner-only-hardening`. Their values were not decrypted, moved or logged.
Existing shared database/Auth.js secrets are retained. The earlier incomplete
SDK 7 head `5e43e72` had an ERROR deployment; that is not a migration result.

The owner was asked to save private copies of APP_OWNER_EMAIL, AUTH_GOOGLE_ID,
AUTH_GOOGLE_SECRET and GROQ_API_KEY for Preview on this branch. After saving,
rebuild and check bounded live model verification, then validate an actual owner
session. The stable SDK preview callback may need adding to the existing Google
OAuth client's authorized redirects:
`https://general-purpose-agent-quickstart-git-feat-53ce7e-csahingoz-3779.vercel.app/api/auth/callback/google`. Do not expose values or broaden all preview
branches as a shortcut. The session currently has no connected owner browser or
app login; deployment-tool access alone is not an Auth.js owner session.

Live acceptance still required: both real Groq models, EN/TR conversation,
weather, fictional inbox, History persistence and Retry, plus real Safari/touch
interaction. Keep PR #9 draft and **do not recommend merge into testing yet**
until these checks and review pass. A credential-free READY preview proves
build/deployment only.

## Remaining limits and next action

- Existing inbox fixture data persists, but slider state resets on reload; durable
  interactive selection remains later scope. No OpenUI renderer was added.
- Token budget is conservative estimation, not an exact tokenizer/TPM scheduler.
  Real quotas can still fail; no automatic paid/provider fallback exists.
- Session advisory locks require the existing direct/unpooled database URL and
  hold a connection during generation (bounded by the request deadline). Missing
  direct configuration fails closed. Database disconnect releases the lock.
- Interrupted tool work remains visible and requires a follow-up; there is no
  automatic replay/reconciliation of document/profile/schedule side effects.
- OpenUI's renderer peers allow the current React/Zod versions and the SDK's UI
  stream boundary remains intact; actual renderer integration still needs tests.
  SDK 7 realtime APIs are experimental; no voice service or audio spend enabled.

Next owner step is private SDK-preview settings, then Google callback/session
setup if needed. Continue cloud acceptance afterward; no merge/production action
is implied. The owner is not a developer: always end each response with one clear
next action, never ask for credentials in chat, and say no action is needed while
work can continue independently. Update this file after the next milestone.
