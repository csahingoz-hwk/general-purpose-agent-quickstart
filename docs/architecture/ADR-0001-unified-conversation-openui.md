# ADR-0001 — One conversation, model-aware Intelligent UI and voice

**Status:** Proposed for owner review · **Date:** 2026-11-08  
**Scope:** Product architecture; no runtime, billing, production, OAuth, or Gmail changes.

## Decision in one paragraph

**Keep the secured Vercel Chatbot (Next.js / AI SDK 6 / Auth.js / Neon) as the single application and conversation authority.** Use the **OpenUI Lang renderer and a deliberately small trusted component library** for *optional inline visual answers*, not a wholesale fork of the Open Intelligent UI demo's chat shell, API, localStorage or tool endpoints. Treat OpenUI as the **first implementation candidate**, with Vercel `json-render` as a benchmarked fallback if the prototype exposes material integration or safety problems. Keep the current approved Groq GPT-OSS text models for the first controlled test; **do not assume they can generate reliable OpenUI just because they stream normal chat**. A separate realtime audio service can later turn speech into/from turns in the **same** conversation. Paid model access, OpenUI Gateway, and future Gmail scopes remain opt-in, not implicit architecture prerequisites.

## What we verified vs what we have not

- Draft PR #1 (`security/owner-only-hardening`) now implements **Groq direct inference**, a free-account-preferred **GPT-OSS 20B Everyday** model and **GPT-OSS 120B Detailed** model, owner-only sign-in, and removal of unrestricted external tool/cron execution. Its PR reports successful limited synthetic model probes and a READY protected preview. **Real owner bilingual chat, refresh persistence and live latency remain to be accepted.** Never treat a READY build as evidence of a complete app.
- Draft PR #2 (`docs/product-direction`) contains the current product roadmap, model-access rules and handoff. This ADR is stacked on **PR #2**, not main.
- [OpenUI](https://github.com/thesysdev/openui) includes `@openuidev/react-lang` for rendering and `@openuidev/react-ui`/`react-headless` for optional full chat shells and streaming adapters. Its [Vercel AI SDK integration](https://www.openui.com/integrations/vercel-ai-sdk) explicitly supports SDK **6/7**. **That adapter demonstrates replacing/using an OpenUI AgentInterface; it does not by itself integrate a renderer into our current message components.** We must write and test that seam.
- The [Open Intelligent UI demo](https://github.com/thesysdev/open-intelligent-ui) is an independent, MIT-licensed implementation. It includes its own Next.js app, chat UI, browser localStorage, image search, demo APIs, Map/HTML features, and a substantial prompt (~8k tokens for its full library). **Reuse scoped components, prompt patterns, evaluator ideas; do not import the whole app or expose demo endpoints.**
- OpenUI's [published benchmark](https://github.com/thesysdev/generative-ui-bench) tests 46 briefs × four generations/model/format across OpenUI, A2UI and json-render. It measures **structural validity**, not factual accuracy, Turkish conversation, real tool correctness or mobile usability. It is vendor-published; use as **evidence for a hypothesis**, not proof about *our* GPT-OSS models. The published corpus does **not** establish Groq-hosted GPT-OSS 20B/120B quality in our usage.
- [json-render](https://github.com/vercel-labs/json-render) now has a genuine inline-chat example using `pipeJsonRender` and AI SDK UIMessage parts; it is not merely a static JSON renderer. Include its chat example in the comparison rather than dismissing it based on older versions.

## Architecture / ownership boundaries

```text
iPhone PWA (text + eventual mic + visual cards)
    |
    | authenticated turn; optional transcription
    v
Existing Next.js AI SDK 6 chat API — ONE conversation/stream identity
    | Auth.js owner session, permissions, budget policy
    | conversation history and UI message parts in Neon
    |
    +-- intent/response planning (plain text by default)
    +-- approved read-only tool calls -> typed, source-grounded data
    +-- chosen verified Groq model(s) -> ordinary response
    +-- when warranted: restricted OpenUI Lang generation
    |        -> parse/validate/version -> typed data-ui-spec part
    |        -> allowlisted React components rendered in existing chat
    +-- eventual speech transport -> transcript + concise spoken content
    |
    +-- user UI state/actions (validated by signed-in backend)
         no direct external write; explicit approvals for real actions
```

**Single source of truth:** Keep the existing `Chat`, `Message_v2` and identity relationships in Neon. The visual-spec output must become a **versioned message part** (`format: openui-lang`, `schemaVersion`, `sourceModel`, `spec`, `dataSnapshotRef` or safe embedded fixture, `createdAt`). Never persist only the rendered DOM. Store mutable selections separately under authenticated chat/message ownership with a revision/CAS check; initial spike may keep it inside the existing JSON message parts if safe, with an authenticated update route, to avoid premature new schema migrations.

**Tool/data separation:** Models may describe presentation but must not author arbitrary executable JavaScript, network requests or privileged API calls. Keep personal data behind server tools and return only necessary typed datasets to UI generation. All factual charts must be derived from the same tool result/snapshot that supports the prose. If a render fails, show useful text plus a retry affordance; no blank message.

**Interaction separation:** Local chart filters, tabs, sliders and checklists use safe client state and predefined pure transforms, with zero model round trips. Sending a reply or creating a recurring task must use an authenticated server action with verified resource ownership and explicit permission, never a model-emitted URL/tool name or voice-only yes. `HtmlView`, arbitrary iframe/code, remote image fetch/search and privileged OpenUI actions are **disabled in the first slice**. Only enable further components after security, accessibility and privacy reviews.

**Voice contract:** Voice is **another input/output transport**, not another agent memory or tool system. Transcribed turns use the exact same authenticated chat route and conversation ID; a separate realtime voice session may handle interruption/audio buffering. UI is shown on the screen, while speech uses a short natural-language summary. Test iOS PWA mic lifecycle, barge-in, reconnect and EN/TR code-switching before provider selection. No voice account or spend enabled yet.

## Model selection: capabilities, not vendor branding

| Role | Initial policy | Required proof |
| --- | --- | --- |
| Chat reasoning / tools | Groq GPT-OSS 20B Everyday; 120B Detailed | EN/TR multi-turn quality, accuracy, latency, tool calling, actual quota |
| Visual-generation candidate | **Test both existing GPT-OSS models** with the *reduced* OpenUI component spec | Correct parse, reachable root, no unsupported component, chart data fidelity, interaction and cost |
| Comparator if existing models fail | Test an explicitly approved stronger hosted model with budget cap | It must materially improve meaningful end-to-end scores, not just support a marketing benchmark |
| Voice | Dedicated realtime provider only when ready | EN/TR speech, interruption, mobile lifecycle, cost per minute |
| Background | Later least-privilege economical model | No new external tools or send approval bypass |

Do **not** automatically call a premium model, buy credits, open a payment dialog inside chat, or silently re-route from the approved provider. A model being in an API catalogue is not proof of usable credentials/quotas. Provider/account setup stays separate.

### UI-generation strategy: conditional, not every message

1. **Plain text first-class** for simple answers. Avoid injecting the full visual-library instructions into every turn.
2. For a clearly visual question or structured tool result, build a **grounded presentation brief** with only the relevant component subset and typed data.
3. Prefer a **two-stage tool-result → presentation** pipeline for the first proof of concept. This avoids mixing sensitive tool execution and model-authored UI DSL. Measure its cost/latency; test a single-stage stream only if safe and demonstrably better.
4. Stream a short textual answer early, then bounded `data-ui-spec` increments; validate server side before treating the spec as trusted. At minimum check syntax, schema, component allowlist, required props, reference graph, data provenance, output-size and complexity limits.
5. Keep the model's generated text and rendered UI in one history turn. Preserve server-side context; do not copy the OpenUI demo's browser-only history mechanism.

### Why OpenUI first (provisional)

It targets richer reactive interactions, compact streaming OpenUI Lang and a first-party SDK 6 adapter. It has a tested renderer and vendor-published structural benchmark. This aligns with our goal of sophisticated visual answers. **Risks:** long prompts, unfamiliar DSL for 20B, dependency/React/Zod compatibility, parser version skew, incremental persistence, security of built-in actions. **Alternative:** json-render's current AI SDK chat example is a strong integration baseline. Benchmark both inside our unchanged chatbot and decide from measurements. Do not install two full renderers into production.

## Integration order — thin vertical slice, not feature silos

**Gate A — finish Phase 0:** test *actual* owner login, English+Turkish streamed replies on 20B/120B, reload persistence, server-side model allowlist, unauthorized access and prompt/tool regression. Keep PRs unmerged until review.

**Gate B — a single end-to-end fictional scenario:** User asks in Turkish for a week's fictional inbox priorities and a chart, then switches to English for a draft. One message includes text + rendered chart/table + priority slider; slider changes derived data *locally*. State persists after reload. No Gmail API, real send, cron activation, model billing, external arbitrary code or new full UI shell.

**Gate C — voice interface to the same conversation:** After bounded EN/TR speech evaluation, speak a follow-up and reuse conversation context; visual results remain on screen.

**Gate D — real integrations:** Gmail read/draft (separate scopes), immutable authenticated send approval, cloud schedules, then optional sandbox. Implement least privilege and individual acceptance gates; do not connect all tools at once.

## Alternatives deliberately rejected

1. Fork and deploy `thesysdev/open-intelligent-ui` as a *second app*: duplicates chat/auth/storage/provider logic and would regress our security and persisted conversations.
2. Make one free Groq model the permanent architecture: inference price is not a quality measurement, especially for OpenUI.
3. Make UI DSL the only answer format: simple responses become slow and fragile; failures should fall back to accessible text.
4. Merge OpenUI, json-render and a full A2UI runtime now: incompatible storage formats and multiple renderers increase maintenance without proving the product.
5. Put all user-facing features on hold while building a general model-marketplace/quota platform: not required for a single-owner product.

## Decision check

This ADR becomes **accepted** only after an actual prototype and the [experience benchmark](EXPERIENCE-BENCHMARK.md) validate the choice. It changes no code or credentials. Updating the roadmap does **not** approve a production release or any paid service.

## Primary references

- https://github.com/thesysdev/open-intelligent-ui
- https://github.com/thesysdev/openui
- https://www.openui.com/docs/build-agents/frameworks/vercel-ai-sdk
- https://www.openui.com/integrations/vercel-ai-sdk
- https://github.com/thesysdev/generative-ui-bench
- https://www.openui.com/benchmarks
- https://github.com/vercel-labs/json-render/tree/main/examples/chat
- https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/1
- https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/2
