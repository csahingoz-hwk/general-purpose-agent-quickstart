"use client";

import {
  ClockIcon,
  KeyRoundIcon,
  LayersIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
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

const SERVICE_SECRET_PRESETS: Record<
  string,
  { defaultName: string; hint: string }
> = {
  gemini: {
    defaultName: "GEMINI_API_KEY",
    hint: "Unlocks Live Voice sessions and Imagen/Veo Media Studio (personal use).",
  },
  google: {
    defaultName: "GOOGLE_CONNECTOR_ACCESS_TOKEN",
    hint: "Unlocks Gmail, Drive, and Calendar read & draft-only tools.",
  },
  github: {
    defaultName: "GITHUB_CONNECTOR_PAT",
    hint: "Unlocks GitHub pull request & issue reads and pending draft reviews.",
  },
  openai: {
    defaultName: "OPENAI_VOICE_API_KEY",
    hint: "Optional direct OpenAI voice transcription key.",
  },
  custom: {
    defaultName: "",
    hint: "Stored encrypted with AES-256-GCM; never exposed in prompts.",
  },
};

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
  const { mutate: globalMutate } = useSWRConfig();
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

  const [secretProvider, setSecretProvider] = useState("gemini");
  const [secretName, setSecretName] = useState("GEMINI_API_KEY");
  const [secretPlaintext, setSecretPlaintext] = useState("");

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

  async function handleSaveSecret(event: React.FormEvent) {
    event.preventDefault();
    if (!secretName.trim() || !secretPlaintext.trim()) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${basePath}/api/vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: secretName.trim(),
          provider: secretProvider.trim(),
          plaintext: secretPlaintext,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not store credential");
      }
      setSecretPlaintext("");
      setSecretName(SERVICE_SECRET_PRESETS[secretProvider]?.defaultName ?? "");
      await Promise.all([
        mutateVault(),
        globalMutate(`${basePath}/api/connectors`),
        globalMutate(`${basePath}/api/voice/transcribe`),
      ]);
      toast({
        type: "success",
        description: "Encrypted credential saved and connected.",
      });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not store credential",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSecret(name: string) {
    const response = await fetch(
      `${basePath}/api/vault?name=${encodeURIComponent(name)}`,
      { method: "DELETE" }
    );
    if (response.ok) {
      await Promise.all([
        mutateVault(),
        globalMutate(`${basePath}/api/connectors`),
        globalMutate(`${basePath}/api/voice/transcribe`),
      ]);
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
            Routines &amp; tasks
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Create recurring briefings, review background task approvals, and
            manage encrypted connector credentials.
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
            Credentials ({vaultData?.secrets.length ?? 0})
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground text-xs">
                    When to run
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

                <label className="space-y-1.5 text-sm">
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

              {scheduleChoice === "custom" && (
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
            {vaultData?.status !== "ready" && vaultData !== undefined && (
              <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-sm">
                <p className="font-medium text-foreground">
                  Credential vault is read-only on this preview server
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  To store live connector keys, configure the vault encryption
                  key and optional parity tables in an isolated environment.
                </p>
              </div>
            )}

            <form
              className="space-y-4 rounded-2xl border border-[color:var(--hairline)] bg-card p-4"
              onSubmit={handleSaveSecret}
            >
              <div>
                <h2 className="font-semibold text-[15px]">
                  Save encrypted credential
                </h2>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  Encrypted on the server with AES-256-GCM. Values are never
                  shown again or included in chat prompts.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground text-xs">Service</span>
                  <select
                    className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                    onChange={(e) => {
                      const nextProvider = e.target.value;
                      setSecretProvider(nextProvider);
                      const preset = SERVICE_SECRET_PRESETS[nextProvider];
                      if (preset) {
                        setSecretName(preset.defaultName);
                      }
                    }}
                    value={secretProvider}
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="google">Google Workspace</option>
                    <option value="github">GitHub</option>
                    <option value="openai">OpenAI</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>

                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground text-xs">
                    Credential name
                  </span>
                  <input
                    className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 font-mono text-[15px] text-foreground"
                    onChange={(e) => setSecretName(e.target.value)}
                    placeholder="e.g. GEMINI_API_KEY"
                    required
                    value={secretName}
                  />
                </label>
              </div>

              {SERVICE_SECRET_PRESETS[secretProvider]?.hint && (
                <p className="text-muted-foreground text-xs">
                  {SERVICE_SECRET_PRESETS[secretProvider]?.hint}
                </p>
              )}

              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground text-xs">
                  API key or token
                </span>
                <input
                  autoComplete="off"
                  className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                  onChange={(e) => setSecretPlaintext(e.target.value)}
                  placeholder="Paste key or token"
                  required
                  type="password"
                  value={secretPlaintext}
                />
              </label>

              <div className="flex justify-end">
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
                  disabled={busy || vaultData?.status !== "ready"}
                  type="submit"
                >
                  <PlusIcon className="size-4" />
                  Encrypt &amp; save
                </button>
              </div>
            </form>

            {(vaultData?.secrets ?? []).length === 0 ? (
              <p className="rounded-2xl border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                No credentials saved yet.
              </p>
            ) : (
              <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
                {vaultData?.secrets.map((secret) => (
                  <article
                    className="flex items-center justify-between gap-3 p-4"
                    key={secret.id}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground text-sm">
                          {secret.name}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                          {secret.provider}
                        </span>
                      </div>
                      <p className="font-mono text-muted-foreground text-xs">
                        {secret.keyHint} · updated{" "}
                        {new Date(secret.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      aria-label={`Revoke ${secret.name}`}
                      className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteSecret(secret.name)}
                      type="button"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
