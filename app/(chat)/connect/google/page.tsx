import { CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

type ConnectSearchParams = Promise<{
  status?: string;
  error?: string;
  returnTo?: string;
}>;

function sanitizeReturnTo(raw?: string): string {
  const candidate = (raw ?? "").trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }
  return "/";
}

async function GoogleConnectStatusContent({
  searchParams,
}: {
  searchParams: ConnectSearchParams;
}) {
  await connection();
  const params = await searchParams;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const returnTo = sanitizeReturnTo(params.returnTo);
  const isConnected = params.status === "connected" && !params.error;
  const startHref = `${base}/connect/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  const selectAccountHref = `${base}/connect/google/start?returnTo=${encodeURIComponent(returnTo)}&selectAccount=1`;

  if (isConnected) {
    return (
      <div
        className="w-full max-w-md space-y-4 rounded-2xl border border-[color:var(--hairline)] bg-card p-6 shadow-xs"
        data-testid="google-connect-complete-card"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2Icon className="mt-0.5 size-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1">
            <h1 className="font-semibold text-foreground text-lg">
              Google connected · Google bağlandı
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Read-only Gmail, Calendar &amp; Drive permissions are saved. You
              can return to your chat or close this Safari tab.
            </p>
            <p
              className="text-muted-foreground text-xs leading-relaxed"
              lang="tr"
            >
              Salt okunur Gmail, Takvim ve Drive izni kaydedildi. Sohbete
              dönebilir veya bu Safari sekmesini kapatabilirsiniz.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            data-testid="google-connect-return-button"
            href={returnTo}
          >
            Return to chat · Sohbete dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-md space-y-4 rounded-2xl border border-[color:var(--hairline)] bg-card p-6 shadow-xs"
      data-testid="google-connect-retry-card"
    >
      <div className="space-y-1.5">
        <h1 className="font-semibold text-foreground text-lg">
          Finish Google verification in Safari
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {params.error
            ? "Google interrupted the verification step (“Verify it's you”). Tap Try again below in this full Safari tab to complete read-only Gmail access."
            : "Continue in this full Safari tab to grant read-only Gmail, Calendar & Drive access."}
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed" lang="tr">
          {params.error
            ? "Google kimlik doğrulama adımı yarıda kaldı. Salt okunur Gmail iznini tamamlamak için bu tam Safari sekmesinde Tekrar dene butonuna dokunun."
            : "Salt okunur Gmail, Takvim ve Drive izni vermek için bu Safari sekmesinden devam edin."}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap">
        <a
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          data-testid="google-connect-try-again-button"
          href={selectAccountHref}
        >
          <RefreshCwIcon className="size-4" />
          <span>Try again · Tekrar dene</span>
        </a>
        <a
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-xs transition-colors hover:bg-muted"
          data-testid="google-connect-same-account-button"
          href={startHref}
        >
          Continue with current account
        </a>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full px-4 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
          href={returnTo}
        >
          Back to chat · Sohbete dön
        </Link>
      </div>
    </div>
  );
}

export default function GoogleConnectPage({
  searchParams,
}: {
  searchParams: ConnectSearchParams;
}) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-background px-4 py-8">
      <Suspense
        fallback={
          <p className="text-muted-foreground text-sm">
            Preparing Google connection…
          </p>
        }
      >
        <GoogleConnectStatusContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
