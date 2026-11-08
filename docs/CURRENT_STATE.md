# Current Project State — verified 8 November 2026

This is the shared handoff for future tasks. It combines the supplied context
snapshot with inspection of code, GitHub and Vercel on this date. Aspirations in
[PRODUCT_VISION.md](PRODUCT_VISION.md) are not implemented features. Update this
file after each milestone and refresh live facts at the next task; never copy
owner identity values, secrets, mail contents or connection strings into it.

## Current decision

**Phase 0 is implemented on a feature branch, but acceptance is still pending.**
Do not begin later implementation phases, merge PR #1, promote production or
activate Gmail send as part of this documentation task. The next action is the
model-readiness correction and review of a genuine free-tier text backend. The
owner has rejected payment/provider activation as part of normal chat. The chat
is accessible after sign-in, but the first reply test is blocked by the current
AI Gateway verification requirement. Do not activate billing, purchase credits
or silently replace the provider. See [MODEL_ACCESS.md](MODEL_ACCESS.md).
The smallest subsequent implementation proposal is described in
[NEXT_IMPLEMENTATION.md](NEXT_IMPLEMENTATION.md).

## Repository, branches and review

- Repository: `csahingoz-hwk/general-purpose-agent-quickstart`; default `main`;
  upstream Composio quickstart with Vercel Chatbot foundation. Personal,
  noncommercial use only; no corporate data/inbox integrations.
