# Product Roadmap and Acceptance Gates

**Important:** Phases below are design intentions, not evidence of completed features. Before taking a new task, read `docs/CURRENT_STATE.md`, actual GitHub PRs and the existing test suite. Confirm the current phase with the owner; avoid implementing all phases in one task.

## Phase 0 — Secure foundation (ACTIVE: PR #1 in review)

- Owner-only Google OIDC login; no public registration/guest/password path.
- Freeze broad external integrations, background email send, remote shell, Telegram and cron until separately reviewed.
- Preserve database, private deployment, model selection, chat history, existing source and security tests.
- **Gate:** real owner Google login works on iPhone protected preview; conversation is saved and persists after reload; available model streams; unauthorised route access is denied; security tests pass. Review draft PR #1 before merge. No automatic production promotion.

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
