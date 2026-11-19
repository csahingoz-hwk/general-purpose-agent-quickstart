"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { connectGithubAccount } from "@/app/(auth)/actions";
import type { SetupChecklistItem } from "@/app/api/setup-status/route";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import { useUiLocale } from "@/hooks/use-ui-locale";
import { formatSetupChecklistItemCopy } from "@/lib/ui-copy";
import { cn, fetcher } from "@/lib/utils";

type SetupStatusResponse = {
  items: SetupChecklistItem[];
  googleConnected: boolean;
  githubConnected: boolean;
  googleSignInReady: boolean;
  githubOAuthReady: boolean;
  vaultReady: boolean;
};

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
      <SetupPageContent />
    </Suspense>
  );
}

function SetupPageContent() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const searchParams = useSearchParams();
  const { mutate: globalMutate } = useSWRConfig();
  const { locale, copy } = useUiLocale();
  const [busy, setBusy] = useState(false);

  const connectedParam = searchParams.get("connected");
  const { data, error, isLoading, mutate } = useSWR<SetupStatusResponse>(
    `${basePath}/api/setup-status${connectedParam ? "?refresh=1" : ""}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 10 * 60_000,
    }
  );

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected === "google") {
      toast({
        type: "success",
        description: copy.toastGoogleConnected,
      });
    } else if (connected === "github") {
      toast({ type: "success", description: copy.toastGithubConnected });
    }
  }, [searchParams, copy.toastGoogleConnected, copy.toastGithubConnected]);

  async function handleDisconnect(target: "google" | "github") {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/connectors?provider=${target}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await Promise.all([
          mutate(),
          globalMutate(`${basePath}/api/connectors`),
        ]);
        toast({
          type: "success",
          description:
            target === "google"
              ? copy.toastGoogleDisconnected
              : copy.toastGithubDisconnected,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader />

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            {copy.setupHeading}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {copy.setupSubtitle}
          </p>
        </div>

        {error && !data ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-sm"
            data-testid="setup-checklist-error"
          >
            <p className="text-muted-foreground">{copy.setupLoadError}</p>
            <button
              className="inline-flex min-h-10 items-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-xs hover:bg-muted"
              onClick={() => mutate()}
              type="button"
            >
              {copy.setupRetry}
            </button>
          </div>
        ) : null}

        <ul
          className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card text-sm"
          data-testid="setup-checklist-list"
        >
          {isLoading && !data
            ? ["sk-1", "sk-2", "sk-3", "sk-4", "sk-5", "sk-6"].map((skKey) => (
                <li
                  className="flex items-center justify-between gap-3 px-4 py-4"
                  data-testid="setup-checklist-skeleton"
                  key={skKey}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-1.5 size-2.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/30" />
                    <div className="w-full max-w-md space-y-2">
                      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-full animate-pulse rounded bg-muted/70" />
                    </div>
                  </div>
                  <div className="h-7 w-20 shrink-0 animate-pulse rounded-full bg-muted" />
                </li>
              ))
            : null}
          {(data?.items ?? []).map((item) => {
            const localized = formatSetupChecklistItemCopy(item, locale);
            return (
              <li
                className="scroll-mt-20 flex flex-col items-start justify-between gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
                data-testid={`setup-item-${item.id}`}
                id={`setup-${item.id}`}
                key={item.id}
              >
                <div className="flex w-full min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      item.status === "ready"
                        ? "bg-emerald-500"
                        : item.status === "action_needed"
                          ? "bg-amber-500"
                          : "bg-muted-foreground/45"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {localized.label}
                    </p>
                    <p className="mt-0.5 break-words text-muted-foreground text-xs [overflow-wrap:anywhere]">
                      {localized.summary}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap shrink-0 items-center gap-2 pl-5 sm:pl-0">
                  {item.connectedProvider ? (
                    <div className="flex items-center gap-2">
                      {item.connectedProvider === "google" && (
                        <a
                          className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                          href={`${basePath}/connect/google/start?returnTo=${encodeURIComponent("/setup?connected=google")}`}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {copy.setupReconnect}
                        </a>
                      )}
                      <button
                        className="min-h-11 rounded-full border border-[color:var(--hairline)] px-4 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                        disabled={busy}
                        onClick={() =>
                          item.connectedProvider &&
                          handleDisconnect(item.connectedProvider)
                        }
                        type="button"
                      >
                        {copy.setupDisconnect}
                      </button>
                    </div>
                  ) : item.actionKind === "connect_google" ? (
                    <a
                      className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                      href={`${basePath}/connect/google/start?returnTo=${encodeURIComponent("/setup?connected=google")}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {copy.setupConnect}
                    </a>
                  ) : item.actionKind === "connect_github" ? (
                    <form action={connectGithubAccount}>
                      <input
                        name="returnTo"
                        type="hidden"
                        value="/setup?connected=github"
                      />
                      <button
                        className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                        type="submit"
                      >
                        {copy.setupConnect}
                      </button>
                    </form>
                  ) : item.actionKind === "external_link" &&
                    item.externalUrl ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {item.status === "ready" && (
                        <span className="text-emerald-600 text-xs dark:text-emerald-400">
                          {copy.setupReady}
                        </span>
                      )}
                      <a
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                        data-testid={`setup-external-link-${item.id}`}
                        href={
                          item.externalUrl.startsWith("/")
                            ? `${basePath}${item.externalUrl}`
                            : item.externalUrl
                        }
                        rel={
                          item.externalUrl.startsWith("/")
                            ? undefined
                            : "noopener noreferrer"
                        }
                        target={
                          item.externalUrl.startsWith("/")
                            ? undefined
                            : "_blank"
                        }
                      >
                        {localized.externalLabel ?? copy.setupOpen}
                        {!item.externalUrl.startsWith("/") && (
                          <ExternalLinkIcon className="size-3.5" />
                        )}
                      </a>
                      {item.secondaryExternalUrl ? (
                        <a
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-3.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                          data-testid={`setup-secondary-link-${item.id}`}
                          href={item.secondaryExternalUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {localized.secondaryExternalLabel ?? copy.setupOpen}
                          <ExternalLinkIcon className="size-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ) : item.status === "ready" ? (
                    <span
                      className="inline-flex items-center rounded-full bg-emerald-500/12 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300"
                      data-testid={`setup-badge-${item.id}`}
                    >
                      {item.id === "mac_bridge"
                        ? copy.setupConnected
                        : copy.setupReady}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {copy.setupOptional}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
