import { type NextRequest, NextResponse } from "next/server";
import { auth, signIn } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { GOOGLE_WORKSPACE_CONNECT_SCOPE } from "@/lib/connectors/google-vault-auth";
import { isGoogleSignInConfigured } from "@/lib/google-owner";

function sanitizeReturnTo(raw: string | null): string {
  const candidate = (raw ?? "").trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }
  return "/setup?connected=google";
}

/**
 * Top-level Safari GET entrypoint for Google Workspace OAuth consent.
 * Opened via `<a href="/connect/google/start?..." target="_blank" rel="noopener">`
 * so Google's "Verify it's you" Passkey / reauth challenge always runs in a
 * real top-level Safari tab rather than an embedded webview, popup, or XHR transition.
 */
export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const url = request.nextUrl;
  const safeReturnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
  const selectAccount = url.searchParams.get("selectAccount") === "1";

  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return NextResponse.redirect(new URL(`${base}/login`, request.url), 302);
  }

  if (!isGoogleSignInConfigured()) {
    const fallbackUrl = new URL(`${base}/connect/google`, request.url);
    fallbackUrl.searchParams.set("error", "configuration");
    fallbackUrl.searchParams.set("returnTo", safeReturnTo);
    return NextResponse.redirect(fallbackUrl, 302);
  }

  const completionPath = `${base}/connect/google?status=connected&returnTo=${encodeURIComponent(safeReturnTo)}`;

  try {
    const redirectUrl = await signIn(
      "google",
      {
        redirect: false,
        redirectTo: completionPath,
      },
      {
        scope: GOOGLE_WORKSPACE_CONNECT_SCOPE,
        access_type: "offline",
        prompt: selectAccount ? "select_account consent" : "consent",
        include_granted_scopes: "true",
        ...(!selectAccount && session.user.email
          ? { login_hint: session.user.email }
          : {}),
      }
    );

    if (typeof redirectUrl === "string" && redirectUrl.startsWith("http")) {
      return NextResponse.redirect(redirectUrl, 302);
    }
    return NextResponse.redirect(
      new URL(String(redirectUrl || completionPath), request.url),
      302
    );
  } catch {
    const retryUrl = new URL(`${base}/connect/google`, request.url);
    retryUrl.searchParams.set("error", "oauth_start_failed");
    retryUrl.searchParams.set("returnTo", safeReturnTo);
    return NextResponse.redirect(retryUrl, 302);
  }
}
