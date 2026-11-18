# Conversation Engine v1 — First implementation slice

**Status:** Draft implementation, testing branch only. No new providers, spend, scopes, SDK upgrade, or production promotion.

## Included

- **No network model-catalogue call on every chat turn:** Requests use the authenticated, already-verified server-side `VERIFIED_GROQ_MODELS` allowlist. The existing model discovery API remains separate.
- **Select tool schemas for the owner's actual request:** Plain chat sends no tool schemas. Weather, fictional inbox, document tools, enabled schedule *reads*, and explicit personality edits are selectively offered. The long artifact prompt is omitted from ordinary questions. Heuristics are intentionally minimal and need real-world evaluation.
- **Compact model-facing tool outputs:** AI SDK 6 `toModelOutput` converts full weather arrays or synthetic inbox data into short typed summaries *for the model only*. The client receives and persists full tool-output parts for its visual card.
- **Budget each provider step:** Conservative estimated request guard; keep exact recent messages and at most an explicitly labelled excerpt of earlier conversation. Full chat/history remains in Neon. 7,000 token estimated budget for a plain response, 3,400 per step when a tool is enabled, with two steps at most, 768 reserved reply tokens. This reduces but **cannot guarantee avoidance** of all provider TPM bursts; true provider rate limits include recent concurrent activity.
- **No reasoning/tool internals as user-visible model stream:** `sendReasoning: false`; provider error messages are mapped to short bilingual strings.
- **Idempotent retry of an unanswered saved user turn:** Explicit `retry` request guard prevents inserting a second user row; don't refill composer on network/model errors. The UI offers Retry, including after reloading a saved unanswered turn.
- **Skip persisting assistant messages that contain no meaningful output.**
- **Remove inherited 10-per-hour per-owner message cap**, while retaining authentication, IP rate protection, and provider quotas.

## Deliberate limitations / follow-up

- **Not an LLM rolling semantic summary.** Older context is shortened into clearly flagged excerpts only when the estimated budget is exceeded. This preserves the full database but does not preserve all nuance in model context; semantic summaries need a separate privacy/quality gate.
- **A true exact tokenizer is not used.** `JSON.stringify()/2.5` is deliberately conservative for typical English/Turkish, plus room for tool and protocol costs; final token counts may vary. Report actual provider usage where permitted, and revise from measured runs. We cannot promise a hard universal 0% rate-limit failure.
- **Retries of partially saved assistant responses** require an additional server-side reconciliation rule. The initial idempotent path explicitly allows only the latest unanswered user turn, and refuses unsafe duplicate generations.
- AI SDK 6 retained; no API spend changes. PR #7 weather tool loading visual remains separate.
- No guarantee about real iPhone behaviour until tested on a protected preview. Automated tests use synthetic records.

## Real-owner acceptance checks

1. Open existing testing preview, ask an ordinary Turkish "Eraser diagramı nasıl gözükür?" and an English follow-up; both answer with no raw provider JSON and no 8k-token rejection from oversized history.
2. Ask weather for London, follow up; forecast card still displays the rich complete result and the model receives compact output.
3. Build a 30-turn synthetic chat in CI; inspect budget reports and ensure model context remains under budget without losing DB/UI history.
4. Simulate provider 413/429 and offline errors; retry an unanswered saved user message; verify one user turn, one meaningful assistant reply after refresh.
5. Confirm History, owner auth, allowed models and fictional inbox card remain functional.

This PR intentionally does not merge with the pending PR #7 or modify `main`.
