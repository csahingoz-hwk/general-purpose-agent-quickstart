# Phase 0: usable chat without Gateway activation

The owner's first chat attempt reached the interface but opened AI Gateway's
payment activation dialog. A static model catalogue had been presented as
"Available" without checking credentials or inference. This change uses the
owner's separately configured Groq account directly and removes that dialog.
Vercel Chatbot, Auth.js owner checks and Neon storage remain the foundation.

## Behaviour and implementation

- Everyday chat (GPT OSS 20B) is the preferred default; Detailed chat (GPT OSS
  120B) is optional. Only exact allowlisted models that pass inference checks
  appear. Friendly names and descriptions are searchable. No premium catalogue,
  automatic provider fallback or billing activation remains in normal chat.
- `scripts/build.ts` verifies credentials against Groq's model list, then uses
  the same AI SDK Chat Completions adapter as chat for at most two synthetic
  greeting requests. Each has a 128-token output cap, a 15-second timeout and
  zero retries. Only models returning nonempty text qualify. A 401/403/429 stops
  probing. These calls use account quota; no private conversation is sent.
- Nonsecret verification metadata is embedded in the build. Missing/invalid
  credentials or failed verification produce a working application with chat
  disabled and an explanation; they never enable a static fallback catalogue.
  Rebuild the preview after changing credentials or restoring verification.
- Owner-authenticated `/api/models` and each chat request check the current
  provider catalogue before allowing a build-verified model. Listing is not
  proof of remaining quota. Errors are sanitized and drafts are preserved.
- Chat generation is capped at 2,048 output tokens and three tool steps, with
  zero retries. Titles are derived locally from the opening message, removing
  a separate provider call. Existing narrowly scoped document/profile tools
  remain; no Gmail, scheduler, broad tool loader or remote shell is added.
- The adapter reuses the existing OpenAI-compatible SDK but points explicitly
  to `api.groq.com`; it does not call OpenAI or Vercel AI Gateway. No new package
  or database/schema migration is introduced.

## Credentials, cost and privacy

`GROQ_API_KEY` belongs only in Vercel's private Secret field. The saved variable
was initially Production-only; its scope was corrected to Preview and
`security/owner-only-hardening`, preserving the value without reading it. No
production deployment or other existing secret was changed. Build logs emit
only readiness count and a controlled diagnostic, never credentials/responses.

The owner supplied account evidence showing an Upgrade to Dev Plan option and
reports enabling Inference APIs Zero Data Retention. These are owner-provided
facts, not independently inspected billing or retention guarantees. No payment
method, plan upgrade, Workspace connector or Gmail scope was configured here.
Groq quota and eligibility can change. The app does not inspect billing tier;
it cannot promise perpetual zero cost if account billing is later changed.
A 429 must remain a temporary limit with no paid fallback.

A direct free account avoids Gateway's activation requirement with minimal code.
The tradeoff is provider-specific quota, availability and data terms. English/
Turkish quality, tool behaviour and real Safari performance still need owner
acceptance; successful synthetic inference is not a quality benchmark.

## Verification and remaining gates

Run TypeScript, Biome, `pnpm test:security`, both dependency audits, and
`pnpm build`. Without a key, no provider network call is made during the build.
Six readiness regressions extend the existing five security cases: missing key,
catalogue-only failure, auth failure, quota failure, empty/network responses and
unapproved model metadata.

Phone-sized Chromium verification is `node --import tsx
scripts/test-model-readiness-ui.ts`, against a credential-free production build
started on port 3100 with synthetic `AUTH_SECRET` and `APP_OWNER_EMAIL` matching
that script. It checks unavailable send/draft preservation, the two-model
fixture, friendly-name selection, phone width and failed-send input restoration.
A local-only BotID challenge fixture permits the intercepted failed request;
production BotID protection is unchanged. Fixtures never represent live provider,
real Google or Neon persistence tests. CI runs the same browser check.

Before Phase 0 acceptance: inspect the actual Vercel build readiness result;
complete a real owner chat, a second model reply, reload persistence and stable
identity/history check; close the remaining security checklist in the shared
CURRENT_STATE document. PR #1 remains draft, with no automatic merge or
production promotion. Rich UI, voice, Gmail and scheduled execution remain gated.

Sources: [Groq models](https://console.groq.com/docs/models),
[billing FAQ](https://console.groq.com/docs/billing-faqs),
[rate limits](https://console.groq.com/docs/rate-limits),
[data controls](https://console.groq.com/docs/your-data).
