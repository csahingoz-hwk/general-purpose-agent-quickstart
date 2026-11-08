# Owner-only security milestone

The app requires the server-only `APP_OWNER_EMAIL` setting. Missing configuration,
non-owner accounts and guest cookies are denied. Credentials login still verifies
the stored bcrypt password; Auth.js sign-in, JWT refresh, server-session reads,
proxy requests and chat layout all enforce the owner policy. Public registration
and guest authentication are disabled. Existing conversations, user IDs, model
selection, database schema and migrations are preserved. Email lookup is case
insensitive.

## Owner setup in the cloud

1. Set `APP_OWNER_EMAIL` in the Vercel preview environment to the owner's existing
   account email. Use the same setting in production only when a reviewed release
   is approved. Never use a `NEXT_PUBLIC_` variable for it.
2. If the owner account already exists, use its existing password. No account or
   password reset is performed by this change.
3. If no owner account exists, use a trusted cloud terminal with `POSTGRES_URL`,
   `APP_OWNER_EMAIL` and a temporary `OWNER_INITIAL_PASSWORD` supplied through
   secret environment bindings. Run `pnpm owner:provision` once. Use a password
   of at least 16 characters and at most 72 UTF-8 bytes. Remove the temporary
   password binding immediately afterwards. Do not put secrets in command-line
   arguments, Git, chat, screenshots or logs.
4. Provisioning uses a transaction and advisory lock; it refuses to overwrite any
   matching account. There is no HTTP bootstrap endpoint or registration window.
5. Keep Vercel Deployment Protection enabled. Sign in to the preview and verify
   an existing conversation loads, a new conversation persists, and model
   selection works with the existing gateway configuration before approving a
   release. Live owner login and Neon persistence need that environment; this
   workspace intentionally has no database or paid-service credentials.

## Disabled capabilities

- No Composio SDK, meta-tools, Gmail sending or model-accessible remote shell.
  Composio and Supermemory SDKs were removed and their loading paths deleted.
  The integration settings and paid memory demo cannot connect services.
- Cron requires a configured, constant-time-checked bearer secret in every
  environment, then returns 503 without database reads or model calls. No
  environment flag can enable it in this milestone. The Vercel cron declaration
  is removed. Existing schedule rows are retained; creation is disabled, while
  owner list/delete remains available.
- Telegram agent execution and webhook setup UI are disabled pending a separate
  review. Existing credentials and database links are not deleted.
- Model metadata requires owner authentication and uses private/no-store HTTP
  caching. Formerly public conversations require chat ownership too.

Code/document artifact tools and client-side Python artifacts remain available;
there is no server shell tool. Existing Auth.js, AUTH_SECRET, CRON_SECRET, Neon,
and gateway credentials must be retained. Leave Gmail and paid integration keys
disconnected. No migrations, merge or production promotion are part of this work.

## Validation and remaining review

Run `pnpm exec tsc --noEmit`, `pnpm check`, `pnpm test:security`, `pnpm build`,
`pnpm audit --audit-level=moderate`, and `pnpm audit --prod`. Security tests cover
missing owner configuration, signed owner/non-owner/guest cookies, disabled guest
and alternate execution endpoints, and cron authorization in all environments.

Framework/auth/database/editor dependencies and vulnerable transitive packages
were patched. Security overrides are constrained to patched versions in
`package.json`. Generated migration metadata is excluded from formatting.
One known low-severity development-only advisory remains:
`deepmerge` through `ultracite`, GHSA-gcqx-w48m-w2h4 (no patched version reported).
It must be reviewed; no critical, high or moderate findings remain in the full
audit. Runtime audit and production request smoke results are recorded in the
handoff report. Later UI, voice, Gmail and scheduling milestones have not begun.
