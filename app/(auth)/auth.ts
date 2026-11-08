import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import { isOwnerIdentity } from "@/lib/access-policy";
import { getOrCreateGoogleOwner } from "@/lib/db/queries";
import {
  GOOGLE_IDENTITY_SCOPE,
  isGoogleSignInConfigured,
  resolveGoogleOwner,
} from "@/lib/google-owner";
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
