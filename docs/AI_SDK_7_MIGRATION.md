# AI SDK 7 migration — implementation and acceptance

Branch `feature/ai-sdk7-migration`, draft PR #9, stacked on Conversation Engine
PR #8 (`970b612`). Neither PR is merged. This completes the existing migration
instead of introducing a second assistant implementation.

## Installed and checked

Locked install on Node **24.22.1**, pnpm **10.32.1**. Installed `ai` **7.0.165**,
`@ai-sdk/react` **4.0.169**, `@ai-sdk/openai` **4.0.111** and provider **4.0.37**.
Node is pinned to 24.x; Next 16.4.5, React 19.0.1, Auth.js and the database schema
are retained. SDK 7 is ESM-only. The bundled guide/types/source were inspected
and checked against the official [6→7 guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0).

| Boundary | Implemented change and reason |
| --- | --- |
| Core generation | `instructions`, `isStepCount`, `stream` replace deprecated names across chat and all artifact handlers. Internal budget helper still calls its own field `system`; it is not an SDK option. Fixed the initial migration's incorrect helper argument. |
| UI streaming | Stateless `toUIMessageStream` over `result.stream`, typed custom data chunks, existing UI response/SSE transport retained. Explicitly forward inner `outcome` to the composed writer: SDK 7 otherwise reports `unknown` even after a successful inner stream. |
| Persistence | Use stream `onEnd` and its single `responseMessage`/outcome. Save meaningful text/tools, mark interruptions in an additive JSON part, and retain full tool outputs and existing message IDs/history. No schema migration. |
| React | `useChat` still uses `onFinish` in this installed version; it is not the core callback rename. Keep DefaultChatTransport. Regeneration uses the last user ID; approval continuation now depends on the last assistant, rather than any historical approval. |
| Groq | Retain explicit OpenAI-compatible `.chat()` and Groq base URL. Adapter is V4. Keep provider-specific low reasoning effort, zero retries and exact verified model allowlist; no Responses endpoint, Gateway or paid/provider fallback. |
| Tools/context | `toModelOutput` remains supported. Full weather/inbox UI parts persist while the model receives compact summaries. Count actual active JSON schemas in the conservative budget; retain the latest user even after many tool messages, and keep call/result pairs together. |
| Artifacts/structured output | Migrate all artifact streams; bound nested calls, propagate cancellation and throw on stream errors/empty content before saving. Suggestions use schema-validated `elementStream`, not incomplete partial-array snapshots. |
| Errors | Sanitize fatal and tool-error chunks; do not expose raw upstream JSON. Preserve EN/TR size/quota messages across composed error boundaries. Generic tool rendering also masks historical raw errors. |
| Telemetry | SDK 7 moved tracing out of core. Add matching `@ai-sdk/otel` **1.0.165**, register it with existing Vercel OTel, and disable prompt/output/header/runtime-context capture. Synthetic readiness probes disable telemetry. |

## Inherited Conversation Engine defects corrected

- Concurrent retries could generate twice. A direct, **unpooled** PostgreSQL
  session advisory lock now serializes generation for each conversation across
  application instances. It is released on completion/error/cancellation and
  disconnect; editing also checks it. No long transaction or new table is used.
  Use existing `POSTGRES_URL_NON_POOLING` or `DATABASE_URL_UNPOOLED`; never a
  transaction pool for a session lock. Missing direct configuration fails closed.
- Text interrupted after partial output could not be retried after reload.
  Persist an interrupted/retryable marker and replace the same assistant ID
  under the lock. Canonical saved user text wins over retry payload edits.
  Keep the previous partial record until replacement output is ready. Completed
  replies cannot be replayed. Failed turns with tools cannot be automatically
  rerun, because that could repeat a document/profile/schedule change; use a
  follow-up. Unattended external actions remain disabled.
- Approval continuations previously spread client tool parts over saved input.
  Only a matching persisted pending approval's ID/decision can now change.
  This is not Gmail send approval and grants no new capability.
- Short explicit topic changes inherited previous tool schemas. Weather→inbox
  and weather→thanks regressions now pass; short city follow-ups still work.
