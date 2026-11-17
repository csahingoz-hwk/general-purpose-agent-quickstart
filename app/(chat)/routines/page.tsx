"use client";

import {
  CheckCircle2Icon,
  ClockIcon,
  KeyRoundIcon,
  LayersIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR from "swr";
import { connectGoogleWorkspace } from "@/app/(auth)/actions";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import { cn, fetcher } from "@/lib/utils";

type ScheduleRow = {
  id: string;
  cronExpression: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastError: string | null;
  lastOutput: string | null;
  createdAt: string;
};

type PresetItem = {
  id: string;
  label: string;
  description: string;
  cronExpression: string;
  timezone: string;
  prompt: string;
};

type SchedulesResponse = {
  schedules: ScheduleRow[];
  presets?: PresetItem[];
  routinesEnabled?: boolean;
};

type TaskItem = {
  id: string;
  kind: string;
  title: string;
  prompt: string;
  status: string;
  riskLevel: string;
  steps: Array<{ step: number; message: string; timestamp: string }>;
  output: string | null;
  error: string | null;
  createdAt: string;
};

type TasksResponse = {
  status: "ready" | "setup_required";
  tasks: TaskItem[];
};

type VaultItem = {
  id: string;
  name: string;
  provider: string;
  keyHint: string;
  updatedAt: string;
};

type VaultResponse = {
  status: "ready" | "key_missing" | "setup_required";
  secrets: VaultItem[];
};

const SCHEDULE_OPTIONS = [
  { label: "Weekdays at 08:00", cron: "0 8 * * 1-5" },
  { label: "Weekdays at 07:30", cron: "30 7 * * 1-5" },
  { label: "Every day at 09:00", cron: "0 9 * * *" },
  { label: "Fridays at 17:00", cron: "0 17 * * 5" },
  { label: "Month-end days 1–5 at 08:30", cron: "30 8 1-5 * *" },
  { label: "Custom schedule…", cron: "custom" },
] as const;

function describeCron(cron: string): string {
  const match = SCHEDULE_OPTIONS.find((opt) => opt.cron === cron);
  return match ? match.label : cron;
}

export default function RoutinesPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
      <RoutinesPageContent />
    </Suspense>
  );
}

