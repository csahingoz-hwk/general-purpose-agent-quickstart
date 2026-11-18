# Four Claude Code UI/UX build sessions

Prepared 10 November 2026 for `csahingoz-hwk/general-purpose-agent-quickstart`.
Reference audit: [DESIGN.md](DESIGN.md). Runtime inspected: PR #10, `a20d534`.

Use your selected **Fable 5.2, medium effort** for each build session. These are
scope/time budgets, not a measured guarantee for that model, CI queues or Vercel.
Choose the corresponding model in your host; do not silently substitute a model
or change application inference models. Research/review agents, if used, must be
GPT-6.1 Terra. This brief does not need more research agents to start building.

## What you will have after each session

| Session | User-visible finish | User review, about 3 minutes |
| --- | --- | --- |
| 1. Personal shell | Calm personal assistant header, readable tokens, useful start screen and reliable navigation | New chat → History → previous chat; Settings/usage replaces chat rather than appearing below it |
| 2. Effortless conversation | Compact phone composer, accessible controls and clear work/recovery states | Type Turkish → receive English follow-up fixture; stop/retry; draft during streaming |
| 3. Useful results | Consistent weather/inbox cards, retained artifact viewer and a small current-chat Results list | Open inbox → change slider → inspect result → return to same chat; no model call on local controls |
| 4. Finished UI foundation | Clear Settings/usage, targeted EN/TR interface copy, theme and accessibility pass | Switch Turkish/dark mode, inspect spend/status, reopen chat/results; check phone keyboard/zoom |

**Build rhythm:** 0–3 minutes inspect; 3–18 implement the narrow slice; 18–25
targeted validation; 25–30 screenshots, review steps, commit and handoff.
The owner's three-minute review comes AFTER that build session, not inside it. Run
existing broader CI in parallel once a commit is pushed; queued CI time is not
promised inside the coding budget. Never label a stage accepted while required
checks are failing. If time is exceeded, finish the smallest working slice and
report remaining items; do not rush security or fake completion.

## Before Session 1

- Read the repository instructions/project docs and DESIGN.md; inspect current
  PR heads. PR #9 and #10 stay draft/unmerged. Main/production stay untouched.
- PR #10 at the inspected head passed GitHub run 42527759940: 45 regressions,
  existing UI suite, both provider/PG integration suites and spending tests.
  Recheck the latest head instead of assuming that historical result still holds.
- Use one UI feature branch based on the latest reviewed PR #10 head, for example
  `feature/personal-assistant-ui`. Do not commit UI work directly to main or the
  provider implementation branch. Reuse an existing UI branch if already present.
- Confirm a working cloud review path with synthetic data. The Vercel
  `Resource provisioning failed` problem and isolated database setup are still
  open. Do not silently work around them by writing to the shared Neon database.
  A local-in-cloud fixture plus screenshots is useful for early visual review,
  but it is not a working protected preview or real iPhone acceptance.
- Use existing Playwright fixtures; never ship an auth bypass, a fake production
  owner, a public fixture endpoint or test provider into the application runtime.
- Do not turn these sessions into voice, Gmail, scheduler, database, provider or
  infrastructure implementations. No paid calls are needed for UI acceptance.

## Master brief — paste once with the selected session