- [Security PR #1](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/1):
  **open, draft, unmerged**, base `main`, head `security/owner-only-hardening`.
  Inspected head: `ed90b3a04b1be7a981f53692a5567895e835b8d7`.
- Security code is not on main. The long-term vision must not bypass or replace it.
- [Documentation PR #2](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/2):
  `docs/product-direction`, based on that security head, open in draft.
  It targets `security/owner-only-hardening` so the review shows documentation
  only. This is a stacked documentation change, not a merge of the security PR.
  Do not retarget/merge either PR automatically.
- The supplied documents were initially imported verbatim. AGENTS.md now includes
  the owner requirement for plain-language, step-by-step guidance and an explicit
  next action in every update. PRODUCT_VISION.md and ROADMAP.md include the owner
  requirement for free-first, verified model availability;
  this current-state file replaces the supplied initial snapshot with checked facts.
  Existing security documentation and application code are preserved. The security
  report gets an additive note pointing readers to this newer handoff.

## Verified deployment and configuration

- Existing Vercel project: `general-purpose-agent-quickstart`; existing Neon
  PostgreSQL database and Auth.js/cron configuration retained.
- Corrected security preview deployment:
  `dpl_HqvCNiiDw9Mwc2kgNaJ93DUoB6q4`, **READY**, matching the inspected security
  head above, preview target (not production).
- Stable [security preview login](https://general-purpose-agent-quickstart-git-secu-1658d1-csahingoz-3779.vercel.app/login).
  [Immutable deployment](https://general-purpose-agent-quickstart-he8u1o6y9-csahingoz-3779.vercel.app).
- Vercel Deployment Protection remains enabled, reported as
  `all_except_custom_domains`. This must not be mistaken for proof that every
  production/custom domain is protected; current checks target the preview.
- Earlier metadata checks confirmed server-only owner and Google identity settings
  scoped to the security preview. Values are not recorded here. Existing
  AUTH_SECRET, CRON_SECRET and database variables are retained. No settings were
  changed or secrets read in this documentation task.
- An earlier Google `invalid_client` error prompted correction of the confirmed
  client ID without a URL scheme. The prior public authorization check reached
  Google's normal sign-in page without client/redirect errors. That is evidence
  of initiation only, not a successful OAuth callback or owner session.
- Production is an older release and was not promoted or tested as the new
  security release. No assertion of production hardening is made.

## Implemented foundation and actual gaps

| Area | What code currently does | What is not established |
| --- | --- | --- |
| Identity | Auth.js Google OIDC with identity-only scopes; verified email must match server-only owner setting; first owner login can create/reuse a database user ID. PKCE/state/nonce, JWT/session and request ownership checks are present. | The owner reports Google sign-in works and a subsequent iPhone screenshot shows the chat/model picker. Longer-lived session behavior and stable database identity remain unverified. Apple and app-native passkeys are not implemented. |
| Chat and models | AI SDK **6.0.116**, Next.js 16.4.5, Auth.js beta.32; model selection, streaming and existing Neon chat/message storage are retained. | The first owner reply attempt shows an AI Gateway activation dialog; streaming, model switching and reload persistence remain unconfirmed. A model appearing in the menu does not establish funded/provider access. |
| Integrations | Broad Composio/Supermemory loading removed; no Gmail OAuth/read/send implementation. Guest, public signup and password sign-in disabled. | Google identity login grants no Gmail access. No real email capability is claimed. |
| Scheduled work | Cron requires a configured matching bearer secret and then returns disabled; Vercel cron declaration removed; schedule creation and Telegram execution disabled. Owner list/delete code remains. | No cloud recurring execution. Existing cron utilities/rows are not a working scheduler. |
| Memory | Chat history and a per-user soul/profile prompt with editor/tool remain in code. | No validated general long-term memory/retrieval system. The paid memory demo is disabled. |
| Rich UI | Existing text/tool/document artifact rendering and JSON message-parts storage provide reuse points. | No Open Intelligent UI/json-render integration or durable interactive answer contract. |
| Voice, PWA and sandbox | iPhone Home Screen use is owner-reported. Client-side Python document artifacts remain. | No implemented realtime voice, validated polished/offline PWA, or isolated server sandbox. No dedicated manifest/service-worker source was found in this inspection. |

## Verification evidence

### Rechecked for this documentation task

- Inspected PR #1, source, security docs, five security cases and CI workflow.
- Inspected the matching READY Vercel preview and Deployment Protection metadata.
- Authenticated Vercel fetch: `/login` **200**, Google button enabled;
  `/api/auth/providers` **200**, only `google`, callback matches the stable alias;
  `/api/auth/guest` **403**.
- TypeScript, lint, all five security tests and a credential-free local production
  build: **PASS in this task**. The build migration step
  skips because POSTGRES_URL is not present in this workspace.
- Dependency audits: production has zero findings; the full audit has one low
  development-only `deepmerge` advisory through Ultracite,
  [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
  No patched release was reported; review remains required. No moderate/high/
  critical findings were reported at this check.

### Earlier evidence preserved, not presented as newly rerun

- [GitHub security workflow run 42479183230](https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/actions/runs/42479183230)
  for the inspected security head: **success**, freshly checked via GitHub metadata.
- Earlier local HTTP/OAuth initiation tests checked provider selection, identity
  scopes, PKCE S256/state/nonce, callback URI and disabled access paths using
  synthetic credentials. An earlier phone-sized Chromium check found no password
  field or horizontal overflow. Chromium emulation is not real iPhone Safari.
- Neon integration/migrations succeeded earlier in the project discussion. No
  live database query, owner callback or mail operation was performed here.

## Owner acceptance update — 8 November 2026

The owner reports that the latest Google sign-in fix worked. Their iPhone
screenshot shows Google's consent screen requesting name/profile picture and
email address only. This confirms progress beyond the earlier invalid-client
error and agrees with the identity-only scope boundary. No Gmail permission is
shown. The initial screenshot did not show the callback or assistant chat. A subsequent
iPhone screenshot now shows the chat and its model picker after sign-in, providing
owner-supplied evidence that the chat opens. Message streaming, a model switch and
reload persistence still need confirmation. No new code, credentials or deployment settings were changed for
this status update. Existing test/build results above remain prior evidence;
they were not rerun for this documentation-only edit.

## Outstanding Phase 0 acceptance checklist

- [x] Google recognizes the client and presents identity-only consent on iPhone;
      the owner reports the sign-in fix worked.

- [x] Owner reports Google sign-in works and supplies an iPhone screenshot showing
      the assistant chat/model picker. This is owner-supplied acceptance evidence;
      no independent session/database inspection was performed.
- [ ] Send a short English/Turkish message; an available model streams a response.
- [ ] Refresh/reopen the same conversation and confirm both turns remain. Confirm
      the account ID is stable and any existing history remains attached.
- [ ] Select another available model and confirm a reply uses that selection.
- [ ] Verify signed-out chat/history/model access is denied after accounting for
      Vercel Deployment Protection. Unit tests cover signed non-owner/guest
      cookies; a real non-owner callback remains untested.
- [ ] Distinguish deployed application 401s from Vercel protection: the fetch tool
      previously classified expected history/cron 401s as protection failures.
      Deployment-level cron authorization/disabled-response checks remain
      unverified; local tests do cover them in all environments.
- [ ] Review the low development advisory, dependency overrides, owner linking,
      secret exposure/rotation history and preservation of existing data. A secret
      appeared in a prior screenshot; replacement was requested and the owner
      reported completion. Revocation of the exposed secret has not been
      independently verified. Do not restore or copy that value.
- [ ] Owner reviews PR #1 and explicitly accepts Phase 0. Any merge and production
      deployment require their own explicit authorization; neither follows
      automatically from test results or an acceptance check.

## Usability feedback — model choice

The owner finds the long model menu confusing during the first chat test. The
screenshot appears to show Claude Sonnet 4.6 selected; keep that selection for the
first reply test rather than making the owner compare providers. Record a future
UX recommendation for a clear default and an optional advanced model picker, with
plain-language capability/cost information. This is feedback, not authorization
to change the current model list, pricing assumptions or phase order. No model
quality or cost benchmark has been performed for this recommendation.

## Current blocker — AI Gateway activation (8 November 2026)

The earlier suggestion to open gateway activation is superseded by the owner
requirement below: finish provider setup outside normal chat and prefer genuinely
free-tier access. No payment activation is currently authorized.

The owner's first chat attempt displayed "Activate AI Gateway". Source inspection
of `components/chat/shell.tsx`, `app/(chat)/api/chat/route.ts` and `lib/errors.ts`
shows this dialog handles the gateway payment-method requirement and opens Vercel's
add-card screen. A targeted preview log query returned no matching records, so no
specific runtime error/status was independently recovered from logs.

Current official [getting-started documentation](https://vercel.com/docs/ai-gateway/getting-started)
requires a valid payment method to use free credits. The
[FAQ](https://vercel.com/docs/ai-gateway/faq) describes
`customer_verification_required` for missing verification. Switching models does
not bypass this account requirement. The
[pricing documentation](https://vercel.com/docs/ai-gateway/pricing) says free
credits cover a subset of models and purchased credits transition the account
to the paid tier; auto top-up can charge the saved payment method. No free-credit
amount, account balance, charge or supported free model is assumed here.

The owner must review the activation/credits screen privately and approve the
relevant billing action before any activation or purchase. Proposed initial path:
use available free credits with an eligible model and leave automatic top-ups
and optional paid add-ons disabled. This proposal is not yet approval. No payment
method, credits, keys, budgets or service configuration was changed, and no live
model request was made by the agent. No new code or tests were added. Only the
documentation diff check was run for this status update; earlier build/test
results remain earlier evidence. Phase 0 stays open until a real reply and
persistence checks can complete.

## Updated owner requirement — usable models and free-first setup

The owner rejects a payment/provider activation step inside normal app chat and
expects "Available" to mean actually usable, preferably free. Source inspection
confirmed that the model picker labels a static curated list "Available" without
checking account readiness. This is a Phase 0 gap, not a completed model feature.

PRODUCT_VISION.md and ROADMAP.md now record the required behavior; MODEL_ACCESS.md
contains the researched options, source links, boundaries and next focused PR
proposal. Groq is a candidate with separate Free/paid tiers, but account setup,
free eligibility, English/Turkish quality, tools and privacy still need validation.
Gemini's selected free models are another option with data-use/region terms to
review. No free provider or model has been connected, benchmarked or claimed live.
No production changes, payments, model calls, dependencies or credentials were
made for this requirements update. Documentation links and diff checks passed;
application tests/build results above are prior evidence, not newly rerun.

## Collaboration preference and immediate owner step

The owner is not a developer and explicitly requires step-by-step guidance with
one clear next action at the end of each response. This is now a standing AGENTS.md
instruction. If no owner input is needed, say so and continue authorized work.

Recommended next owner step for evaluating the free-first route: open Groq Console
and create/sign in to a free account. Do not add a card or upgrade. Report when the
dashboard is open; provider eligibility/data controls and private key setup follow
as separate guided steps. This is not evidence that an account, key or integration
already exists, and does not authorize paid usage or sending sensitive integration
data. Vercel AI Gateway activation remains deferred. Only documentation changed
for this preference update; its diff check passed. Runtime tests were not rerun.

## Smallest next implementation and costs

First implement and validate the bounded Phase 0 model-readiness correction in
MODEL_ACCESS.md through a focused reviewed PR. After Phase 0 passes and the owner
confirms Phase 1, make one separate PR for a
fictional inbox report inside the existing chat: chart, threshold slider and cards,
with a validated versioned spec and persisted selection. Use deterministic data,
instant local filtering, no Gmail or extra model calls per interaction. Compare
current Open Intelligent UI and json-render adapters against the existing AI SDK 6
before selecting a dependency; no adapter was evaluated or added in this task.
See NEXT_IMPLEMENTATION.md for the contract, alternatives and acceptance criteria.

No new services, dependencies, paid infrastructure or model calls are introduced
by these documents. Ordinary repository CI/preview automation may consume existing
GitHub/Vercel allowances. Voice cost, scheduler pricing and any $15/month planning
example remain unmeasured; no guaranteed budget or new billing is implied.

Read AGENTS.md, PRODUCT_VISION.md, ROADMAP.md and this file at every task start.
After each milestone, replace stale statuses here with evidence, PR/deployment
links, actual tests, cost impact, remaining risks and the next bounded decision.
