import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { isOwnerIdentity } from "@/lib/access-policy";
import { GITHUB_VAULT_SECRET_NAME } from "@/lib/connectors/calendar-and-github";
import {
  GOOGLE_VAULT_SECRET_NAMES,
  invalidateGoogleAccessTokenCache,
  isAllowedOwnerGoogleConnectorEmail,
} from "@/lib/connectors/google-vault-auth";
import { getOrCreateGoogleOwner } from "@/lib/db/queries";
import {
  GOOGLE_IDENTITY_SCOPE,
  isGoogleSignInConfigured,
  resolveGoogleOwner,
} from "@/lib/google-owner";
import {
  createPostgresVaultStore,
  isVaultConfigured,
} from "@/lib/vault/secret-vault";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth: rawAuth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    ...(isGoogleSignInConfigured()
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            authorization: {
              params: {
                scope: GOOGLE_IDENTITY_SCOPE,
                prompt: "select_account",
              },
            },
            checks: ["pkce", "state", "nonce"],
          }),
        ]
      : []),
    ...(process.env.AUTH_GITHUB_ID?.trim() &&
    process.env.AUTH_GITHUB_SECRET?.trim()
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
            authorization: { params: { scope: "repo read:user" } },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "github") {
        const existingSession = await rawAuth();
        if (!isOwnerIdentity(existingSession?.user) || !existingSession?.user) {
          return false;
        }
        if (account.access_token?.trim() && isVaultConfigured()) {
          try {
            await createPostgresVaultStore().upsertSecret({
              userId: existingSession.user.id,
              name: GITHUB_VAULT_SECRET_NAME,
              provider: "github",
              plaintext: account.access_token.trim(),
            });
          } catch {
            /* non-fatal */
          }
        }
        Object.assign(user, {
          id: existingSession.user.id,
          email: existingSession.user.email,
          type: "regular" as const,
        });
        return true;
      }

      if (account?.provider !== "google") {
        return false;
      }
      const grantedScope = account.scope ?? "";
      const hasWorkspaceScope =
        grantedScope.includes("gmail.") ||
        grantedScope.includes("drive.") ||
        grantedScope.includes("calendar.");

      const existingSession = hasWorkspaceScope ? await rawAuth() : null;
      let owner: { id: string; email: string; type: "regular" } | null = null;

      if (
        hasWorkspaceScope &&
        existingSession?.user &&
        isOwnerIdentity(existingSession.user) &&
        existingSession.user.email &&
        profile?.email_verified === true &&
        isAllowedOwnerGoogleConnectorEmail(profile.email)
      ) {
        owner = {
          id: existingSession.user.id,
          email: existingSession.user.email,
          type: "regular",
        };
      } else {
        owner = await resolveGoogleOwner(profile, getOrCreateGoogleOwner);
      }
      if (!owner) {
        return false;
      }
      // Keep database identity stable so existing conversations stay attached.
      Object.assign(user, owner);

      if (hasWorkspaceScope && isVaultConfigured()) {
        try {
          invalidateGoogleAccessTokenCache(owner.id);
          const vault = createPostgresVaultStore();
          if (account.refresh_token?.trim()) {
            await vault.upsertSecret({
              userId: owner.id,
              name: GOOGLE_VAULT_SECRET_NAMES.refreshToken,
              provider: "google",
              plaintext: account.refresh_token.trim(),
            });
            await vault
              .deleteSecret({
                userId: owner.id,
                name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
              })
              .catch(() => false);
          } else if (account.access_token?.trim()) {
            const existingRefresh = await vault
              .resolveSecret({
                userId: owner.id,
                name: GOOGLE_VAULT_SECRET_NAMES.refreshToken,
              })
              .catch(() => null);
            if (!existingRefresh?.trim()) {
              await vault.upsertSecret({
                userId: owner.id,
                name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
                provider: "google",
                plaintext: account.access_token.trim(),
              });
            }
          }
        } catch {
          /* non-fatal if database vault isn't reachable during callback */
        }
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return isOwnerIdentity(token) ? token : null;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});

// All route handlers and server actions recheck policy, including existing sessions.
export async function auth() {
  const session = await rawAuth();
  return isOwnerIdentity(session?.user) ? session : null;
}