```text
Work in csahingoz-hwk/general-purpose-agent-quickstart, in the existing application.
Read AGENTS/project docs, current PRs, DESIGN.md and FOUR_SESSION_BUILD.md first.
Use the selected Fable 5.2 medium-effort build session. Any research/review agent
must be GPT-6.1 Terra. Complete ONLY the selected numbered session.

Goal: Grok Bot inspired calm messenger UX for ONE private English/Turkish
personal assistant. Reuse existing Next/React, Tailwind semantic tokens,
shadcn-style primitives, ActiveChatProvider, AI SDK 7 UIMessage parts and fixtures.
Do not replace the chat backend/state engine or add a second app. No dependency
or framework upgrade, provider/model change, new schema or paid service.

Keep Auth.js owner-only access, Neon history, message IDs, model selection,
spending reservations, compact model outputs/full UI data, Send/Stop protection,
same-turn Retry and interrupted-tool no-replay intact. Never auto-resubmit an
interrupted tool. Do not enable billing, OpenAI/Gateway inference, Gmail scopes,
email sending, schedules, shell execution or remote control.

Use a UI branch based on the latest reviewed PR10 head. Preserve concurrent work.
No main changes, merges, production deployment/settings or shared-database writes.
No UI feature may claim a disconnected backend is ready. No arbitrary generated
JS/HTML renderer. Plain readable fallback stays available.

Keep scope small: approximately 20–30 minutes, then stop for review. Reuse
components before extracting a small shared component; avoid speculative plugin
systems/event buses. Keep test IDs and behavior contracts unless a deliberate UX
change requires updating a test without weakening its assertion.

Verify TypeScript, Biome and relevant synthetic browser/security cases. Trigger
the existing full CI on push and report its actual status. Report changed files,
screenshots at 390px and 1440px, working cloud preview if available, a 3-step user
test, actual check results and known limitations. Update docs/CURRENT_STATE.md
with what is IMPLEMENTED versus MOCKED versus PENDING. Commit the stage and keep
its PR draft. Do not start the next stage until the owner reviews this one.
```

## Session 1 — Personal shell and visual foundation

**Finish:** the existing assistant feels like a personal product immediately.
Everything in this session is presentation/navigation, not new agent capability.

Paste after the master brief:

```text
Implement Session 1 only: personal shell and visual foundation.

1. Keep the existing semantic CSS token names and Geist. Tune neutral surfaces,
   readable foreground/muted text, 4px spacing rhythm, restrained borders/shadows.
   Apply identical semantic roles in light/dark; don't introduce a parallel theme.
2. Replace template/vendor/Deploy navigation with Assistant, current conversation
   title where available, History and a simple private-status indicator. Remove
   public-sharing choices from normal navigation; do not alter backend ownership.
3. Keep New chat and History prominent. Move the existing Delete all control into
   an account-menu danger area, preserving its confirmation. Do not execute it.
4. Replace coding-demo greeting/suggestions with supported personal uses:
   'Help me plan my day', 'Explain this clearly', 'Check the weather',
   'Explore a fictional inbox'. Do not suggest reading real Gmail yet.
5. Correct the route composition: one content slot renders ChatShell on chat
   routes and child content on usage/settings routes. Do not mount two chat
   providers or put Settings below a full-height chat. Keep the chat subtree
   stable across / to /chat/id and chat-ID navigation; do not key/remount the
   provider for each URL change. Reuse current providers.
6. Give new shared UI copy a small typed EN/TR-ready home; keep this stage's
   strings minimal. Preserve responsive History fixes and existing test hooks.

Suggested files: app/globals.css, components/chat/chat-header.tsx, app-sidebar.tsx,
greeting.tsx, lib/constants.ts, app/(chat)/layout.tsx and one small route slot if
needed. No unrelated admin/backend work.

Acceptance: at 390x844 and 1440x1000, no vendor deployment CTA or page overflow;
New chat and previous History work; /usage replaces the transcript surface;
private access unchanged; light/dark readable. Capture both viewports.
Stop for review. Defer full History search/pins/global result search.
```

**Owner test:** open new chat, reopen a saved conversation, open usage then return.
**Scope cut if needed:** do not build a new dashboard, bot roster or global search.

## Session 2 — Composer, conversation and recovery

**Finish:** comfortable text conversation on iPhone, without exposing provider
machinery or regressing the safeguards just fixed in SDK 7.

