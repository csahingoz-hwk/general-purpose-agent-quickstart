# Product Roadmap and Acceptance Gates

**Important:** Phases below are design intentions, not evidence of completed features. Before taking a new task, read `docs/CURRENT_STATE.md`, actual GitHub PRs and the existing test suite. Confirm the current phase with the owner; avoid implementing all phases in one task.

## Cross-phase architecture contract — before any new feature work

**Proposed ADR:** [One conversation, model-aware Intelligent UI and voice](architecture/ADR-0001-unified-conversation-openui.md)  
**Evaluation plan:** [Experience benchmark](architecture/EXPERIENCE-BENCHMARK.md)

These stages are *implementation slices*, **not independent feature choices**. The model must be tested together with interactive UI generation, bilingual responses, streaming/persistence, tools and the future voice transport. Our shared invariants:

- **One signed-in user, one authenticated chat, one Neon-backed message history and one tool-permission boundary.** An OpenUI demo/fork cannot replace existing chat storage or bypass Auth.js.
- **Simple questions remain text-first.** Visual answers use grounded, validated, versioned structured message parts with a small trusted React catalogue, safe state changes and a readable text fallback.
- **OpenUI Lang is the first proposed visual protocol**, *not accepted yet*; compare it with current json-render using the same fictional fixture and our existing approved Groq 20B/120B models. Published benchmarks do not measure our exact models or experience.
- **Voice is another transport to the same conversation**, not a separate agent with an independent memory. Speech uses concise summaries when rich on-screen UI is present.
- **Quality-first, cost-controlled:** model access works before normal chat; do not choose model/provider solely for free quota. Approved premium comparator requires separate owner opt-in and an explicit spending cap. No paid fallback by default.
- **Meaningful progress is end-to-end:** every phase retains login, text reply, persistence, local UI interaction and safety. Features pass only when tested *together* in the authenticated iPhone experience.
- **Trust boundaries stay server-side:** Gmail send, scheduling and any real-world side effect require specific approvals, never a generated widget/tool instruction.

**Immediate sequencing:** complete Phase 0 live bilingual-chat/persistence checks → benchmark and implement a narrow fictional inbox visual response in existing chat → bring tested English/Turkish voice into the same history → connect Gmail read/draft and separately-approved actions → scheduled jobs. Prototype interfaces/contracts across stages now, without prematurely activating real services.

---

## Phase 0 — Secure foundation (ACTIVE: PR #1 in review)

- Owner-only Google OIDC login; no public registration/guest/password path.
- Freeze broad external integrations, background email send, remote shell, Telegram and cron until separately reviewed.
- Preserve database, private deployment, model selection, chat history, existing source and security tests.
- Model readiness is a Phase 0 acceptance requirement: normal chat offers one
  verified default and only genuinely usable options, preferably through a
  confirmed free-tier account. Fix the current static "Available" catalogue and
  runtime activation popup before treating chat as ready. Account/key setup
  happens separately; no automatic paid fallback. See [MODEL_ACCESS.md](MODEL_ACCESS.md).
- **Gate:** model access is ready without a chat-time billing prompt; real owner Google login works on iPhone protected preview; conversation is saved and persists after reload; available model streams; unauthorised route access is denied; security tests pass. Review draft PR #1 before merge. No automatic production promotion.

## Phase 1 — First genuine rich interactive answer

- Evaluate Open Intelligent UI official adapter vs `json-render` with **current** AI SDK 6 dependency, and select lower-risk path rather than blindly upgrading to SDK 7.
- One working vertical slice: e.g., fictional inbox priority report with interactive chart, slider, cards and durable message/spec state. Explicitly label demo data; use deterministic/test data before Gmail connection.
- Ensure streamed message and UI specs survive reload on iPhone; accessible interaction; no arbitrary JS execution. UI actions should never directly call privileged services.
- **Gate:** one streamed, interactive visual response loads, updates instantly on user control, persists across reload, works in iPhone Safari and passes tests.

## Phase 2 — Realtime English/Turkish voice

- Implement secure live session credentials and React voice UI; test voice providers against the same English/Turkish benchmark.
- Natural switching, interruption, high quality Turkish, shared transcript, reconnect and microphone lifecycle; fallback to cheaper push-to-talk/text.
- **Gate:** real test on iPhone Safari/PWA with English, Turkish, code-switching and barge-in, and a measured per-minute cost estimate.

## Phase 3 — Personal Gmail reading and drafts

- Separate OAuth integration (`gmail.readonly`) from Google OIDC identity; revocable, encrypted, minimal scopes and no raw mail logging.
- Query emails/threads, summarise, generate **unsent** English or Turkish drafts. Add UI approval cards backed by real server-side records; no send tool available yet.
- **Gate:** authorised real inbox read test, correct source/thread mapping, an unprivileged/foreign account cannot read it, drafts remain unsent and approval cannot be faked by the model/UI.

## Phase 4 — Approved Gmail sending

- Add `gmail.send` incrementally only after owner acceptance of read/draft flow. Freeze exact sending account, To/CC/BCC, subject, reply context, body and attachments with a version fingerprint.
- Server validates authenticated approval, expiry, digest, audience and one-time state transition. Unknown Gmail outcome is reconciled, not blindly retried.
- **Gate:** one actual user-controlled test email sends **only** when reviewed and approved. Editing, replay, collision, timeout and prompt-injected inbound email tests pass. Voice-only approval cannot send.

## Phase 5 — Cloud recurring tasks

- Implement least-privilege background jobs using the simplest verified scheduling system; keep Europe/London, DST, run history, cost caps and idempotency.
- Example: weekday inbox summary and suggested drafts for approval. No unattended sending, no long-running unbounded tool calls.
- **Gate:** job runs with browser closed, deduplicates retries, survives timezone changes, can be paused/deleted, and costs are observable.

## Phase 6 — Optional personal cloud sandbox and developer tools

- Cloud sandbox executes approved Python/Node, parses files, produces chart inputs; no direct credentials, strict quotas and retention policy. Persist results outside ephemeral sessions where needed.
- GitHub read/status and whitelisted CI triggers only if they add value beyond existing coding harness. Mac mini bridge only if desired and separately secured.
- **Gate:** resource isolation, network/secret boundaries, provenance, explicit approval and cleanup are tested.

## Collaboration rhythm

- Codex implements focused PRs, reports tests, refreshes `docs/CURRENT_STATE.md` and updates architectural decisions in docs.
- ChatGPT conversation is the product/design review space: clarify priorities, critique experiences, research current options, review PR links and propose next task.
- At each handoff, send the latest PR URL and relevant `docs/CURRENT_STATE.md` excerpt to ChatGPT, then use the same docs as Codex's memory for subsequent tasks.
