# Fictional inbox — first chat-to-visual vertical slice

**Status: experimental (not approved for production)**

This is the first small end-to-end prototype following [ADR-0001](../architecture/ADR-0001-unified-conversation-openui.md) and the [experience benchmark](../architecture/EXPERIENCE-BENCHMARK.md), currently proposed in draft PR #3. It does **not** select OpenUI or json-render yet.

## What this spike demonstrates

- A **read-only, opt-in `demoInbox` tool**, exposed to our two existing verified Groq text models, returns 12 deterministic, fake messages, all from `@example.test`.
- The tool result is returned as the existing AI SDK `tool-demoInbox` message part and rendered inside the **existing Next.js chatbot**, not a second demo application.
- An interactive chart, priority slider, filtered list and an **unsent sample draft** render directly in the chat. Slider and draft button change local UI state, **without a model request or server-side action**.
- The fake dataset is bundled with code. No Gmail scopes, Composio, external API, image search, HTML/JavaScript interpretation, OpenUI Gateway, payment, cron or new model provider is introduced.
- The tool result is stored in the existing saved message parts when the model calls it, so the card can be reopened after refresh.

## Try it on the protected experimental preview

In either **Everyday chat** or **Detailed chat**, ask:

`Bana 12 hayalî e-postadan oluşan etkileşimli gelen kutusu demosu göster. Grafik ve öncelik kaydırıcısı olsun. Gerçek Gmail hesabıma bağlanma.`

Or in English:

`Show me an interactive demo of a fictional 12-message inbox with a priority slider. Do not access my real mail.`

The model **should call `demoInbox`**; a plain-text response instead is a tool-calling benchmark failure, not proof that the renderer works.

## Acceptance evidence

- Node security tests validate synthetic dataset count, domains, ranking and non-mutation.
- Phone-sized Playwright fixture loads a persisted `tool-demoInbox` part, checks UI and Turkish labels, changes the priority from 3 to 5 (7 → 2 messages), reveals a clearly labelled unsent example draft, then refreshes the saved chat and confirms the card survives.
- Real-owner iPhone Safari testing must repeat the tool invocation and verify both model variants, plus history re-opening.
- Model correctness / tool-selection rate, latency and actual OpenUI program validity have **not been measured yet**. Do not describe them as passed.

## Deliberate limitations and next integration

The chart is a **trusted React component consuming typed tool data**, not model-generated OpenUI Lang. This is deliberate: it verifies **conversation → tool → structured response → interactive inline UI → history** before introducing a general generated presentation language.

In the **next PR**, replace or wrap this presentation boundary with a narrow `@openuidev/react-lang` renderer and compare it with json-render on identical synthetic fixtures. Never import the Open Intelligent UI demo's entire chat app or use its browser-local history. Model-generated programs must be parsed and validated; no arbitrary script, privileged actions or unchecked data access.

The priority slider currently resets to 3 after reload, although the card and fixture persist. Persisting per-message interaction state in the authenticated conversation record is a **separate acceptance gate**; it is not achieved in this spike. Do not mistake current local state for durable chat state.

The app must explain **Gmail is not connected yet**, not claim that Gmail integration is prohibited by platform security rules. OAuth-based read/draft integration may be added later with explicit consent, and sending will require separate approval.
