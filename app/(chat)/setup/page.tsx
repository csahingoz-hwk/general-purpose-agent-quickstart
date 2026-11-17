"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  connectGithubAccount,
  connectGoogleWorkspace,
} from "@/app/(auth)/actions";
import type { SetupChecklistItem } from "@/app/api/setup-status/route";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
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
  const [busy, setBusy] = useState(false);

  const { data, mutate } = useSWR<SetupStatusResponse>(
    `${basePath}/api/setup-status`,
    fetcher
  );

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected === "google") {
      toast({
        type: "success",
        description: "Google Gmail, Calendar & Drive connected.",
      });
    } else if (connected === "github") {
      toast({ type: "success", description: "GitHub connected." });
    }
  }, [searchParams]);

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
              ? "Disconnected Google."
              : "Disconnected GitHub.",
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
            Setup checklist
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Core chat, live voice, search, and images run automatically. Connect
            personal apps below when you want draft assistance.
          </p>
        </div>

        <ul className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card text-sm">
          {(data?.items ?? []).map((item) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              key={item.id}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
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
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.summary}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {item.connectedProvider ? (
                  <button
                    className="min-h-11 rounded-full border border-[color:var(--hairline)] px-4 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                    disabled={busy}
                    onClick={() =>
                      item.connectedProvider &&
                      handleDisconnect(item.connectedProvider)
                    }
                    type="button"
                  >
                    Disconnect
                  </button>
                ) : item.actionKind === "connect_google" ? (
                  <form action={connectGoogleWorkspace}>
                    <input
                      name="returnTo"
                      type="hidden"
                      value="/setup?connected=google"
                    />
                    <button
                      className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                      type="submit"
                    >
                      Connect
                    </button>
                  </form>
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
                      Connect
                    </button>
                  </form>
                ) : item.actionKind === "external_link" && item.externalUrl ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-xs hover:bg-muted"
                    href={item.externalUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.externalLabel ?? "Open"}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-muted-foreground text-xs">Ready</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
