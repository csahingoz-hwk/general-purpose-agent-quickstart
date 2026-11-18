"use client";

import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  GlobeIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { HomeLocationPanel } from "@/components/chat/home-location";
import { MascotPicker } from "@/components/chat/mascot-preference";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import { type UiLocalePreference, useUiLocale } from "@/hooks/use-ui-locale";
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
  outcome: string;
};

type PerModelUsageRow = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  referenceCostUsd: number;
};

type GcpBillingPayload = {
  reachable: boolean;
  source: "gcp_bigquery_and_budgets" | "gcp_budgets_only" | "app_token_logs";
  projectId: string | null;
  billingAccountId: string;
  currency: string;
  monthlyCreditLimitUsd: number;
  mtdGrossCostUsd: number | null;
  mtdCreditsUsedUsd: number | null;
  creditsRemainingUsd: number | null;
  missingReason: string | null;
  setupActionUrl: string;
  setupActionLabel: string;
  checkedAt: string;
};

type UsageResponse = {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  requests: number;
  invocations: number;
  fallbackInvocations: number;
  byModel?: PerModelUsageRow[];
  gcpBilling?: GcpBillingPayload;
  calls: UsageCall[];
};

const MODEL_FRIENDLY_LABELS: Record<string, string> = {
  "gemini-4-hydrogen": "Gemini 4 Hydrogen (Vertex)",
  "gemini-4-argon": "Gemini 4 Argon (Vertex)",
  "claude-haiku-5.5": "Claude Haiku 5.5 (Copilot)",
};

