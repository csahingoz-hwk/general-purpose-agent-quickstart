import { isOwnerEmail } from "./access-policy";

export const GOOGLE_IDENTITY_SCOPE = "openid email profile";

export function isGoogleSignInConfigured(): boolean {
  return Boolean(
    process.env.APP_OWNER_EMAIL?.trim() &&
      process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim()
  );
}

// Auth.js supplies this profile only after Google's OIDC checks have succeeded.
export async function resolveGoogleOwner(
  profile: { email?: unknown; email_verified?: unknown } | undefined,
  resolveAccount: (email: string) => Promise<{ id: string; email: string }>
) {
  if (profile?.email_verified !== true || !isOwnerEmail(profile.email)) {
    return null;
  }
  const email = (profile.email as string).trim().toLowerCase();
  const owner = await resolveAccount(email);
  if (!owner.id || !isOwnerEmail(owner.email)) {
    return null;
  }
  return { id: owner.id, email: owner.email, type: "regular" as const };
}
