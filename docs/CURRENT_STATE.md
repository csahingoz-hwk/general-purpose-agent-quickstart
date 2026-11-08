# Current Project State — verified 8 November 2026

Read AGENTS.md, PRODUCT_VISION.md, ROADMAP.md and this file at each task start.
This is the current handoff, not a list of implemented product aspirations.
Earlier investigation/setup evidence is retained below and in Git history.
Never copy identity values, keys, connection strings or private chat/mail into it.

## Current decision

**Phase 0 remains open for owner acceptance.** Google sign-in works according to
the owner and their iPhone chat screenshot. The first reply previously triggered
Gateway payment activation. The owner rejected this and authorized a free-first
Groq setup. That correction is now implemented in draft PR #1, with both exact
Groq candidates returning live synthetic greetings during its Vercel build.

Next: owner sends a bilingual greeting, refreshes the conversation and confirms
both turns persist; then validates the optional second model and remaining
security checks. Do not begin rich UI/voice/Gmail/schedules, merge either PR,
promote production, activate billing or connect Gmail as an automatic next step.

## Branches and review

- [PR #1](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/1):
  `security/owner-only-hardening` → `main`, draft/unmerged. Runtime head
  `22392142cff422b1cc8dca8600c0cb3753bc19cc` includes direct Groq/readiness.
- [PR #2](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/2):
  `docs/product-direction` → security branch, draft/unmerged. Supplied AGENTS,
  vision, roadmap and current state incorporated and extended without replacing
  the security implementation. Security branch synchronized into the docs branch
  so its review diff remains documentation-only. This is not a merge into main.
- [Security results](security-results.md), [hardening](security-hardening.md),
  [Google setup](google-sign-in-setup.md), [model policy](MODEL_ACCESS.md),
  [runtime readiness](free-chat-readiness.md), [next proposal](NEXT_IMPLEMENTATION.md).

## Cloud and credentials

- Existing Vercel project `general-purpose-agent-quickstart`, Neon PostgreSQL,
  AUTH_SECRET and CRON_SECRET retained. No schema/dependency change in the new
  readiness slice. Vercel's existing migration step completed in the new build.
- New security preview `dpl_7Yhv628KZp8DdTygmQFxbaXGmEza`, commit `2239214`.
  Build verification: `Chat readiness: ready; verified candidates: 2; check: ok`.
  Deployment is **READY**, with the stable security alias assigned; this is a
  Preview deployment, not production.
- Stable [security preview](https://general-purpose-agent-quickstart-git-secu-1658d1-csahingoz-3779.vercel.app).
  [Immutable new preview](https://general-purpose-agent-quickstart-i9fkmkmxl-csahingoz-3779.vercel.app).
  The preceding working Google preview was `dpl_HqvCNiiDw9Mwc2kgNaJ93DUoB6q4`
  at `ed90b3a`; it was READY.
- Deployment Protection remains enabled (`all_except_custom_domains` at the prior
  inspection). Do not mistake preview protection for proof that an older
  production/custom-domain release is secure. No production release was made.
- Owner/Google settings are server-side and branch-scoped. Google invalid_client
  was fixed by correcting the active public client ID without a URL scheme,
  preserving the secret. The owner reports successful sign-in; screenshots show
  identity-only consent and the chat. Google login grants no Gmail access.
- The owner saved `GROQ_API_KEY` privately in Vercel. Its metadata initially showed
  Production-only; scope was corrected to Preview on the security branch,
  preserving the value without reading/decrypting it. No other secret changed.
- Groq account screenshot showed zero usage and an Upgrade to Dev Plan option;
  the owner reports enabling Inference APIs ZDR. No billing/retention API proof,
  payment method or upgrade was added. Global ZDR/storage controls were untouched.
- An earlier OAuth secret appeared in a screenshot. Replacement was requested and
  the owner reported completion. Revocation is not independently verified; never
  copy or restore that secret.

## Implemented versus remaining

| Area | Implemented | Remaining |
| --- | --- | --- |
| Identity | Owner-only Google verified email, server-configured owner; identity-only scopes, PKCE/state/nonce, stable existing-schema account linking; no guest/signup/password login. | Longer session, stable account/history and a real non-owner callback need acceptance. Apple/app-native passkeys absent. |
| Chat | Existing AI SDK 6.0.116, Next 16.4.5, Auth.js beta.32 and Neon message storage retained. Direct Groq: Everyday chat (20B) preferred, Detailed chat (120B) optional. Same adapter passed bounded live inference; server rejects other IDs. | Real owner streaming, second-model reply, database reload persistence, quality/tool use and real Safari remain unverified. |
| Readiness/cost | Only successful build-verified candidates appear after current credential/catalogue checks; no Gateway activation, paid fallback or paid title call. Missing setup disables send; failed sends restore text. Zero retries, 2,048 output-token cap and three tool steps per generation. | Model-list success cannot establish remaining quota or billing tier; free-account limits may change. Quota failure must stop. Rebuild after key/verification changes. |
| Integrations | Broad Composio/Supermemory loaders and SDKs removed. Google sign-in stores no provider token. Narrow document/profile tools retained. | No Gmail OAuth/read/draft/send or external integration is connected. |
| Execution | Cron requires a configured matching secret and returns disabled; cron declaration, schedule creation and Telegram execution disabled. Owner list/delete remains. | No working cloud recurring execution or remote shell. |
| Memory/UI | Chat and per-user soul/profile editor remain; existing artifact rendering/message parts retained. | General long-term memory, safe rich UI contract, realtime voice, polished/offline PWA and isolated sandbox absent. Home Screen use is owner-reported. |

## Fresh validation for readiness change

- TypeScript and Biome (166 files): PASS.
- Eleven security/readiness cases: PASS, including five original owner/guest/cron/
  verified-Google tests and six no-key/auth/quota/empty-response/allowlist cases.
- Credential-free local production build: PASS; migration skips without local DB
  configuration. It exposes no model and makes no inference call without a key.
- Phone-sized Chromium: PASS for no-key disabled send, preserved draft, ready
  two-model fixture, friendly-name search/selection, phone width and failed-send
  input restoration with no payment dialog. Synthetic owner/model/BotID/error
  fixtures are local-only; this is not a real Google/Groq/Neon/Safari test.
- Production audit: zero findings. Full audit: one low development-only deepmerge
  advisory through Ultracite, GHSA-gcqx-w48m-w2h4, no patch reported; no moderate,
  high or critical findings. Review remains required.
- External loader/Gateway execution scan and diff check: PASS. No new package.
- Cloud build: existing migrations completed; both candidates returned nonempty
  synthetic bilingual greetings through the actual SDK adapter. At most two
  128-token probes, no retries/private conversation. No tool-use benchmark.
- [GitHub run 42496421765](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/actions/runs/42496421765)
  covers this runtime head, including the new phone-sized browser check: **success**,
  independently checked through GitHub metadata.

Earlier retained evidence: the preceding security workflow run 42479183230 passed;
local HTTP/OAuth smoke checks covered login, registration, owner access guards,
identity scopes/PKCE/state/nonce and disabled routes. Previous protected-preview
fetches confirmed login 200, enabled Google button, Google-only providers with
stable callback and guest 403. Expected app 401s were sometimes classified as
Deployment Protection failures by the fetch tool; those deployed checks remain
separate from local assertions.

## Outstanding Phase 0 acceptance

- [x] Owner reports Google sign-in works; iPhone screenshots show identity-only
  consent and assistant chat. No Gmail permission granted.
- [x] Saved private Groq key; both allowlisted candidates pass bounded cloud
  inference. No provider/payment activation in normal-chat code.
- [x] New security preview READY and GitHub CI successful. Fresh deployed checks:
  login 200, Google-only providers with the stable callback, guest 403.
- [ ] Real bilingual owner message streams a response with Everyday chat.
- [ ] Reload/reopen preserves both turns; stable account ID and old history remain.
- [ ] Detailed chat produces a reply and uses the selected model.
- [ ] Signed-out chat/history/models denial confirmed on deployment after
  accounting for Vercel Protection; real non-owner Google callback rejected.
- [ ] Deployed cron auth/disabled response distinguished from Vercel protection;
  local regression coverage already passes.
- [ ] Review advisory/overrides, owner linking, exposed-secret revocation history
  and preservation of existing data.
- [ ] Owner explicitly reviews/accepts Phase 0. Merge and production promotion
  each require separate approval; acceptance alone authorizes neither.

## Smallest next implementation and collaboration

Complete real-owner chat/reload acceptance first; no later feature coding yet.
After Phase 0 passes and Phase 1 is requested, propose one fictional inbox answer
with chart, threshold slider and cards; validate a versioned spec and persist
selection using existing messages. Deterministic data, no Gmail, no extra model
call per interaction. Compare Open Intelligent UI/json-render adapters against
AI SDK 6 before choosing a dependency. See NEXT_IMPLEMENTATION.md.

The owner is not a developer. Give one clear next action with a link, clicks and
expected result at the end of every response. Never request secrets in chat or
screenshots. If work can proceed independently, say no action is needed and
continue. Groq/CI/preview tests consume existing allowances; no guaranteed forever
free plan or measured voice budget is claimed. Update this handoff after milestones.
