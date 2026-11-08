# Harden the assistant for owner-only access and disable external execution

## Behavior

Previously, guests and public registrations could access the assistant, Composio
loaded unrestricted tools in chat/cron/Telegram, and cron bypassed authorization
outside production. Require server-configured APP_OWNER_EMAIL at authentication,
JWT, server-session and request boundaries; remove guest/signup access and supply
Google identity login and automatic verified owner provisioning. Missing configuration denies access.

Remove Composio/Supermemory tool loading and SDKs, disable cron execution and
schedule creation, remove the Vercel cron trigger, and disable Telegram execution
and connection UI. Preserve existing database rows/schema/migrations, conversation
storage, Vercel Chatbot and model selection. No Gmail or paid service is connected.

Patch vulnerable dependencies and fix the resulting Zod/editor/config compatibility
issues and existing lint failures. Generated migration metadata is untouched.

## Validation

- TypeScript, lint, production build and three security regression cases pass.
- Fifteen built-app HTTP security assertions pass.
- Runtime audit has zero findings; full audit has one low development-only
  deepmerge/Ultracite advisory without a reported patch (GHSA-gcqx-w48m-w2h4).
- No database credentials were used; build migration step skipped.

## Before approval

Set APP_OWNER_EMAIL on the protected preview and verify owner Google sign-in,
existing history, new conversation persistence and model selection against Neon.
Configure Google OAuth identity credentials privately using docs/google-sign-in-setup.md.
Review the remaining dev-only advisory and dependency overrides.

Keep this PR in draft. Do not merge or promote production automatically.
Later interactive UI, voice, Gmail and schedule milestones remain deferred.