function RoutinesPageContent() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"routines" | "tasks" | "vault">("routines");

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (
      requested === "vault" ||
      requested === "tasks" ||
      requested === "routines"
    ) {
      setTab(requested);
    }
  }, [searchParams]);

  const [scheduleChoice, setScheduleChoice] = useState<string>("0 8 * * 1-5");
  const [cronExpression, setCronExpression] = useState("0 8 * * 1-5");
  const [timezone, setTimezone] = useState("Europe/London");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) {
        setTimezone(detected);
      }
    } catch {
      /* keep default */
    }
  }, []);

  const { data: schedulesData, mutate: mutateSchedules } =
    useSWR<SchedulesResponse>(`${basePath}/api/schedules`, fetcher);

  const { data: tasksData, mutate: mutateTasks } = useSWR<TasksResponse>(
    `${basePath}/api/tasks`,
    fetcher
  );

  const { data: vaultData, mutate: mutateVault } = useSWR<VaultResponse>(
    `${basePath}/api/vault`,
    fetcher
  );
  const { data: connectorsData, mutate: mutateConnectors } = useSWR<{
    gmailReady?: boolean;
    githubReady?: boolean;
    googleSignInReady?: boolean;
  }>(`${basePath}/api/connectors`, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  async function handleCreateRoutine(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${basePath}/api/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cronExpression: cronExpression.trim(),
          timezone: timezone.trim(),
          prompt: prompt.trim(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not create routine");
      }
      setPrompt("");
      await mutateSchedules();
      toast({ type: "success", description: "Routine saved." });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not create routine",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleRoutine(id: string, enabled: boolean) {
    const response = await fetch(`${basePath}/api/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (response.ok) {
      await mutateSchedules();
    } else {
      toast({ type: "error", description: "Could not update routine." });
    }
  }

  async function handleRunNow(id: string) {
    const response = await fetch(`${basePath}/api/schedules/${id}`, {
      method: "POST",
    });
    if (response.ok) {
      await Promise.all([mutateSchedules(), mutateTasks()]);
      setTab("tasks");
      toast({
        type: "success",
        description: "Preview run queued in Background tasks.",
      });
    } else {
      const body = await response.json().catch(() => ({}));
      toast({
        type: "error",
        description: body.error ?? "Could not enqueue routine run.",
      });
    }
  }

  async function handleDeleteRoutine(id: string) {
    const response = await fetch(`${basePath}/api/schedules/${id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      await mutateSchedules();
    }
  }

  async function handleCancelTask(id: string) {
    const response = await fetch(`${basePath}/api/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "cancel" }),
    });
    if (response.ok) {
      await mutateTasks();
    }
  }

  async function handleApproveTask(id: string) {
    const response = await fetch(`${basePath}/api/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "approve" }),
    });
    if (response.ok) {
      await mutateTasks();
      toast({
        type: "success",
        description: "Task approved.",
      });
    }
  }

  return (
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader
          badge={
            <span className="rounded-full border border-[color:var(--hairline)] bg-card px-3 py-1 text-muted-foreground text-xs">
              {vaultData?.status === "ready" ? "Vault active" : "Preview mode"}
            </span>
          }
        />

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Routines &amp; connections
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Create recurring briefings, inspect background tasks, and connect
            your accounts in one tap.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "routines"
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("routines")}
            type="button"
          >
            <ClockIcon className="size-4" />
            Routines ({schedulesData?.schedules.length ?? 0})
          </button>
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "tasks"
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("tasks")}
            type="button"
          >
            <LayersIcon className="size-4" />
            Tasks ({tasksData?.tasks.length ?? 0})
          </button>
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "vault"
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("vault")}
            type="button"
          >
            <KeyRoundIcon className="size-4" />
            Connections ({vaultData?.secrets.length ?? 0})
          </button>
        </div>

        {tab === "routines" && (
          <div className="space-y-4">
            {schedulesData?.presets && schedulesData.presets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {schedulesData.presets.map((preset) => (
                  <button
                    className="min-h-10 rounded-full border border-[color:var(--hairline)] bg-card px-3.5 text-foreground text-xs hover:bg-muted"
                    key={preset.id}
                    onClick={() => {
                      const known = SCHEDULE_OPTIONS.find(
                        (opt) => opt.cron === preset.cronExpression
                      );
                      setScheduleChoice(
                        known ? preset.cronExpression : "custom"
                      );
                      setCronExpression(preset.cronExpression);
                      setTimezone(preset.timezone);
                      setPrompt(preset.prompt);
                    }}
                    title={preset.description}
                    type="button"
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            )}

            <form
              className="space-y-4 rounded-2xl border border-[color:var(--hairline)] bg-card p-4"
              onSubmit={handleCreateRoutine}
            >
              <h2 className="font-semibold text-[15px]">New routine</h2>

              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground text-xs">
                  When to run ({timezone})
                </span>
                <select
                  className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                  onChange={(e) => {
                    const val = e.target.value;
                    setScheduleChoice(val);
                    if (val !== "custom") {
                      setCronExpression(val);
                    }
                  }}
                  value={scheduleChoice}
                >
                  {SCHEDULE_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.cron}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              {scheduleChoice === "custom" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-muted-foreground text-xs">
                      Custom 5-field cron schedule
                    </span>
                    <input
                      className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 font-mono text-[16px] text-foreground"
                      onChange={(e) => setCronExpression(e.target.value)}
                      placeholder="0 8 * * 1-5"
                      required
                      value={cronExpression}
                    />
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-muted-foreground text-xs">
                      Time zone
                    </span>
                    <input
                      className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Europe/London"
                      required
                      value={timezone}
                    />
                  </label>
                </div>
              )}

              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground text-xs">
                  Instructions for the assistant
                </span>
                <textarea
                  className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px] text-foreground"
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Summarise today's calendar and top priorities in 5 bullet points."
                  required
                  value={prompt}
                />
              </label>

              <div className="flex justify-end">
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
                  disabled={busy}
                  type="submit"
                >
                  <PlusIcon className="size-4" />
                  Save routine
                </button>
              </div>
            </form>

            {(schedulesData?.schedules ?? []).length === 0 ? (
              <p className="rounded-2xl border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                No routines saved yet. Pick a preset above or create your own.
              </p>
            ) : (
              <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
                {schedulesData?.schedules.map((job) => (
                  <article className="space-y-3 p-4" key={job.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground text-sm">
                          {describeCron(job.cronExpression)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {job.timezone}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 font-medium text-xs",
                            job.enabled
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {job.enabled ? "Active" : "Paused"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-3.5 text-xs hover:bg-muted"
                          onClick={() => handleRunNow(job.id)}
                          type="button"
                        >
                          <PlayIcon className="size-3.5" />
                          Test run
                        </button>
                        <button
                          aria-label={
                            job.enabled ? "Pause routine" : "Resume routine"
                          }
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-3.5 text-xs hover:bg-muted"
                          onClick={() =>
                            handleToggleRoutine(job.id, !job.enabled)
                          }
                          type="button"
                        >
                          <PauseIcon className="size-3.5" />
                          {job.enabled ? "Pause" : "Resume"}
                        </button>
                        <button
                          aria-label="Delete routine"
                          className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDeleteRoutine(job.id)}
                          type="button"
                        >
                          <Trash2Icon className="size-4" />
                        </button>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-[15px]">
                      {job.prompt}
                    </p>
                    {job.lastOutput && (
                      <p className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-[13px] text-foreground">
                        {job.lastOutput}
                      </p>
                    )}
                    <p className="text-muted-foreground text-xs tabular-nums">
                      Next window: {new Date(job.nextRunAt).toLocaleString()} ·
                      Last run:{" "}
                      {job.lastRunAt
                        ? new Date(job.lastRunAt).toLocaleString()
                        : "never"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "tasks" && (
          <div className="space-y-3">
            {tasksData?.status === "setup_required" && (
              <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-sm">
                <p className="font-medium text-foreground">
                  Background task storage isn&apos;t connected on this preview
                  database yet
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Normal chat works as usual. Persistent background runs unlock
                  once the optional task tables are enabled on an isolated
                  database.
                </p>
              </div>
            )}

            {(tasksData?.tasks ?? []).length === 0 ? (
              <p className="rounded-2xl border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                No background tasks running right now.
              </p>
            ) : (
              <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
                {tasksData?.tasks.map((task) => (
                  <article className="space-y-2.5 p-4" key={task.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[15px]">
                          {task.title}
                        </h3>
                        <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-xs">
                          {task.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {task.status === "awaiting_approval" && (
                          <button
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-foreground px-3.5 font-medium text-background text-xs"
                            onClick={() => handleApproveTask(task.id)}
                            type="button"
                          >
                            <PlayIcon className="size-3.5" />
                            Approve
                          </button>
                        )}
                        {(task.status === "queued" ||
                          task.status === "running" ||
                          task.status === "awaiting_approval") && (
                          <button
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-3.5 text-xs hover:bg-muted"
                            onClick={() => handleCancelTask(task.id)}
                            type="button"
                          >
                            <XCircleIcon className="size-3.5" />
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    {task.output && (
                      <p className="rounded-xl bg-muted/50 p-3 text-[13px] text-muted-foreground">
                        {task.output}
                      </p>
                    )}
                    {task.steps.length > 0 && (
                      <ul className="space-y-1 text-muted-foreground text-xs">
                        {task.steps.map((step) => (
                          <li key={`${task.id}-${step.step}`}>
                            {step.step}. {step.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "vault" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-sm">
              <p className="font-medium text-foreground">
                Included automatically — no API keys needed
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                Everyday &amp; Detailed Chat, Web Search, Voice Dictation, Live
                Speech, and Image Studio all work out of the box with your
                sign-in.
              </p>
            </div>

            <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-semibold text-[15px] text-foreground">
                    Google Gmail, Calendar &amp; Drive
                  </p>
                  <p className="text-muted-foreground text-xs">
                    One-tap Google sign-in · read &amp; unsent drafts only,
                    never sends without your approval.
                  </p>
                </div>
                {connectorsData?.gmailReady ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                      <CheckCircle2Icon className="size-3.5" />
                      Connected
                    </span>
                    <button
                      className="min-h-11 rounded-full border border-[color:var(--hairline)] px-3.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                      onClick={async () => {
                        await fetch(
                          `${basePath}/api/connectors?provider=google`,
                          { method: "DELETE" }
                        );
                        await Promise.all([mutateVault(), mutateConnectors()]);
                      }}
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
                      value="/routines?tab=vault"
                    />
                    <button
                      className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
                      disabled={connectorsData?.googleSignInReady === false}
                      type="submit"
                    >
                      Connect Google
                    </button>
                  </form>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-semibold text-[15px] text-foreground">
                    GitHub Pull Requests{" "}
                    <span className="font-normal text-muted-foreground text-xs">
                      (optional)
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Read PRs &amp; issues and prepare unpublished draft reviews.
                  </p>
                </div>
                {connectorsData?.githubReady ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                      <CheckCircle2Icon className="size-3.5" />
                      Connected
                    </span>
                    <button
                      className="min-h-11 rounded-full border border-[color:var(--hairline)] px-3.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                      onClick={async () => {
                        await fetch(
                          `${basePath}/api/connectors?provider=github`,
                          { method: "DELETE" }
                        );
                        await Promise.all([mutateVault(), mutateConnectors()]);
                      }}
                      type="button"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <Link
                    className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-xs transition-colors hover:bg-muted"
                    href="/setup"
                  >
                    Setup checklist
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