```text
Implement Session 2 only on the accepted Session 1 branch.

1. Make the composer compact at rest and expand only with content, up to roughly
   six lines before internal scroll. Use 16px editable text and readable hints.
   Add safe-area bottom padding. Preserve IME/composition and multiline behavior.
2. Give Send/Stop and touch message actions >=44px hit areas. Keep Stop throughout
   submitted/streaming. A draft typed while streaming stays a draft; it must not
   invoke Stop, silently disappear or auto-send. Do not change server retry policy.
3. Offer Copy/Edit through touch-visible controls or a More menu; keyboard focus
   must expose them too. Keep actions calm rather than a permanent toolbar wall.
4. Keep model selection simple: Everyday and Detailed in a compact menu, with
   concise explanation on opening. Account setup/billing is not a chat popup.
5. Use existing state to show brief, accurate pending/working/interrupted/error
   feedback. Preserve partial content; use the existing safe Retry for one turn.
   An interrupted tool shows a follow-up explanation, not an automatic replay.
6. Preserve the existing draft and submission semantics. Input blocked BEFORE
   acceptance stays editable; after a failed generation the accepted user turn
   stays saved and Retry reuses it, rather than copying it back and duplicating it.
   Keep a new unsent draft while streaming. Do not migrate the global draft store
   or add per-chat persistence in this timebox; that needs its own state tests.
7. Keep transcript scrolling stable: follow new text only when already at bottom;
   expose Jump to latest when the user is reading earlier messages. Reuse the hook.

Suggested files: multimodal-input.tsx, message-actions.tsx, messages.tsx,
the existing scrolling hook and shared UI copy. Avoid changing use-active-chat
transport/state logic unless required to preserve an existing behavior.

Acceptance: deterministic synthetic Turkish→English follow-up; delayed stream
shows Stop, not Send; stop/partial Retry creates no duplicate user/assistant;
interrupted tool is not replayed; an unsent draft is not lost while streaming;
touch and keyboard Copy/Edit work. Do not add voice integration or a pretend live microphone button.
Stop for review; retain existing bilingual/provider/security regression tests.
```

**Owner test:** type a Turkish request, type a new draft while it is replying,
stop/recover the reply and confirm there is only one saved user turn.
**Scope cut:** no new backend status event bus, voice recorder or model router.

## Session 3 — Rich results and a revisitable workspace

**Finish:** weather, fictional inbox and existing artifacts look like one system,
with a useful Results entry point rather than more chat clutter. Retain existing
approval/error handlers; this is not a message-rendering rewrite.

```text
Implement Session 3 only on accepted Sessions 1–2.

1. Create one small ResultFrame: title, meaningful status, source/demo label,
   concise summary, content and optional Open details action. Reuse existing
   weather, FictionalInboxCard and artifact viewers; do not rebuild their data.
2. Keep existing message.tsx weather approval/error states, inbox, documents and
   generic tool handlers intact. Add only a small typed selector for successful
   saved weather/inbox/document results. Preserve exact stored parts/datasets.
   Unknown/malformed results retain their existing bounded readable fallback.
   Never eval model strings or render raw HTML; no broad renderer registry rewrite.
3. Make primary totals/chart/summary legible before optional rows/details. Keep
   the inbox explicitly fictional. Its slider filters the same immutable data
   and makes ZERO model/network calls. Do not fabricate chart values.
4. Add 'Results in this conversation': derive available results from the loaded
   saved message parts. Reopening a result uses that data/viewer, without inference.
   Use a small existing Sheet/menu primitive, not a new Library route or a new
   panel system. A clear close/back action restores focus. Preserve existing artifact
   full-screen mobile behavior; don't replace it with a narrow desktop pane.
5. Give cards one shared empty/loading/error pattern. View-only controls are not
   authorizations. Reuse the unsent sample draft; no real Send/Approve action.
6. Keep filter state local/transient in this timebox and label/document its scope.
   Full datasets/results persist in Neon; filter selections need not sync or save.
   Leave a small view-state seam for later persistence, not a new state framework.

Suggested files: message.tsx, fictional-inbox-card.tsx, weather.tsx, existing
artifact viewer and small ResultFrame/result-selector/Results-list components.
Only wrap successful outputs; keep denial and approval behavior unchanged.

Acceptance: weather and inbox render, totals match fixture; slider changes count
without a model call after the existing tool generation finishes; Open details
and close return to the same chat; reload restores the result; malformed/unknown
output remains readable; no email action or arbitrary code is executed.
Stop for review. This is current-chat Results, not cross-conversation file search.
```

**Owner test:** change the inbox slider, open a saved result, close it, reload and
reopen the same result. Filter reset is an explicit limitation of this slice.
**Scope cut:** no new OpenUI/json-render package, generated dashboards protocol,
cross-device filter persistence, broad renderer refactor, global Library backend
or file-upload expansion.

## Session 4 — Trust, bilingual settings and final acceptance

**Finish:** the implemented UI is coherent, honest and extensible, with settings
separated from everyday conversation and the remaining backend work explicit.

