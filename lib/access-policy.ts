/** Server-side access policy. Never expose the owner setting through NEXT_PUBLIC_*. */
export function isOwnerEmail(email: unknown): boolean {
  const owner = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(
    owner && typeof email === "string" && email.trim().toLowerCase() === owner
  );
}

export function isOwnerIdentity(
  user: { email?: unknown; type?: unknown } | null | undefined
): boolean {
  return Boolean(user && user.type === "regular" && isOwnerEmail(user.email));
}
