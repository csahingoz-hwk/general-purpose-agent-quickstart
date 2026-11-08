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

## Delivery status

Git push and GitHub connector branch creation both returned HTTP 403, including
retries after the owner granted full access. No remote PR URL exists yet. The
commit, patch and Git bundle preserve the cloud work for an authenticated session.
A draft PR description is provided in `docs/draft-pr.md`.

No merge, production promotion, database mutation, live credential changes, paid
integration connection, or later milestone work was performed. Existing Vercel
Deployment Protection was not changed. Actual owner login, Neon persistence and
model selection must be verified on an authenticated preview after APP_OWNER_EMAIL
is configured; no live service credentials are available in this workspace.

See `docs/security-hardening.md` for cloud-only owner provisioning and setup.

## Changed files

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
