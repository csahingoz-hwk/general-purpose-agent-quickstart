"use client";

import { CheckCircle2Icon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense, useEffect, useState } from "react";
import useSWR from "swr";
import { connectGoogleWorkspace } from "@/app/(auth)/actions";
import { HomeLocationPanel } from "@/components/chat/home-location";
import { MascotPicker } from "@/components/chat/mascot-preference";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import { cn, fetcher } from "@/lib/utils";

type UsageCall = {
  model: string;
  createdAt: string;
  requestId: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  estimatedUsd: string | null;
  reservedUsd: string;
  outcome: string;
};

type UsageResponse = {
  dailyEstimatedUsd: number;
  monthlyEstimatedUsd: number;
  allowanceUsd: number;
  requests: number;
  invocations: number;
  fallbackInvocations: number;
  fallbackEstimatedUsd: number;
  unreportedInvocations: number;
  calls: UsageCall[];
};

type ConnectorStatusResponse = {
  gmailReady?: boolean;
  driveReady?: boolean;
  calendarReady?: boolean;
  geminiReady?: boolean;
  mediaReady?: boolean;
  githubReady?: boolean;
  googleSignInReady?: boolean;
  vaultConfigured?: boolean;
};

type VoiceReadinessResponse = {
  serverSttReady?: boolean;
  liveReady?: boolean;
};

export default function UsagePage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
      <UsagePageContent />
    </Suspense>
  );
}

