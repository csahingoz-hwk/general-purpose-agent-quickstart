import { connection } from "next/server";
import { Suspense } from "react";
import { isGoogleSignInConfigured } from "@/lib/google-owner";
import { loginWithGoogle } from "../actions";

type LoginSearchParams = Promise<{ error?: string }>;

async function SignIn({ searchParams }: { searchParams: LoginSearchParams }) {
  await connection();
  const { error } = await searchParams;
  const ready = isGoogleSignInConfigured();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Your personal assistant
      </h1>
      <p className="text-sm text-muted-foreground">
        Sign in with your Google account. Access is reserved for the owner.
      </p>
      <p className="text-sm text-muted-foreground" lang="tr">
        Google hesabınızla giriş yapın. Erişim yalnızca hesap sahibine açıktır.
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          Sign-in could not be completed. Please use the owner's Google account
          and try again.
        </p>
      )}
      <form action={loginWithGoogle}>
        <button
          className="mt-4 w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={!ready}
          type="submit"
        >
          Sign in with Google / Google ile giriş yap
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Google sign-in confirms your identity. It does not give this assistant
        access to your Gmail messages.
      </p>
      {!ready && (
        <output className="text-sm text-muted-foreground">
          Google sign-in is being set up. Please try again once setup is
          complete.
        </output>
      )}
    </>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  return (
    <Suspense fallback={<p>Loading sign-in…</p>}>
      <SignIn searchParams={searchParams} />
    </Suspense>
  );
}
