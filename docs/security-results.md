# Security milestone handoff

Branch: `security/owner-only-hardening`.

## Results

- TypeScript (`tsc --noEmit`): PASS.
- Lint (`biome check`, the configured Ultracite engine/presets): PASS, 159 files.
- Production build (`pnpm build`, pnpm 10.32.1): PASS on Next.js 16.4.5.
  Migration step explicitly skipped because this workspace has no POSTGRES_URL.
- Security regression tests: PASS, three cases covering owner/guest/cron policy.
- Built-app HTTP smoke checks: PASS, 15 assertions covering login/registration,
  unauthorized chat/history/models/documents/uploads/messages/demo requests,
  disabled guests/Telegram, cron secret checks, and credentials-only providers.
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
- Environment metadata confirms `APP_OWNER_EMAIL` is absent. The owner email and
  whether an existing account exists have been requested. No identity was guessed,
  secret value decrypted, or environment variable changed.
- Owner sign-in and Neon conversation persistence remain a gate before later
  milestones. Interactive UI, voice, Gmail and scheduling work has not started.
- `.github/workflows/security.yml` now runs the security milestone checks on the
  PR without deployment credentials. Actions are pinned to immutable commit SHAs.
- The lint script now invokes the pinned local Biome binary directly. The old
  Ultracite wrapper downloaded a newer Biome version that rejected the existing
  configuration; presets and lint rules remain unchanged.

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
- `scripts/provision-owner.ts`
- `tests/security/access.test.ts`
- `vercel.json`