```text
Implement Session 4 only on accepted Sessions 1–3.

1. Finish a compact Settings area using existing owner-protected data. Appearance,
   interface language, model availability and usage belong here. Show month-to-date
   estimated spend/allowance first; put per-model token records under Details.
   Keep the distinction between app estimates and provider billing limits clear.
2. Show real capability status: Gmail not connected, voice not connected and
   unattended schedules disabled unless genuinely implemented/accepted elsewhere.
   Do not add dead Connect buttons, pretend scheduled tasks or OAuth permissions.
3. Complete a bounded typed EN/TR dictionary for the newly touched assistant
   navigation/composer/result/settings labels, empty states and accessible names.
   Keep existing bilingual model-error messages. Do not promise translation of
   legacy admin/editor screens or every vendor component in 30 minutes.
   Use Intl for visible dates
   and numbers. UI language is independent of requested reply language; don't
   translate saved messages or call a model to translate navigation.
4. Verify Turkish glyphs, long labels, light/dark, keyboard focus/escape/return,
   200% zoom and reduced motion. Remove the restrictive maximumScale setting.
   Keep 44px touch targets and safe-area/keyboard layout. Do not claim real Safari
   acceptance from Chromium emulation; provide exact iPhone steps for the owner.
5. Run the full existing checks plus the focused UI cases added by these stages.
   Use synthetic fixtures only; keep owner/no-key/rate/billing/cancel/Retry/tool
   safety assertions. No production database write or real inference test.
6. Update CURRENT_STATE with completed UI, fixture evidence, backend gaps and the
   next narrow milestone. Keep a draft PR with before/after screenshots, exact
   tests and user acceptance checklist. No merge or production promotion.

Acceptance: EN/TR toggle and theme work; Settings/usage navigation is separate;
spend/status is understandable; mobile content stays usable with keyboard and
zoom; existing History, both model selections, weather/inbox/artifact and recovery
tests still pass. End with the real remaining deployment/database requirements.
```

**Owner test:** switch Turkish and dark mode, inspect usage/connection status,
reopen a saved chat/result, type with iPhone keyboard and pinch-zoom.
**Scope cut:** no service worker/offline queue, push notification implementation,
new authentication, native app, voice/Gmail/scheduler backend or paid activation.

## Final acceptance checklist

- [ ] Existing Google owner-only architecture preserved; no public guest/signup.
- [ ] No changes to main, production, billing, paid APIs or shared database.
- [ ] UI branch/PR clearly based on reviewed PR10; PR9/PR10 remain draft/unmerged.
- [ ] Personal header and clear navigation; usage/settings do not sit below chat.
- [ ] Compact, legible 16px composer; >=44px controls; no hover-only essential action.
- [ ] Streaming, stop, partial Retry and tool no-replay behavior unchanged/tested.
- [ ] Streaming/blocked-input draft retained and no duplicate accepted messages.
- [ ] Per-chat draft-store migration explicitly deferred; existing behavior documented.
- [ ] Accurate weather/inbox cards and local-only slider interaction.
- [ ] Results reopen from persisted parts; unknown output fails readably/safely.
- [ ] EN/TR for touched assistant chrome, dark/light, focus, reduced motion and zoom checked.
- [ ] Legacy untranslated areas and per-chat draft gaps explicitly listed.
- [ ] Synthetic Chromium results clearly distinguished from real iPhone/cloud tests.
- [ ] Complete UI for today's capabilities, with future integrations accurately gated.

After these sessions, the next implementation is whichever accepted backend
unblocks the most value: resolve preview/database isolation and bounded model
acceptance first, then a narrow safe renderer, realtime EN/TR voice, Gmail read/draft
and authenticated send approval, then schedules. Do not schedule all of them into
another 30-minute UI session or let a generated card authorize a real action.


## GPT-6.1 Terra review applied

An independent Terra review required three important cuts to protect the
20–30-minute sessions: defer per-chat draft-store migration; preserve the existing
message/tool/approval handlers instead of replacing them with a universal registry;
and bound translation to the touched assistant interface. It also prioritized
route composition before visual polish and keeping the chat provider stable
across chat URL changes. These cuts are reflected above. Real user testing,
external CI queues and deployment recovery are not hidden inside coding estimates.