function UsagePageContent() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [hasSpeechApi, setHasSpeechApi] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("connected") === "google") {
      toast({
        type: "success",
        description: "Google Gmail, Calendar & Drive connected.",
      });
    }
  }, [searchParams]);

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    setHasSpeechApi(
      Boolean(win.SpeechRecognition ?? win.webkitSpeechRecognition)
    );
  }, []);

  const { data, error } = useSWR<UsageResponse>(
    `${basePath}/api/usage`,
    fetcher
  );
  const { data: connectors, mutate: mutateConnectors } =
    useSWR<ConnectorStatusResponse>(`${basePath}/api/connectors`, fetcher, {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    });
  const { data: voice } = useSWR<VoiceReadinessResponse>(
    `${basePath}/api/voice/transcribe`,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  async function handleDisconnect(provider: "google" | "github") {
    setBusyProvider(provider);
    try {
      const res = await fetch(
        `${basePath}/api/connectors?provider=${provider}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await mutateConnectors();
        toast({
          type: "success",
          description:
            provider === "google"
              ? "Disconnected Google Workspace."
              : "Disconnected GitHub.",
        });
      }
    } finally {
      setBusyProvider(null);
    }
  }

  const usd = (value: number) => `$${value.toFixed(4)}`;
  const pct = data
    ? Math.min(
        100,
        Math.max(0, (data.monthlyEstimatedUsd / data.allowanceUsd) * 100)
      )
    : 0;

  return (
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-8 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader />

        <section className="space-y-3">
          <div>
            <h2 className="font-semibold text-xl tracking-tight">
              Appearance &amp; personalisation
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Adjust theme, mascot accent, and default home location for weather
              and local time.
            </p>
          </div>

          <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
            <div className="space-y-2.5 p-4">
              <p className="text-[13px] text-muted-foreground">Appearance</p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "system", label: "System", icon: MonitorIcon },
                    { id: "light", label: "Light", icon: SunIcon },
                    { id: "dark", label: "Dark", icon: MoonIcon },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = (theme ?? "system") === item.id;
                  return (
                    <button
                      aria-pressed={active}
                      className={cn(
                        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-3 font-medium text-sm transition-colors",
                        active
                          ? "border-transparent bg-foreground text-background"
                          : "border-[color:var(--hairline)] bg-background text-foreground hover:bg-muted"
                      )}
                      key={item.id}
                      onClick={() => setTheme(item.id)}
                      type="button"
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4">
              <MascotPicker />
            </div>

            <div className="p-4">
              <HomeLocationPanel />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-semibold text-xl tracking-tight">
                Personal apps &amp; capabilities
              </h2>
              <p className="mt-1 text-muted-foreground text-sm">
                Chat, search, voice, and images work automatically.
              </p>
            </div>
            <Link
              className="inline-flex min-h-10 items-center rounded-full border border-[color:var(--hairline)] bg-card px-3.5 font-medium text-foreground text-xs transition-colors hover:bg-muted"
              href="/setup"
            >
              Setup checklist
            </Link>
          </div>

          <ul className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card text-sm">
            <li className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <p className="font-medium text-foreground">
                  Voice dictation &amp; Live speech
                </p>
                <p className="text-muted-foreground text-xs">
                  Included automatically — speak hands-free or dictate into chat
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                <CheckCircle2Icon className="size-3.5" />
                {voice?.liveReady || voice?.serverSttReady || hasSpeechApi
                  ? "Active"
                  : "Ready"}
              </span>
            </li>

            <li className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <p className="font-medium text-foreground">Image Studio</p>
                <p className="text-muted-foreground text-xs">
                  Included automatically — ask in chat to generate images
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-medium text-xs",
                  connectors?.mediaReady || connectors?.geminiReady
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {connectors?.mediaReady || connectors?.geminiReady ? (
                  <>
                    <CheckCircle2Icon className="size-3.5" />
                    Active
                  </>
                ) : (
                  "Standby"
                )}
              </span>
            </li>

            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  Gmail, Calendar &amp; Drive
                </p>
                <p className="text-muted-foreground text-xs">
                  Read &amp; unsent drafts only — never sends emails or invites
                  without you
                </p>
              </div>
              {connectors?.gmailReady ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                    <CheckCircle2Icon className="size-3.5" />
                    Connected
                  </span>
                  <button
                    className="min-h-10 rounded-full border border-[color:var(--hairline)] px-3 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                    disabled={busyProvider === "google"}
                    onClick={() => handleDisconnect("google")}
                    type="button"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <form action={connectGoogleWorkspace}>
                  <input
                    name="returnTo"
                    type="hidden"
                    value="/usage?connected=google"
                  />
                  <button
                    className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
                    disabled={connectors?.googleSignInReady === false}
                    type="submit"
                  >
                    Connect Google
                  </button>
                </form>
              )}
            </li>

            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  GitHub Pull Requests{" "}
                  <span className="font-normal text-muted-foreground text-xs">
                    (optional)
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  Read pull requests &amp; prepare unpublished draft reviews
                </p>
              </div>
              {connectors?.githubReady ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                    <CheckCircle2Icon className="size-3.5" />
                    Connected
                  </span>
                  <button
                    className="min-h-10 rounded-full border border-[color:var(--hairline)] px-3 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                    disabled={busyProvider === "github"}
                    onClick={() => handleDisconnect("github")}
                    type="button"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <Link
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs transition-colors hover:bg-muted"
                  href="/setup"
                >
                  Open setup
                </Link>
              )}
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <div>
            <h1 className="font-semibold text-xl tracking-tight">
              Conversation usage
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Estimated API costs for this UTC month. Your provider&apos;s
              billing records and spending controls remain authoritative.
            </p>
          </div>

          {error ? (
            <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-muted-foreground text-sm">
              Usage tracking needs setup. Chat stays paused until it is ready.
            </div>
          ) : data ? (
            <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
              <div className="space-y-3 p-4">
                <p
                  className="font-medium text-[15px] text-foreground tabular-nums"
                  data-testid="usage-summary"
                >
                  Today {usd(data.dailyEstimatedUsd)} · This month{" "}
                  {usd(data.monthlyEstimatedUsd)} of $
                  {data.allowanceUsd.toFixed(2)}
                </p>

                <div
                  aria-hidden="true"
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{
                      width: `${Math.max(pct, data.monthlyEstimatedUsd > 0 ? 2 : 0)}%`,
                    }}
                  />
                </div>

                <p className="text-muted-foreground text-xs tabular-nums">
                  {data.requests} requests · {data.invocations} model calls ·{" "}
                  {data.fallbackInvocations} fallback calls (
                  {usd(data.fallbackEstimatedUsd)})
                </p>

                {data.unreportedInvocations > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Some calls did not report final usage. Their full reserved
                    estimate is included until reconciled.
                  </p>
                )}
              </div>

              {data.calls.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 font-medium text-foreground text-sm hover:bg-muted/40">
                    <span>Detailed call records ({data.calls.length})</span>
                    <span className="text-muted-foreground text-xs group-open:hidden">
                      Show
                    </span>
                    <span className="hidden text-muted-foreground text-xs group-open:inline">
                      Hide
                    </span>
                  </summary>

                  <div className="divide-y divide-[color:var(--hairline)] border-[color:var(--hairline)] border-t sm:hidden">
                    {data.calls.map((call, index) => (
                      <div
                        className="space-y-1 px-4 py-3 text-xs tabular-nums"
                        key={`m-${call.requestId}-${index}`}
                      >
                        <div className="flex items-center justify-between font-medium text-foreground">
                          <span>{call.model}</span>
                          <span>
                            {usd(Number(call.estimatedUsd ?? call.reservedUsd))}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <time>
                            {new Date(call.createdAt).toLocaleString()}
                          </time>
                          <span>{call.outcome}</span>
                        </div>
                        <div className="text-muted-foreground">
                          In {call.inputTokens ?? "—"} · Cached{" "}
                          {call.cachedInputTokens ?? "—"} · Out{" "}
                          {call.outputTokens ?? "—"}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden max-w-full overflow-x-auto border-[color:var(--hairline)] border-t px-4 py-2 sm:block">
                    <table className="w-full text-left text-xs tabular-nums">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="py-2 font-medium">Model</th>
                          <th className="py-2 font-medium">
                            Input / cached / written
                          </th>
                          <th className="py-2 font-medium">
                            Output / reasoning
                          </th>
                          <th className="py-2 font-medium">Estimated USD</th>
                          <th className="py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--hairline)]">
                        {data.calls.map((call, index) => (
                          <tr key={`${call.requestId}-${index}`}>
                            <td className="py-2.5 pr-3">
                              <span className="font-medium text-foreground">
                                {call.model}
                              </span>
                              <br />
                              <time className="text-muted-foreground">
                                {new Date(call.createdAt).toLocaleString()}
                              </time>
                            </td>
                            <td className="py-2.5 pr-3">
                              {call.inputTokens ?? "—"} /{" "}
                              {call.cachedInputTokens ?? "—"} /{" "}
                              {call.cacheWriteTokens ?? "—"}
                            </td>
                            <td className="py-2.5 pr-3">
                              {call.outputTokens ?? "—"} /{" "}
                              {call.reasoningTokens ?? "—"}
                            </td>
                            <td className="py-2.5 pr-3">
                              {usd(
                                Number(call.estimatedUsd ?? call.reservedUsd)
                              )}
                            </td>
                            <td className="py-2.5">{call.outcome}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-muted-foreground text-sm">
              Loading…
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