- Artifact requests exceeded the engine's own budget even in an empty chat.
  Replace contradictory/repeated artifact instructions with a concise contract
  and select the relevant artifact operation instead of all four schemas.
- Nested artifact calls had default provider retries, no output cap and could
  save partial/empty content as success. They now fail safely before persistence.
  Weather requests also have deadlines and validate response status/shape.

## Verification

- Locked installation, TypeScript, Biome, **34 security/SDK tests**: PASS.
- Production dependency audit: zero findings. Full audit: one existing low
  development-only deepmerge/Ultracite advisory (GHSA-gcqx-w48m-w2h4), no reported
  patch; no moderate/high/critical findings. Existing React/next-themes and OTel
  logs peer warnings remain; unrelated packages were not upgraded to hide them.
- Credential-free production build: PASS; no provider calls without a key.
- Existing phone-sized Playwright suite: **3/3 PASS** (readiness/model selection,
  History navigation, fictional inbox), with its documented client fixtures.
- New integrated Playwright/PostgreSQL suite: **3/3 PASS**, exercising actual
  Next routes, SDK 7 stream adapters, V4 Groq wire format and migrated database
  schema on disposable PostgreSQL 17. Both model selections, Turkish→English
  follow-up, weather, inbox, local slider, saved History/reload and artifacts.
  Rate-failure/reload Retry, partial-stream/reload Retry, replay rejection,
  concurrent requests and lock release are checked.
- CI runs both browser suites, with a disposable PostgreSQL service. Synthetic
  provider preload is test-only, requires a dummy key and cannot forward a real
  credential. No app route or authentication bypass was introduced.

Run `pnpm test:security`, `pnpm test:readiness-ui` against a credential-free build
on port 3100 as in CI, then `pnpm test:sdk7-integration` with disposable PostgreSQL
17 on 127.0.0.1:55432. The latter overrides credentials only in its test subprocess,
builds with synthetic inference and starts port 3101. Never point tests at Neon.
Screenshots/provider request captures contain synthetic data only.

**These are local/CI integration tests, not real Groq or iPhone Safari proof.**
Runtime 8c70ca6 passed GitHub CI run 42523660161; its protected Preview is READY
with missing credentials correctly reported as not configured.
Protected-preview deployment/CI IDs and live acceptance are tracked in
[CURRENT_STATE.md](CURRENT_STATE.md). A READY preview without credentials is not
acceptance. The SDK 7 branch initially had no owner/Google/Groq preview settings;
existing security settings were preserved, not moved or decrypted. Complete
real EN/TR, both models, weather, inbox, History and retry tests after branch
configuration and an actual owner session are available.

## OpenUI and realtime compatibility

Keep the existing UIMessage parts and Neon chat as the shared conversation.
The fictional inbox remains its current trusted React tool card, not a new OpenUI
implementation. The planned renderer boundary stays independent of model routing
and can consume versioned data parts; no second chat shell/localStorage history,
renderer package or privileged UI action is added. The official OpenUI framework guide confirms the backend can be retained with
a different chat UI; we inspected that guide and its UIMessage adapter example.
Published react-lang peer
ranges accept our React/Zod versions, but peers and the vendor's SDK integration
example are not a tested renderer integration. Re-evaluate the actual adapter
when implementing the proposed OpenUI/json-render spike.

The installed SDK 7 ships experimental realtime sessions/useRealtime. That is a
separate, not-yet-stable provider/token/transport boundary. Preserve the same
owner-authenticated chat ID and persisted turns for future voice, server-minted
short-lived audio credentials, cancellation and plain-text fallback. No realtime
provider, audio credential, Gmail scope or recurring execution is activated here.

Remaining limitations: budget accounting is conservative estimation, not an exact
Groq tokenizer or cross-chat TPM scheduler; free quota can still fail. A restarted
instance releases its PostgreSQL lock but cannot itself resume a lost provider
stream without configured resumable infrastructure. Tool interruptions are
preserved with a follow-up path rather than unsafe automatic replay. The inbox
fixture itself persists; its slider selection still resets on reload, as in the
existing spike. That is a later interaction-state requirement, not an SDK failure.
