# Set up your Google sign-in

This is the only account setup needed. You will use your existing Google account;
you do not need a separate assistant password. It grants identity access only,
not access to Gmail messages. Apple and passkeys are not part of this setup.

## 1. Create a Google login client

Open https://console.cloud.google.com/auth/overview in your browser, signed in as
the account you want to use. Create or select a project for your personal assistant.

In **Google Auth Platform**, complete **Branding** (an app name such as "My
Assistant", your support email and contact email). Under **Audience**, choose
**External**, keep the app in **Testing**, and add your own Google email as a test
user if Google presents a test-user list.

Open **Clients → Create client → Web application**. Name it "Assistant preview".
Add this exact **Authorized redirect URI**:

```text
https://general-purpose-agent-quickstart-git-secu-1658d1-csahingoz-3779.vercel.app/api/auth/callback/google
```

Only basic identity scopes (`openid`, email and profile) are needed. Do not enable
the Gmail API, request Gmail scopes, add billing or purchase an integration for
this login setup. Do not add production redirect URLs yet.

Google will show a **Client ID** and **Client secret**. Keep the secret private.

## 2. Save those two values privately in Vercel

Open:
https://vercel.com/csahingoz-3779/general-purpose-agent-quickstart/settings/environment-variables

Add these two variables, selecting **Preview** and limiting them to the
`security/owner-only-hardening` branch. Store the secret as a **Secret/Sensitive**
variable. Do not paste its value into chat or commit it to GitHub.

| Vercel name | Value from Google |
| --- | --- |
| `AUTH_GOOGLE_ID` | Client ID |
| `AUTH_GOOGLE_SECRET` | Client secret |

`APP_OWNER_EMAIL` is already set on this preview. Existing `AUTH_SECRET`, database
settings and `CRON_SECRET` must remain unchanged. Production stays untouched.

After saving, tell the assistant **"Google login configured"**. The assistant can
check variable names without reading values and redeploy the preview so it picks
up the settings. A new deployment is needed after adding environment variables.

## 3. Sign in and review

Open this stable preview after redeployment:
https://general-purpose-agent-quickstart-git-secu-1658d1-csahingoz-3779.vercel.app/login

Vercel may first ask you to sign in to your Vercel account because preview
protection remains enabled. Then choose **Sign in with Google** and use the owner
Google account. Other accounts are denied even if Google accepts their login.

The assistant account is created automatically after your verified owner login.
Review that you can open the chat, send a message with the existing model setup,
reload and see that conversation, and choose another available model. If there
was prior history under the same owner email, its account ID is preserved.

Only after these checks and security PR review should later milestones begin.
Do not merge or promote production automatically.

Reference: https://authjs.dev/getting-started/providers/google
