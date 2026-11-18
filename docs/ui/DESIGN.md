# Personal assistant UI — Grok Bot reference audit

Research date: 10 November 2026. Target repository:
`csahingoz-hwk/general-purpose-agent-quickstart`, current inspected head `a20d534`.
This is a design/build brief, not an implementation or deployment claim.

## Evidence and limits

Used Firecrawl to search for the official Grok Bot, capture its public product
demo at desktop 1440px and mobile 390px, extract branding/HTML, and read these guides:

- [Official product and embedded demo](https://x.ai/bot)
- [Overview](https://docs.x.ai/grok-bot/overview)
- [Messages, composer, voice and draft review](https://docs.x.ai/grok-bot/chat-and-collaboration)
- [Results, pages and Library](https://docs.x.ai/grok-bot/files-and-results)
- [Mobile navigation, drafts and settings](https://docs.x.ai/grok-bot/mobile)
- [Approvals and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)

Inspected the screenshot pixels, not only extracted text. These are PUBLIC DEMOS
and documentation, not a logged-in inspection of the native application. The
mobile marketing demo is not proof of native iPhone layout or Safari behavior.
Animations, private states and native gestures were not tested. Reference assets
are evidence only: do not copy proprietary icons, fonts, branding or screenshots
into the product.

Current app captures used its built UI, Chromium, dummy owner identity and
intercepted synthetic models/history/inbox responses. No real OAuth login, Neon
data, inference or credits were used. These captures establish visual baseline,
not production usability or Safari acceptance. The two heights were 390×844 and
1440×1000.

Screenshots:

- [Reference desktop demo](grokbot-desktop-viewport.png)
- [Reference full page](grokbot-desktop.png)
- [Reference mobile web page](grokbot-mobile-reference.png)
- [Current phone empty chat](current-mobile-empty.png)
- [Current phone inbox result](current-mobile-inbox.png)
- [Current desktop empty chat](current-desktop-empty.png)
- [Current desktop inbox result](current-desktop-inbox.png)

## What makes the reference work

| Pattern | Observed evidence | Adaptation for this assistant |
| --- | --- | --- |
| Messenger navigation | Searchable list, selected row, name, time and short work status in the public demo | One personal assistant with conversation history; no multi-agent roster |
| Quiet hierarchy | Mostly neutral surfaces, thin dividers, restrained shadows, color concentrated in identity/status | A calm reading surface; one clear action per area |
| Compact composer | Bottom-anchored input with attachment and voice entry points | Small expanding text composer; voice control appears only when genuinely available |
| Work inside the conversation | Messages contain questions, tool activity, results and approval cards | Collapsible factual tool status plus complete trusted React cards |
| Results are revisitable | Files/results guide describes cards, Library and desktop page/chat split | Existing artifacts plus a current-conversation Results sheet, using saved message parts |
| Mobile continuity | Mobile guide documents shared conversations, per-chat drafts and result access | Preserve chat identity/history and recovery; defer draft-store migration |
| Explicit review | Guides show draft content and approval scope | Keep our stronger authenticated exact-content approval rule; no Always Allow bypass |

The documentation says page filters change the view without saving the page.
Therefore, persistent filter selections are our optional presentation choice,
not a behavior we claim to have copied or verified from Grok Bot.

## Current app audit

| Finding | Evidence | Priority / session |
| --- | --- | --- |
| Header advertises infrastructure instead of the assistant | `chat-header.tsx`, both baseline screenshots: vendor logos, desktop Deploy CTA | P0 / 1 |
| Dangerous control is a primary navigation item | `app-sidebar.tsx`: Delete all adjacent to New chat | P0 / 1: relocate behind existing confirmation in account menu |
| Empty screen describes a coding demo | `greeting.tsx`, `lib/constants.ts`: Next.js, algorithms and Silicon Valley suggestions | P0 / 1: personal, capability-accurate prompts |
| Composer is tall and faint | `multimodal-input.tsx`: min-h-24, 13px input, low-opacity placeholder; screenshot | P0 / 2 |
| Important hit targets are about 28px | Send/Stop h-7 and message actions size-7 | P0 / 2: minimum 44px interactive hit areas |
| Copy/edit actions depend on hover | `message-actions.tsx`: opacity-0/group-hover | P0 / 2: visible or explicit More menu on touch/focus |
| Secondary route competes with chat | `(chat)/layout.tsx` renders full-height ChatShell before children; `/usage` is a child page | P0 / 1: one route-aware content slot; verify with browser |
| Results have separate presentation patterns | Tool conditionals in `message.tsx`, existing weather/inbox/artifact components | P1 / 3: shared ResultFrame around successful outputs; retain handlers |
| UI state is easy to confuse with saved data | Inbox filter uses local React state; reload resets it | P1 / 3: explicit transient view state; never approval state |
| Phone accessibility needs attention | Root viewport maximumScale=1, small input/actions; no explicit safe-area rule found in composer | P0 / 4: zoom, safe areas and actual Safari review |
| Usage screen exposes developer detail first | `/usage/page.tsx`: model/token/cached-write table | P1 / 4: spend summary first, detailed records collapsed |

Existing strengths to retain: owner-only auth, UIMessage transcript and Neon
history, direct provider boundaries, verified model selection, Send/Stop guards,
explicit safe Retry, interrupted-tool protection, weather/inbox cards, artifact
viewer, light/dark themes, typed UI data and synthetic test harnesses.

## Visual specification

Extracted from reference: branding output reports marketing text `#0A0A0A`,
background `#FFFFFF`, secondary button `#EDECEA`, xVf font and pill buttons.
Marketing h1=60px/body=18px are NOT app text specifications. Reference demo HTML
sets sidebar width to 280px and row titles/previews to 14px/12px. Its avatars use
multiple accent colors. The marketing link accent `#0093A3` is not proof that the
application uses that color globally.

Proposed implementation choices, not extracted reference CSS:

| Role | Target |
| --- | --- |
| Font | Existing Geist; retain mono only for code/technical details; Turkish glyph coverage |
| Reading text / input | 16px, approximately 1.55–1.65 line height |
| Secondary copy | 13–14px, normal-text contrast ≥4.5:1 |
| Color | Existing semantic light/dark tokens, neutral base; restrained teal/blue for links and status |
| Spacing | 4px scale: 4, 8, 12, 16, 24, 32 |
| Shape | 12px cards, about 20px composer, pills for small status labels |
| Main transcript | About 760px maximum readable width; rich results may use available width |
| Sidebar | About 280px desktop; reuse bounded mobile History sheet |
| Composer | One-line resting text area, grows to roughly six lines, then scrolls |
| Interaction | At least 44×44px touch targets; visible keyboard focus |
| Animation | Prefer opacity/short transitions ≤180ms; respect reduced motion |
| Phone | 100dvh layout with safe-area insets; one main scroll region; no horizontal page overflow |

Do not reduce opacity until important text becomes hard to read. Do not apply a
global accessibility-breaking focus/zoom reset. Layout/labels must accommodate
longer Turkish strings and 200% zoom.

## Small architecture that can grow

```text
Existing owner session + API + Neon conversation
    └── App shell / one content slot
         ├── Chat: existing ActiveChatProvider → transcript + composer
         │    └── known UIMessage tool parts → existing trusted renderer + ResultFrame
         │                                       └── Results sheet, same data
         └── Settings / usage: existing read-only endpoints

Shared: semantic CSS tokens, typed EN/TR copy, capability-derived availability,
        accessible existing Button/Sheet/Dialog primitives, synthetic fixtures.
```

No second chat state engine, new backend, global component framework, UI builder,
new database table or generic event bus. No new packages are required for this
four-session slice. The existing UIMessage parts stay authoritative. A later
allowlisted OpenUI/json-render adapter can add a validated safe result type;
these sessions do not implement its generated protocol or arbitrary JavaScript.

Future voice uses the same composer/chat identity and transcript. Future Gmail
uses server-issued versioned action identifiers and exact-content approval.
Future tasks use real server statuses and authenticated schedule records. Merely
drawing those controls is not activation or proof of those capabilities.

## Definition of the four-session finish

A coherent, responsive and accessible interface for CURRENT working capabilities,
with accurate connection/status explanations and a clear place for future ones.
Not a complete voice/Gmail/scheduling product. No fake connected indicators,
invented scheduled work, inert primary CTAs or enabled send buttons without a
real approved backend. Reuse actual result data and deterministic synthetic
fixtures for review. Deployment/isolated database acceptance remains a separate
open infrastructure task; it is not solved by this UI plan.
