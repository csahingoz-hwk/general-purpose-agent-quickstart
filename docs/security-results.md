# Security milestone handoff

> Current-state note (8 November 2026): this report retains the chronology of
> earlier security work. Google identity settings were subsequently configured and
> the client ID corrected; the latest matching security preview is READY. Real
> owner sign-in and conversation persistence still need acceptance. Read
> [CURRENT_STATE.md](CURRENT_STATE.md) for current evidence and remaining gates.

Branch: `security/owner-only-hardening`.

## Results

- TypeScript (`tsc --noEmit`): PASS.
- Lint (`biome check`, the configured Ultracite engine/presets): PASS, 159 files.
- Production build (`pnpm build`, pnpm 10.32.1): PASS on Next.js 16.4.5.
  Migration step explicitly skipped because this workspace has no POSTGRES_URL.
- Security regression tests: PASS, five cases covering owner/guest/cron policy and verified Google identity.
- Built-app HTTP smoke checks: PASS, 15 assertions covering login/registration,
  unauthorized chat/history/models/documents/uploads/messages/demo requests,
  disabled guests/Telegram, cron secret checks, and provider configuration.
- Production dependency audit: PASS, zero vulnerabilities.
- Full dependency audit: zero critical/high/moderate; one low development-only
  finding in deepmerge through Ultracite, GHSA-gcqx-w48m-w2h4, no patched release
  reported. This remaining advisory needs review.
- External integration / remote execution import scan and `git diff --check`: PASS.

## Protected preview verification (2026-11-08)

- GitHub Vercel check for commit `2d3a6a4`: success.
- Vercel deployment `dpl_441Wn1vYFVJzeQKcDXFFWWmVyfnE`: READY, matching
  `security/owner-only-hardening` and the expected commit.
- Deployment Protection: enabled (`all_except_custom_domains`); unchanged.
- Through the authenticated Vercel fetch tool: `/login` returned 200 and
  `/api/auth/guest` returned application-generated 403.
- Expected 401 requests to history and cron were classified as protection errors
  by that tool, so those deployed application responses remain unverified.
- The owner supplied the allowed email. `APP_OWNER_EMAIL` is now configured only
  for the security branch preview; it is not hardcoded in source. Google OAuth
  client settings are still required. No secret values were decrypted.
- Owner sign-in and Neon conversation persistence remain a gate before later
  milestones. Interactive UI, voice, Gmail and scheduling work has not started.
- `.github/workflows/security.yml` now runs the security milestone checks on the
  PR without deployment credentials. Actions are pinned to immutable commit SHAs.
- The lint script now invokes the pinned local Biome binary directly. The old
  Ultracite wrapper downloaded a newer Biome version that rejected the existing
  configuration; presets and lint rules remain unchanged.

## Google sign-in update

The owner requested Google/Apple/passkey login instead of a separate password.
The security PR now uses Auth.js Google OIDC with `openid email profile` only.
Only a Google-verified email matching server-side owner configuration may resolve
or create the database account; existing IDs/history are preserved. Public signup,
password login and guest providers are disabled. Provider tokens are not persisted
in app sessions or the database. Apple/passkey login is not enabled or advertised.

Google client credentials must be created in the owner's Google Cloud account and
saved privately in the preview's Vercel settings. Follow
`docs/google-sign-in-setup.md`. No Gmail API, email scopes or billing are required.
Local production-build checks confirmed that only Google is exposed when configured,
its authorization redirect requests only identity scopes and includes PKCE S256,
state and nonce, and no offline access is requested. A phone-sized Chromium check
confirmed an enabled Google button, no password field and no horizontal overflow.
TypeScript, lint, the build and all five security regression cases pass.

A real Google callback and Neon persistence cannot be claimed verified until that
setup and the owner's sign-in are complete. Later milestones remain gated.

## Delivery status

GitHub write access was restored after installation of the ChatGPT Codex
Connector. The tested feature branch is now pushed to GitHub. Draft PR #1 is open against main:
https://github.com/csahingoz-hwk/general-purpose-agent-quickstart/pull/1
The PR remains unmerged and in draft.