function deriveRowsFromCalls(calls: UsageCall[]): PerModelUsageRow[] {
  const map = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number }
  >([
    ["gemini-4-hydrogen", { calls: 0, inputTokens: 0, outputTokens: 0 }],
    ["gemini-4-argon", { calls: 0, inputTokens: 0, outputTokens: 0 }],
    ["claude-haiku-5.5", { calls: 0, inputTokens: 0, outputTokens: 0 }],
  ]);
  for (const c of calls) {
    const cur = map.get(c.model) ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    cur.calls += 1;
    cur.inputTokens += Number(c.inputTokens ?? 0);
    cur.outputTokens += Number(c.outputTokens ?? 0);
    map.set(c.model, cur);
  }
  return [...map.entries()].map(([model, agg]) => {
    const refRate =
      model === "gemini-4-argon"
        ? (agg.inputTokens / 1_000_000) * 1.25 +
          (agg.outputTokens / 1_000_000) * 5
        : model === "gemini-4-hydrogen"
          ? (agg.inputTokens / 1_000_000) * 0.15 +
            (agg.outputTokens / 1_000_000) * 0.6
          : 0;
    return {
      model,
      calls: agg.calls,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      totalTokens: agg.inputTokens + agg.outputTokens,
      referenceCostUsd: Math.round(refRate * 10_000) / 10_000,
    };
  });
}

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
  const { mutate: globalMutate } = useSWRConfig();
  const { theme, setTheme } = useTheme();
  const { preference: localePref, copy, setLocalePreference } = useUiLocale();
  const [hasSpeechApi, setHasSpeechApi] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [savingApprovalSetting, setSavingApprovalSetting] = useState(false);

  const { data: approvalPrefs, mutate: mutateApprovalPrefs } = useSWR<{
    approvalMode?: "ask_every_time" | "draft_without_asking";
    uiLocale?: UiLocalePreference;
    rules?: Array<{
      id: string;
      toolName: string;
      decision: "always_allow" | "never_allow";
      updatedAt: string;
    }>;
  }>(`${basePath}/api/settings/approvals`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  async function handleSelectApprovalMode(
    nextMode: "ask_every_time" | "draft_without_asking"
  ) {
    setSavingApprovalSetting(true);
    try {
      const res = await fetch(`${basePath}/api/settings/approvals`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalMode: nextMode }),
      });
      if (res.ok) {
        await mutateApprovalPrefs();
        toast({
          type: "success",
          description:
            nextMode === "draft_without_asking"
              ? copy.approvalModeDraftFirst
              : copy.approvalModeAskEveryTime,
        });
      }
    } finally {
      setSavingApprovalSetting(false);
    }
  }

  async function handleUndoToolRule(toolName: string) {
    setSavingApprovalSetting(true);
    try {
      const res = await fetch(
        `${basePath}/api/settings/approvals?toolName=${encodeURIComponent(toolName)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await mutateApprovalPrefs();
        toast({
          type: "success",
          description: `${toolName}: ${copy.undoRule}`,
        });
      }
    } finally {
      setSavingApprovalSetting(false);
    }
  }

  async function handleSelectLanguage(nextLocale: UiLocalePreference) {
    setLocalePreference(nextLocale);
    await fetch(`${basePath}/api/settings/approvals`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiLocale: nextLocale }),
    }).catch(() => null);
  }

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
    });
  const { data: setupStatus } = useSWR<{
    googleConnected?: boolean;
    githubConnected?: boolean;
    googleSignInReady?: boolean;
  }>(`${basePath}/api/setup-status`, fetcher, {
    revalidateOnFocus: false,
  });
  const connectorsLoading = !connectors && !setupStatus;
  const googleConnected =
    connectors?.gmailReady !== undefined
      ? Boolean(connectors.gmailReady)
      : Boolean(setupStatus?.googleConnected);
  const githubConnected =
    connectors?.githubReady !== undefined
      ? Boolean(connectors.githubReady)
      : Boolean(setupStatus?.githubConnected);
  const googleSignInReady =
    connectors?.googleSignInReady ?? setupStatus?.googleSignInReady ?? true;

  const { data: voice } = useSWR<VoiceReadinessResponse>(
    `${basePath}/api/voice/transcribe`,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const { data: memorySummary } = useSWR<{
    profileFacts?: unknown[];
    journalEntries?: unknown[];
  }>(`${basePath}/api/memory`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const savedMemoriesCount = memorySummary?.profileFacts?.length ?? 0;

  async function handleDisconnect(provider: "google" | "github") {
    setBusyProvider(provider);
    try {
      const res = await fetch(
        `${basePath}/api/connectors?provider=${provider}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await Promise.all([
          mutateConnectors(),
          globalMutate(`${basePath}/api/setup-status`),
        ]);
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

            <div
              className="space-y-2.5 p-4"
              data-testid="settings-language-picker"
            >
              <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <GlobeIcon className="size-3.5" />
                <span>{copy.languageLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "auto", label: copy.languageAuto },
                    { id: "en", label: copy.languageEnglish },
                    { id: "tr", label: copy.languageTurkish },
                  ] as const
                ).map((item) => {
                  const active = localePref === item.id;
                  return (
                    <button
                      aria-pressed={active}
                      className={cn(
                        "inline-flex min-h-11 items-center justify-center rounded-full border px-3 font-medium text-sm transition-colors",
                        active
                          ? "border-transparent bg-foreground text-background"
                          : "border-[color:var(--hairline)] bg-background text-foreground hover:bg-muted"
                      )}
                      data-testid={`language-option-${item.id}`}
                      key={item.id}
                      onClick={() => handleSelectLanguage(item.id)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section
          className="space-y-3"
          data-testid="settings-approval-preferences"
        >
          <div>
            <h2 className="font-semibold text-xl tracking-tight">
              {copy.approvalSettingsHeading}
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              {copy.approvalSettingsDescription}
            </p>
          </div>

          <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
            <div className="space-y-2.5 p-4">
              {(
                [
                  {
                    id: "ask_every_time",
                    title: copy.approvalModeAskEveryTime,
                    desc: copy.approvalModeAskEveryTimeDesc,
                    testId: "approval-mode-ask-every-time",
                  },
                  {
                    id: "draft_without_asking",
                    title: copy.approvalModeDraftFirst,
                    desc: copy.approvalModeDraftFirstDesc,
                    testId: "approval-mode-draft-first",
                  },
                ] as const
              ).map((option) => {
                const currentMode =
                  approvalPrefs?.approvalMode ?? "ask_every_time";
                const active = currentMode === option.id;
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-[color:var(--hairline)] bg-background hover:bg-muted/40"
                    )}
                    data-testid={option.testId}
                    disabled={savingApprovalSetting}
                    key={option.id}
                    onClick={() => handleSelectApprovalMode(option.id)}
                    type="button"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-foreground text-sm">
                        {option.title}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {option.desc}
                      </p>
                    </div>
                    <ShieldCheckIcon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        active ? "text-primary" : "text-muted-foreground/40"
                      )}
                    />
                  </button>
                );
              })}
            </div>

            <div
              className="space-y-2.5 p-4"
              data-testid="settings-tool-rules-list"
            >
              <p className="font-medium text-foreground text-sm">
                {copy.toolRulesHeading}
              </p>
              {!approvalPrefs?.rules || approvalPrefs.rules.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {copy.toolRulesEmpty}
                </p>
              ) : (
                <ul className="divide-y divide-[color:var(--hairline)] rounded-xl border border-[color:var(--hairline)] bg-background text-sm">
                  {approvalPrefs.rules.map((rule) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                      data-testid={`tool-rule-row-${rule.toolName}`}
                      key={rule.id}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-foreground text-xs">
                          {rule.toolName}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[11px]",
                            rule.decision === "always_allow"
                              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                              : "bg-destructive/12 text-destructive"
                          )}
                        >
                          {rule.decision === "always_allow"
                            ? copy.ruleBadgeAlwaysAllow
                            : copy.ruleBadgeNeverAllow}
                        </span>
                      </div>
                      <button
                        className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[color:var(--hairline)] px-3 font-medium text-foreground text-xs hover:bg-muted disabled:opacity-50"
                        data-testid={`undo-tool-rule-${rule.toolName}`}
                        disabled={savingApprovalSetting}
                        onClick={() => handleUndoToolRule(rule.toolName)}
                        type="button"
                      >
                        <RotateCcwIcon className="size-3" />
                        {copy.undoRule}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3" data-testid="settings-memory-section">
          <div>
            <h2 className="font-semibold text-xl tracking-tight">
              Memory · Bellek
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Paste a long list of personal facts, edit or search saved
              memories, or export everything. Stored in private Postgres and
              used automatically in chat and voice.
            </p>
          </div>

          <Link
            className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--hairline)] bg-card p-4 transition-colors hover:bg-muted/40"
            data-testid="settings-open-memory"
            href="/memory"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <BookOpenIcon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-[15px] text-foreground">
                  Manage memories &amp; paste list
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {savedMemoriesCount} saved{" "}
                  {savedMemoriesCount === 1 ? "memory" : "memories"} · Search,
                  edit, delete &amp; export
                </p>
              </div>
            </div>
            <span className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 font-medium text-primary-foreground text-xs">
              Open
              <ChevronRightIcon className="size-3.5" />
            </span>
          </Link>
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
              {connectorsLoading ? (
                <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground text-xs">
                  Checking…
                </span>
              ) : googleConnected ? (
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
              ) : googleSignInReady ? (
                <a
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
                  href={`${basePath}/connect/google/start?returnTo=${encodeURIComponent("/usage?connected=google")}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Connect Google
                </a>
              ) : (
                <button
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs opacity-50"
                  disabled
                  type="button"
                >
                  Connect Google
                </button>
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
              {githubConnected ? (
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

        <section className="space-y-3" data-testid="vertex-usage-section">
          <div>
            <h1
              aria-label="Conversation usage"
              className="font-semibold text-xl tracking-tight"
            >
              Vertex AI &amp; Aylık Kredi Özeti
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Harcama ve bütçe uyarıları doğrudan Google Cloud üzerinde
              yönetilir; uygulama içinde hiçbir yanıt engeli veya yapay kota
              yoktur.
            </p>
          </div>

          {(() => {
            const rows = data
              ? (data.byModel ?? deriveRowsFromCalls(data.calls))
              : null;
            const gcp = data?.gcpBilling;
            const monthlyPool = gcp?.monthlyCreditLimitUsd ?? 40;
            const totalRefUsd = (rows ?? []).reduce(
              (sum, r) => sum + r.referenceCostUsd,
              0
            );
            const effectiveUsedUsd =
              gcp?.reachable && gcp.mtdCreditsUsedUsd !== null
                ? gcp.mtdCreditsUsedUsd
                : totalRefUsd;
            const effectiveRemainingUsd =
              gcp?.reachable && gcp.creditsRemainingUsd !== null
                ? gcp.creditsRemainingUsd
                : Math.max(0, monthlyPool - totalRefUsd);
            const fmtUsd = (val: number) => `$${val.toFixed(2)}`;

            return (
              <div className="divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-card">
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      Ay İçi Kredi Kullanımı
                    </p>
                    <p
                      className="mt-0.5 font-semibold text-base text-foreground tabular-nums"
                      data-testid="usage-summary"
                    >
                      {rows ? fmtUsd(effectiveUsedUsd) : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {gcp?.reachable
                        ? "Google Cloud gerçek veri"
                        : "Token referans tahmini"}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">Kalan Kredi</p>
                    <p className="mt-0.5 font-semibold text-base text-emerald-700 tabular-nums dark:text-emerald-300">
                      {rows
                        ? `${gcp?.reachable ? "" : "~"}${fmtUsd(effectiveRemainingUsd)}`
                        : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      /${monthlyPool.toFixed(2)} Ultra kredi
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      Toplam Token (Ay)
                    </p>
                    <p className="mt-0.5 font-semibold text-base text-foreground tabular-nums">
                      {data
                        ? (
                            (data.totalInputTokens ?? 0) +
                            (data.totalOutputTokens ?? 0)
                          ).toLocaleString()
                        : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {data ? `${data.invocations} model çağrısı` : "Bu ay"}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">
                      Net Nakit Maliyet
                    </p>
                    <p className="mt-0.5 font-semibold text-base text-foreground tabular-nums">
                      $0.00
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Ultra kredi + Copilot aboneliği
                    </p>
                  </div>
                </div>

                {gcp && !gcp.reachable && gcp.missingReason && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 bg-muted/35 px-4 py-3 text-xs"
                    data-testid="gcp-billing-setup-banner"
                  >
                    <p className="min-w-0 flex-1 text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Canlı Google Cloud fatura verisi bekleniyor:{" "}
                      </span>
                      {gcp.missingReason} Aşağıda uygulama içi aylık token
                      kayıtları gösteriliyor.
                    </p>
                    <Link
                      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs hover:bg-muted"
                      href="/setup#setup-gcp_billing"
                    >
                      Kurulumda aç
                    </Link>
                  </div>
                )}

                {error && !data && (
                  <div className="px-4 py-3 text-muted-foreground text-xs">
                    Kullanım tablosu şu an yenilenemedi; sohbet kesintisiz devam
                    eder.
                  </div>
                )}

                <div className="w-full overflow-x-auto">
                  <table
                    className="w-full text-left text-xs tabular-nums"
                    data-testid="vertex-finance-table"
                  >
                    <thead className="border-[color:var(--hairline)] border-b bg-muted/25 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Model</th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          Token (Giriş / Çıkış)
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          Tahmini Maliyet
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Kalan Kredi
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--hairline)]">
                      {rows
                        ? rows.map((row) => {
                            const isCopilot = row.model === "claude-haiku-5.5";
                            return (
                              <tr key={row.model}>
                                <td className="max-w-[140px] break-words px-4 py-2.5 sm:max-w-none">
                                  <span className="font-medium text-foreground">
                                    {MODEL_FRIENDLY_LABELS[row.model] ??
                                      row.model}
                                  </span>
                                  <span className="block text-[11px] text-muted-foreground">
                                    {row.calls} çağrı
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right text-foreground">
                                  {row.totalTokens.toLocaleString()}
                                  <span className="block text-[11px] text-muted-foreground">
                                    {row.inputTokens.toLocaleString()} G /{" "}
                                    {row.outputTokens.toLocaleString()} Ç
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right text-foreground">
                                  {isCopilot
                                    ? "$0.00 (Abonelik)"
                                    : `$${row.referenceCostUsd.toFixed(4)}`}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted-foreground">
                                  {isCopilot
                                    ? "Copilot dahil"
                                    : `${gcp?.reachable ? "" : "~"}${fmtUsd(effectiveRemainingUsd)}`}
                                </td>
                              </tr>
                            );
                          })
                        : ["r1", "r2", "r3"].map((sk) => (
                            <tr key={sk}>
                              <td className="px-4 py-3">
                                <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                              </td>
                              <td className="px-3 py-3 text-right">
                                <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-muted" />
                              </td>
                              <td className="px-3 py-3 text-right">
                                <div className="ml-auto h-3.5 w-14 animate-pulse rounded bg-muted" />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-muted" />
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </section>
      </div>
    </main>
  );
}
