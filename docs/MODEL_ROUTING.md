# Premium routing implementation

This branch is stacked on SDK 7 PR #9, not main. No production change, billing
activation, credential configuration or real OpenAI inference is authorized by
this implementation. The default remains unavailable until the owner explicitly
enables API spending, saves private branch settings and provisions the usage
ledger on an approved database. Existing testing URLs/settings remain untouched.

## Verified model contract (8 November 2026)

Sources: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra),
[Standard pricing](https://developers.openai.com/api/docs/pricing),
[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
The installed `@ai-sdk/openai` 4.0.111 explicitly lists both identifiers and
implements their Responses options and cache-write usage fields.

| Model ID | Input / 1M | Cached input / 1M | 30m cache write / 1M | Output / 1M |
| --- | ---: | ---: | ---: | ---: |
| `gpt-6-luna` | $0.10 | $0.01 | $0.125 | $0.50 |
| `gpt-6.1-terra` | $1.00 | $0.05 | $1.25 | $5.00 |

Both publish 1,050,000 context, 128,000 maximum output, streaming, multilingual,
function calling and structured outputs. Terra **requires Responses for tools**;
Luna Chat Completions supports tools only with reasoning disabled. We explicitly
use the official Responses endpoint for both, Standard processing, 30m implicit
caching, no hosted tools and `store:false`. Luna uses low reasoning; Terra medium.
Reasoning tokens are included in output totals and are not charged twice.
Cache writes replace ordinary input charges for those tokens, not an additive
fee. No 12h writes, Fast/Ultrafast tier, region uplift or long-context premium is
requested. The wrapper rejects a conservative input bound above 272,000 to keep
calls in the published normal price bracket.

Published Free tier supports neither model. Published Build limits: Luna 5,000
RPM / 2M TPM; Terra 5,000 RPM / 1M TPM. Those are public limits, **not verified
entitlements for this owner's account**. Runtime catalog checks only configured
model access, never spend credits on readiness probes. They do not prove usable
credit, quota or generation quality. If Luna is absent, chat stays unavailable;
Terra cannot silently become the default. No model identifier is substituted.
Anthropic remains unimplemented/unbilled. Its future SDK adapter can implement the
same V4 interface without changing UIMessage storage, the renderer or tool consent.

## Small routing boundary

`catalog.ts` defines identity, prices and capabilities/budgets; `providers.ts`
checks server-only authentication; `model.ts` wraps the existing SDK V4 adapter;
`policy.ts` classifies failures; `ledger.ts` handles transactional reservations
and usage. One AsyncLocalStorage request context shares its usage ledger and
exposure/tool boundary across SDK steps **and nested artifact calls**. Existing
chat IDs, UI message IDs, approved local tools and Neon message parts remain the
conversation authority. The UI is provider independent. No generated JS, new
chat shell, Gmail connection, external action or voice service is introduced.

- Ordinary chat starts Luna. Detailed chat is an explicit owner choice of Terra,
  useful for hard reasoning. We do not infer difficulty from question length or
  run an extra paid classifier. Quality-based automatic escalation currently
  requires a schema validation failure before any output is exposed.
- At most one Luna → Terra fallback per user request: eligible HTTP 5xx before
  exposure, or invalid buffered structured output. Structured JSON is bounded,
  parsed and schema validated before release, retaining the failed attempt's cost.
- No fallback on shared 429/rate limits, exhausted credits/spend caps, auth,
  context overflow, cancellation, unclassified errors, tool failures, unavailable
  Terra, or after text/reasoning/tool events are emitted. Once any tool call is
  emitted, the entire request is ineligible, including subsequent SDK steps and
  artifacts. This is deliberately conservative even for read-only tools.
- Partial text remains visible/persisted as interrupted, including token-limit
  finishes (not just transport disconnects). Reported usage is still charged. Recovery uses the
  existing explicit Retry action and canonical saved user input/same assistant
  ID; completed or tool-effect turns cannot automatically replay. Tool work needs
  a follow-up. A new provider does not erase these SDK 7 invariants.
- Provider errors are sanitized before the SDK can log them; explicit onError
  callbacks suppress the SDK's raw request/response logging. Only fixed failure
  categories and token/cost records are stored, never prompts, emails or keys.

## Context and memory

The provider supports 1.05M context, but always filling it would defeat the cost
and latency target. Luna uses a 32,768 total request budget/2,048 output limit;
Terra 65,536/4,096. These are tunable application budgets, not Groq's former TPM
limit. Budgeting retains the largest coherent recent window fitting the budget,
plus labeled incomplete older excerpts when there is room, never dropping the
latest user or splitting tool call/results. Neon retains all messages unchanged.
Current request text limit grows from 2K to 50K characters. A single oversized
request fails helpfully rather than being silently truncated or sent to Terra.

Instructions/tool order stay stable; only relevant schemas are loaded. Complete
weather/inbox data stays in persisted UI parts; model-facing outputs stay compact.
The existing owner soul/preferences remain in stable instructions. Older excerpts
are **not semantic memory**; durable preference learning/vector memory is later
work. Prompt caching is provider-managed and measured, never assumed in estimates.

## Usage and allowance

One additive `ModelUsage` table stores per-invocation model, request ID, input,
cached/read/write, output/reasoning tokens, estimated USD, fallback reason and
outcome. `/usage` (user menu) shows daily/monthly UTC estimated spend, requests,
model calls, fallback count/cost and individual call usage. `/api/usage` is owner
protected. Table setup is deliberately separate from normal build migrations so
an automatic preview cannot alter a shared production database.

Before **each** invocation, a short PostgreSQL transaction locks the owner's
spending lane and reserves a conservative text-byte/input overhead + max-output
cost. Multiple chats/instances cannot bypass the allowance by racing. No provider
call starts without a successful reservation. Final provider usage settles that
reservation, including nested calls, multiple steps and unsuccessful fallback
attempts with reported usage. Unknown usage retains the **full reservation**;
missing write details conservatively price noncached input as 30m cache writes.
These estimates can overstate a failed call's cost and need manual reconciliation
against provider records. Reservations never expire automatically after an
uncertain call. Database/ledger failures stop inference safely.

Default monthly allowance is $10. Configuration permits lowering it, and rejects
invalid/unbounded values or more than $10. Reaching it preserves the user's turn
and explains that capacity is paused. No recharge, account change, paid provider
switch or Groq fallback occurs. This is an application safeguard, **not a guaranteed
provider billing hard cap**; estimator/runtime/crash/account sharing can differ
from the invoice.

Use a dedicated OpenAI project with its **Enforce a hard limit** spending control
at $10 plus earlier alerts. [Official spending controls](https://developers.openai.com/api/docs/guides/spend-limits)
distinguish alerts (traffic continues) from enforced org/project hard limits
(429). Provider enforcement is not instantaneous and may slightly overshoot.
Disable prepaid auto recharge if using credits. No settings were configured here.

## Text-only monthly scenarios (3,600 user messages)

Assume one Luna call per message, plus an *additional full Terra call* on 5% of
requests, no caching discounts, all input conservatively treated as 30m writes.
Output includes reasoning. Tool/artifact calls increase totals beyond these
assumptions; hosting/database/audio and taxes are excluded.

| Mean input / output per invocation | Luna total | Extra Terra (5%) | Combined |
| --- | ---: | ---: | ---: |
| 4,000 / 600 | $2.88 | $1.44 | $4.32 |
| 6,000 / 600 | $3.78 | $1.89 | $5.67 |
| 8,000 / 800 | $5.04 | $2.52 | $7.56 |
| 20,000 / 800 | $10.44 | $5.22 | $15.66 |

Thus $5–6 is plausible for moderate context/output, not guaranteed. Actual cache
hits lower input cost, whereas long History, reasoning, retries and multi-step
tools raise it. Terra costs roughly 10× Luna per ordinary input/output token;
selective escalation matters. Compared with the legacy 8K TPM lane this buys
longer context, less aggressive truncation and explicit accounting/recovery;
synthetic tests cannot demonstrate better real bilingual quality or latency.

## Activation after review and explicit spending approval

No action is needed to run synthetic CI. For later controlled live acceptance:

1. Owner approves a bounded real API test and API spending. Verify the dedicated
   project's actual model entitlements and provider-enforced spending limit.
2. Choose an approved preview/test database; explicitly apply
   `lib/db/usage-schema.sql` there. No conversation table is altered. Do not
   point experiments at production as a shortcut.
3. Privately configure branch-specific Preview `OPENAI_API_KEY`,
   `OPENAI_API_USAGE_ENABLED=true`, allowance at/below 10, and existing owner,
   Google OAuth and database settings. Never share values in chat. Keep existing
   security-branch entries and its testing URL unchanged. No Groq key is required.
4. Preview-only rebuild; configure that preview's Google callback if necessary;
   test an actual owner session and bounded real Luna/Terra EN/TR, weather, inbox,
   History, retry and usage records. Compare real cost/quality before acceptance.

Groq adapter/verification stay isolated for explicit rollback/development. Both
`CHAT_PROVIDER=groq-legacy` and `ENABLE_LEGACY_GROQ=true` are required; default
OpenAI operation ignores `GROQ_API_KEY`. No automatic Groq fallback exists.

## AI Gateway lane (Preview only, explicit opt-in)

Enabled only by `AI_GATEWAY_USAGE_ENABLED=true` on a Preview environment. It uses
the **native AI SDK Gateway provider** (`createGateway()` from `ai`), which
resolves authentication itself on every request: an explicit key, then
`AI_GATEWAY_API_KEY`, then the Vercel OIDC token. On a deployed function that
token arrives in the `x-vercel-oidc-token` request header; it is **not** in
`process.env`, so the application must never look for a credential there.

Verified 9 November 2026 against the installed `@ai-sdk/gateway` 4.0.138 and the
public Gateway pages: slugs `openai/gpt-6-luna` and `openai/gpt-6.1-terra`
(1.05M context, 128K output, OpenAI/Azure/Bedrock providers). Requests set
`providerOptions.gateway.only = ["openai"]`, so routing never hops to another
host. Public model IDs in the app stay `gpt-6-luna` and `gpt-6.1-terra`.

Readiness (`/api/models`) is `ready` only after an authenticated catalog call
through the native provider listed Luna. It returns a machine-readable `reason`
and a safe `hint`; raw provider text, headers and credentials are never returned.

| `reason` | `status` | Meaning |
| --- | --- | --- |
| `ready` | ready | Authenticated catalog lists Luna (Terra listed or reported in `unavailableModels`) |
| `provider_opt_in_missing` | setup_required | `AI_GATEWAY_USAGE_ENABLED` is not `true` in this deployment |
| `spend_configuration_invalid` | setup_required | `AI_MONTHLY_ALLOWANCE_USD` is not a number in (0, 10] |
| `gateway_auth_missing` | setup_required | No API key and no OIDC token reached the function |
| `gateway_auth_rejected` | setup_required | Gateway returned 401/403 for the credential |
| `catalog_unavailable` | temporarily_unavailable | Catalog unreachable, 5xx or timed out; never cached |
| `model_unavailable` | temporarily_unavailable | Luna is not listed; Terra never silently becomes the default |

The `$10` application allowance and spend reservations are unchanged and are an
application guard, **not** a provider billing cap. Gateway credits, auto top-up
and invoices remain under the owner's Vercel billing controls.

Not yet verified live (needs an authenticated browser session): that the native
route honours the OpenAI options `store`, `serviceTier`, `parallelToolCalls` and
`promptCacheOptions`. The Gateway's documented Responses endpoint
(`/v1/responses`) lists `reasoning.effort`, `store`, `parallel_tool_calls` and
`max_output_tokens` but not the other two. Confirm in Gateway logs and the
`ModelUsage` ledger on the first real calls.


## Web search and 3-day forecast (10 November 2026)

**Web search — IMPLEMENTED for the AI Gateway lane only; NOT exercised against the
live service (no paid call was made).** `webSearch` is
`gateway.tools.deepseekSearch({ count: 5, needContent: false })` from the
installed `@ai-sdk/gateway` 4.0.138, a provider-executed tool: AI Gateway runs the
search and the model keeps writing in the same model call. No DeepSeek key; auth
is the existing Gateway OIDC/API-key path.

- **Offered only when** `AI_GATEWAY_USAGE_ENABLED=true`, legacy Groq is off and a
  premium model (Luna/Terra) is selected (`webSearchLane`). On the direct-OpenAI
  and legacy Groq lanes the tool is never registered, never active and the
  routed model rejects any provider tool. **Everyday chat is `gpt-6-luna`**
  (`DEFAULT_CHAT_MODEL`). With the Gateway flag on, that lane already is the
  Gateway web-search lane (`webSearchLane("gpt-6-luna")`); search-eligible turns
  stay on Luna and do not hop to Terra or to Groq. The legacy Groq menu item
  also named "Everyday chat" (`openai/gpt-oss-20b`) cannot search: Groq and
  Gateway are mutually exclusive, and the provider-executed search tool exists
  only on Gateway. Per turn, when the lane is on, web search is offered for
  questions that may need current public facts (fixtures, prices, news, open
  questions) so the model can decide to call it. Clear exclusions stay off the
  paid tool: weather (`getWeather`), greetings and advice, clock questions, and
  pure document or local-tool edits. Fixture/price/news wording is a fallback
  so "Galatasaray’ın bi dahaki maçı ne zaman?" still searches.
- **Untrusted results.** In a webSearch turn no state-changing tool is offered
  (`setHomeLocation`, `setSoul`, `cancelSchedule`, create/edit/updateDocument,
  requestSuggestions); a system line says results are data, not instructions, and
  to cite title/URL. Earlier search parts are not replayed to the model; the UI
  keeps the stored full output (5 results without page content).
- **Step budget / cap.** `isStepCount(2)` is unchanged and sufficient: the
  search result and answer arrive inside step 1's model call. SDK steps cannot
  bound the Gateway-side loop, so the routed model counts provider-executed tool
  calls and aborts the stream above `WEB_SEARCH_MAX_CALLS = 3` per model call
  (outcome `tool`, no fallback). *Assumed, not verified live:* that the Gateway
  streams the tool call/result and the continued text in one call.
- **Price and ledger.** USD 0.75 per 1,000 billable requests
  (`WEB_SEARCH_COST_USD = 0.00075`, catalog). The Gateway reports actual cost only
  in separate generation lookups, which the ledger does not use, so cost is
  counted: the reservation includes the capped worst case (3 searches); on settle
  `estimatedUsd = token cost + observed searches x 0.00075`. Failed/empty searches
  are not billed by Vercel, but every attempted call is counted (never
  under-reports). No schema change; with unreported usage the reservation (which
  includes search) stays. Host-model tokens are charged as before.
- **MOCKED / PENDING.** All tests are synthetic. Pending: a first real search,
  confirming Gateway streams `providerExecuted` calls as assumed, real cost vs the
  constant, and result quality in Turkish.

**3-day forecast (free, Open-Meteo).** `getWeather` also requests
`temperature_2m_max/min`, `precipitation_probability_max`, `precipitation_sum`,
`weather_code` and `forecast_days=3`; the model receives a compact `daily` array
(today, tomorrow, day after) with units. The weather card is unchanged.