No merge, production promotion, database mutation, live credential changes, paid
integration connection, or later milestone work was performed. Existing Vercel
Deployment Protection was not changed. Actual owner login, Neon persistence and
model selection must be verified on an authenticated preview after APP_OWNER_EMAIL
is configured; no live service credentials are available in this workspace.

See `docs/security-hardening.md` for cloud-only owner provisioning and setup.

## Changed files

- `docs/google-sign-in-setup.md`
- `lib/google-owner.ts`
- `tests/security/google-owner.test.ts`

- `.github/workflows/security.yml`

- `.env.example`
- `app/(auth)/actions.ts`
- `app/(auth)/api/auth/guest/route.ts`
- `app/(auth)/auth.ts`
- `app/(auth)/login/page.tsx`
- `app/(auth)/register/page.tsx`
- `app/(chat)/actions.ts`
- `app/(chat)/api/chat/route.ts`
- `app/(chat)/api/chat/schema.ts`
- `app/(chat)/api/files/upload/route.ts`
- `app/(chat)/api/messages/route.ts`
- `app/(chat)/api/models/route.ts`
- `app/(chat)/layout.tsx`
- `app/admin/agent/page.tsx`
- `app/admin/agent/soul-editor.tsx`
- `app/admin/page.tsx`
- `app/admin/schedules/delete-button.tsx`
- `app/admin/schedules/page.tsx`
- `app/admin/telegram/link-panel.tsx`
- `app/admin/telegram/page.tsx`
- `app/api/agent/soul/route.ts`
- `app/api/cron/tick/route.ts`
- `app/api/telegram-webhook/route.ts`
- `app/memory-demo/api/chat/route.ts`
- `app/memory-demo/page.tsx`
- `app/telegram/page.tsx`
- `biome.jsonc`
- `components/chat/message.tsx`
- `components/chat/sidebar-user-nav.tsx`
- `docs/draft-pr.md`
- `docs/security-hardening.md`
- `docs/security-results.md`
- `lib/access-policy.ts`
- `lib/ai/tools/schedule-task.ts`
- `lib/composio/server.ts`
- `lib/db/queries.ts`
- `lib/telegram.ts`
- `next.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `proxy.ts`
- `scripts/provision-owner.ts` (removed; Google provisions the verified owner)
- `tests/security/access.test.ts`
- `vercel.json`

## Free-account chat readiness follow-up (8 November 2026)

The owner reports working Google sign-in and supplied the iPhone chat screen.
Their first reply was blocked by Gateway activation. The security branch now
uses direct Groq with verified, bounded candidates and a clear default; see
[free-chat-readiness.md](free-chat-readiness.md) for architecture and limitations.
The newly saved key was scoped to the security Preview without reading its value.

Fresh local results: TypeScript, Biome (166 files), 11 security/readiness cases,
credential-free production build and phone-sized Chromium readiness/selection/
failed-send recovery all PASS. The browser test uses synthetic owner, model,
BotID and failed-response fixtures; it proves neither real Safari nor cloud chat
persistence. CI now includes this browser check after its credential-free build.
Production audit has zero findings; the full audit still has only the previously
recorded low development advisory. External SDK/Gateway execution scan and diff
checks passed. No new dependency or schema change was required.

Cloud inference verification and the owner's real chat/persistence checks are
separate acceptance gates. No merge, production release, Gmail connection or
scheduled execution follows automatically from these checks.

Current cloud follow-up: runtime `2239214`, Vercel preview
`dpl_7Yhv628KZp8DdTygmQFxbaXGmEza` is READY. Both Groq candidates returned
nonempty synthetic greetings during its build. GitHub run `42496421765`
succeeded, including the new browser check. Fresh protected-deployment fetches
confirmed login 200, Google-only providers with the stable callback and guest
403. Owner streaming/reload persistence and security acceptance remain pending.
