# Owner-only security milestone

The app requires the server-only `APP_OWNER_EMAIL` setting. Missing configuration,
non-owner accounts and guest cookies are denied. Google sign-in accepts only the verified configured owner email. Auth.js OIDC
verification, sign-in authorization, JWT refresh, server-session reads, proxy
requests and chat layout enforce the owner policy. There is no public signup or
password login. The first verified owner sign-in creates the assistant account if
needed; an existing matching account retains its ID and conversation history.
Concurrent first sign-ins are serialized with a PostgreSQL advisory lock. Duplicate
matching accounts fail closed for review. Stored legacy passwords are not changed.

## Owner setup in the cloud

The owner email is configured server-side in the security branch's Vercel preview;
it is never hardcoded in the repository or sent as public configuration.

Follow `docs/google-sign-in-setup.md` to create a Google Web application OAuth
client and privately configure `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in the
security preview. The provider stays disabled until all required settings exist.
No database scripts, temporary passwords or public registration window are needed.
Use the stable preview alias registered in Google's callback list.

The only requested Google permissions are `openid email profile`, confirming
identity. Gmail permissions, offline access and refresh-token storage are not
requested. Google access/ID/refresh tokens are not copied to session cookies,
client responses or the existing database. Auth.js handles PKCE, state and nonce.

Keep Vercel Deployment Protection enabled. Once configured, sign in to the preview
and verify an existing conversation loads, a new conversation persists, and model
selection works with the existing gateway configuration. Live owner login and
Neon persistence remain unverified until Google setup is complete. No production
configuration or promotion is authorized by the preview setup.

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
missing owner/OAuth configuration, verified Google owner identity before database
lookup/provisioning, signed owner/non-owner/guest cookies, disabled guest
and alternate execution endpoints, and cron authorization in all environments.

Framework/auth/database/editor dependencies and vulnerable transitive packages
were patched. Security overrides are constrained to patched versions in
`package.json`. Generated migration metadata is excluded from formatting.
One known low-severity development-only advisory remains:
`deepmerge` through `ultracite`, GHSA-gcqx-w48m-w2h4 (no patched version reported).
It must be reviewed; no critical, high or moderate findings remain in the full
audit. Runtime audit and production request smoke results are recorded in the
handoff report. Later UI, voice, Gmail and scheduling milestones have not begun.
