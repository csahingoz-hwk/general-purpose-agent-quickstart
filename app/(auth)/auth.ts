import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { isOwnerIdentity } from "@/lib/access-policy";
import { GOOGLE_VAULT_SECRET_NAMES } from "@/lib/connectors/google-vault-auth";
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
  providers: isGoogleSignInConfigured()
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          authorization: {
            params: { scope: GOOGLE_IDENTITY_SCOPE, prompt: "select_account" },
          },
          checks: ["pkce", "state", "nonce"],
        }),
      ]
    : [],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") {
        return false;
      }
      const owner = await resolveGoogleOwner(profile, getOrCreateGoogleOwner);
      if (!owner) {
        return false;
      }
      // Keep database identity stable so existing conversations stay attached.
      Object.assign(user, owner);

      const grantedScope = account.scope ?? "";
      const hasWorkspaceScope =
        grantedScope.includes("gmail.") ||
        grantedScope.includes("drive.") ||
        grantedScope.includes("calendar.");
      if (hasWorkspaceScope && isVaultConfigured()) {
        try {
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
