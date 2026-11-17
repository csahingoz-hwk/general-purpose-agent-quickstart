"use server";

import { redirect } from "next/navigation";
import { GOOGLE_WORKSPACE_CONNECT_SCOPE } from "@/lib/connectors/google-vault-auth";
import { isGoogleSignInConfigured } from "@/lib/google-owner";
import { auth, signIn } from "./auth";

export async function loginWithGoogle() {
  if (!isGoogleSignInConfigured()) {
    redirect("/login?error=Configuration");
  }
  await signIn("google", { redirectTo: "/" });
}

export async function connectGoogleWorkspace(formData?: FormData) {
  const session = await auth();
  if (!session?.user || !isGoogleSignInConfigured()) {
    redirect("/usage");
  }
  const rawReturn =
    formData?.get("returnTo")?.toString() ?? "/usage?connected=google";
  const safeReturn =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//")
      ? rawReturn
      : "/usage?connected=google";
  await signIn(
    "google",
    { redirectTo: safeReturn },
    {
      scope: GOOGLE_WORKSPACE_CONNECT_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    }
  );
}

export async function connectGithubAccount(formData?: FormData) {
  const session = await auth();
  if (
    !session?.user ||
    !process.env.AUTH_GITHUB_ID?.trim() ||
    !process.env.AUTH_GITHUB_SECRET?.trim()
  ) {
    redirect("/setup");
  }
  const rawReturn =
    formData?.get("returnTo")?.toString() ?? "/setup?connected=github";
  const safeReturn =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//")
      ? rawReturn
      : "/setup?connected=github";
  await signIn("github", { redirectTo: safeReturn });
}

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

// No public signup. Only the verified configured owner can be provisioned.
export const register = async (
  _: RegisterActionState,
  _formData: FormData
): Promise<RegisterActionState> => ({ status: "failed" });
