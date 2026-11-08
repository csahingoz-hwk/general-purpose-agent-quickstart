# Product Vision — Personal Bilingual AI Assistant

## One sentence

A private, cloud-hosted, voice-first personal assistant that speaks **English and Turkish naturally**, understands and operates the owner's personal digital life with consent, schedules useful tasks, and explains results with **ChatGPT-quality rich interactive visual responses**.

## Why it exists

The owner wants an assistant that is more capable and personal than another chatbot. They use an iPhone frequently, have a Mac mini M1 with 8 GB but **do not want to run local LLMs**, and already have satisfactory coding and corporate-work assistants. This project is strictly for **personal noncommercial use**, not for corporate financial data, company email, or replacing professional tools.

## What success feels like

- On iPhone, tap the home-screen icon, talk naturally: "Günaydın, önemli e-postalarımı özetle", then "Can you reply to the second one in English?" without changing modes or losing context.
- The assistant explains what it has found using **interactive, relevant** visuals: priority breakdown chart with a working threshold slider, sender/thread cards, bilingual summaries, and inline draft approval forms. Source data is traceable. User interactions that don't need a model call are instant.
- It drafts an email in the requested language, displays full recipients/subject/body/attachments, and asks for a **real authenticated approval**. Voice-only “yes” is not sufficient for sending. Once approved, sends that exact immutable draft, once, and reports outcome.
- Recurring personal tasks, such as an inbox briefing every weekday morning in `Europe/London`, run in the cloud when no device is on. Summaries are viewable when the owner opens the app. No automatic outbound emailing.
- Conversations and visual state persist across devices, and account permissions, activity history and costs are understandable.

## Essential capabilities

### 1 — Voice-first bilingual conversation

- Realtime low-latency English/Turkish speech with seamless code-switching; high-quality pronunciation of Turkish names, English terminology, dates and numbers; interruption / barge-in; contextual follow-ups.
- Shared transcript and history for text/voice; voice session controls, microphone privacy, accessible fallback, reconnect and iPhone Safari/PWA testing.
- Streaming realtime calls should use short-lived client credentials minted securely by the server. Record only necessary transcripts; consent and retention settings.

### 2 — Gmail with secure approval

- Personal Gmail search, read, summarize, thread retrieval and intelligent drafting. Separate Google identity login from Gmail API authorization.
- Email sends only through server-side approval flow with recipient verification, immutable content fingerprint, expiry, versioning, audit and replay/duplicate protection; reconcile uncertain provider outcomes.
- Prompt injection resistance, least scopes, revocable OAuth and sensitive-data minimisation; no Gmail tokens in sandbox or browser.

### 3 — Cloud scheduled tasks

- Create/list/pause/change/delete schedules conversationally and via UI; recurrence in Europe/London with DST; history and status; cloud execution independent of iPhone/Mac.
- Secure trigger, bounded tools, maximum execution budget, idempotency and useful notifications/summaries. Task execution cannot bypass email approvals.

### 4 — Rich, intelligent visual answers

- AI can select from a **safe catalogue** of React components including charts, tables, sliders, forms, approval cards, timelines, images, links and useful mini-app interactions.
- Data grounding and citations/provenance, responsive mobile design, accessibility and meaningful default presentation. Interactive state should persist across reloads and devices where appropriate.
- Prefer reuse of Open Intelligent UI, `json-render`, shadcn/UI components rather than creating yet another renderer. Verify exact library/API versions before integration. Use server-issued action identifiers with backend validation for real-world operations.

## Technology intentions, not dogma

- Application: current Vercel Chatbot / Composio quickstart fork (Next.js, React, AI SDK, Auth.js).
- Cloud: Vercel, Neon PostgreSQL and AI Gateway; additional services only with evidence they save significant effort.
- Voice: realtime voice provider tested for Turkish/English quality and price; cheap push-to-talk fallback when needed.
- Integrations: Google Gmail API or a narrowly authorised integration provider; eliminate unconstrained meta-tools.
- Scheduling: current Vercel native schedules or cron/workflow approach after checking current availability and limits.
- Optional cloud sandbox via Vercel Sandbox for approved Python/Node/file tasks only; not assumed always-on; approved GitHub/Mac bridge may come later.

## Hard boundaries

- Personal-only, no corporate email/data. Never send an email, delete data, purchase services, execute powerful code, or make production releases without the relevant explicit approval.
- Cost-aware: target a lightweight hobby deployment; **$15/month was an illustrative AI usage planning target, not guaranteed pricing**. Surface actual prices/usage, limits and controls. Realtime voice is likely the main variable expense.
- Keep code and infrastructure understandable, maintainable and easy to update from upstream. Respect the noncommercial licence if using GAIA code; preferably borrow only ideas where useful.
- We care more about usefulness, intelligence, trust and polished UX than copying the exact ChatGPT/Grokbot brand or making unnecessary feature clones.

## Out of scope until later

- Autonomous repository maintenance; replacing Happy/Codex; unrestricted command execution on Mac mini; a persistent full GUI cloud desktop; native iOS App Store release; work inbox; public multi-tenant SaaS.
