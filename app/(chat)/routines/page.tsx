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
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { getCopy } from "@/lib/ui-copy";
import { cn, fetcher } from "@/lib/utils";

const copy = getCopy();

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

export default function RoutinesPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [tab, setTab] = useState<"routines" | "tasks" | "vault">("routines");

  const [cronExpression, setCronExpression] = useState("0 8 * * 1-5");
  const [timezone, setTimezone] = useState("Europe/London");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const [secretName, setSecretName] = useState("");
  const [secretProvider, setSecretProvider] = useState("custom");
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
        description: "Enqueued preview run in Background Tasks.",
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
        throw new Error(body.error ?? "Could not store secret");
      }
      setSecretName("");
      setSecretPlaintext("");
      await mutateVault();
      toast({
        type: "success",
        description: "Encrypted secret stored (plaintext cleared).",
      });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not store secret",
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
      await mutateVault();
    }
  }

  return (
    <main className="h-dvh w-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6 px-4 py-6 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--hairline)] bg-card px-4 font-medium text-foreground text-sm hover:bg-muted"
            href="/"
          >
            {copy.backToChat}
          </Link>
          <span className="rounded-full border border-[color:var(--hairline)] bg-card px-3 py-1 text-muted-foreground text-xs">
            Unattended cloud cron: paused (safe preview mode)
          </span>
        </div>

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Routines, tasks &amp; vault
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Manage recurring routines, inspect background task runs, and store
            AES-256-GCM encrypted connector credentials.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "routines"
                ? "border-primary bg-primary text-primary-foreground"
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
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("tasks")}
            type="button"
          >
            <LayersIcon className="size-4" />
            Background tasks ({tasksData?.tasks.length ?? 0})
          </button>
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "vault"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("vault")}
            type="button"
          >
            <KeyRoundIcon className="size-4" />
            Secret vault ({vaultData?.secrets.length ?? 0})
          </button>
        </div>

        {tab === "routines" && (
          <div className="space-y-4">
            {schedulesData?.presets && schedulesData.presets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {schedulesData.presets.map((preset) => (
                  <button
                    className="min-h-11 rounded-full border border-[color:var(--hairline)] bg-card px-3.5 text-foreground text-xs hover:bg-muted"
                    key={preset.id}
                    onClick={() => {
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
              className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
              onSubmit={handleCreateRoutine}
            >
              <h2 className="font-semibold text-[15px]">Create routine</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  aria-label="Cron expression"
                  className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 font-mono text-[16px]"
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 8 * * 1-5"
                  required
                  value={cronExpression}
                />
                <input
                  aria-label="Timezone"
                  className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Europe/London"
                  required
                  value={timezone}
                />
              </div>
              <textarea
                className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px]"
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Self-contained instruction for the assistant when this routine fires…"
                required
                value={prompt}
              />
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

            <div className="space-y-3">
              {(schedulesData?.schedules ?? []).length === 0 ? (
                <p className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                  No routines saved yet. Pick a preset above or create one.
                </p>
              ) : (
                schedulesData?.schedules.map((job) => (
                  <article
                    className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
                    key={job.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded-lg bg-muted px-2 py-0.5 font-mono text-xs">
                          {job.cronExpression}
                        </code>
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
                          Preview run
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
                    <p className="text-muted-foreground text-xs">
                      Next scheduled window:{" "}
                      <span className="font-mono">
                        {new Date(job.nextRunAt).toLocaleString()}
                      </span>
                      {" · "}Last run:{" "}
                      <span className="font-mono">
                        {job.lastRunAt
                          ? new Date(job.lastRunAt).toLocaleString()
                          : "never"}
                      </span>
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "tasks" && (
          <div className="space-y-3">
            {tasksData?.status === "setup_required" && (
              <section className="rounded-[22px] border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                Apply <code>lib/db/parity-schema.sql</code> to your approved
                Postgres database to persist BackgroundTask runs.
              </section>
            )}
            {(tasksData?.tasks ?? []).length === 0 ? (
              <p className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                No background tasks yet. Trigger a Preview run from Routines to
                inspect step logs.
              </p>
            ) : (
              tasksData?.tasks.map((task) => (
                <article
                  className="space-y-2 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
                  key={task.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[15px]">
                        {task.title}
                      </h3>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-xs">
                        {task.status}
                      </span>
                    </div>
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
                  {task.output && (
                    <p className="rounded-xl bg-muted/40 p-3 text-[13px] text-muted-foreground">
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
              ))
            )}
          </div>
        )}

        {tab === "vault" && (
          <div className="space-y-4">
            {vaultData?.status === "key_missing" && (
              <section className="rounded-[22px] border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                Set a ≥32-character <code>SECRET_VAULT_KEY</code> in your server
                environment before storing encrypted credentials.
              </section>
            )}
            {vaultData?.status === "setup_required" && (
              <section className="rounded-[22px] border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                Apply <code>lib/db/parity-schema.sql</code> to your approved
                Postgres database to enable VaultSecret storage.
              </section>
            )}

            <form
              className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
              onSubmit={handleSaveSecret}
            >
              <h2 className="font-semibold text-[15px]">
                Store encrypted credential
              </h2>
              <p className="text-muted-foreground text-xs">
                Encrypted server-side with AES-256-GCM + AAD. Plaintext is never
                returned to the browser or model prompts.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 font-mono text-[16px]"
                  onChange={(e) => setSecretName(e.target.value)}
                  placeholder="Name (e.g. GITHUB_READ_PAT)"
                  required
                  value={secretName}
                />
                <input
                  className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
                  onChange={(e) => setSecretProvider(e.target.value)}
                  placeholder="Provider (e.g. github, google)"
                  value={secretProvider}
                />
              </div>
              <input
                autoComplete="off"
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 font-mono text-[16px]"
                onChange={(e) => setSecretPlaintext(e.target.value)}
                placeholder="Secret value (never logged or echoed)"
                required
                type="password"
                value={secretPlaintext}
              />
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

            <div className="space-y-2.5">
              {(vaultData?.secrets ?? []).length === 0 ? (
                <p className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                  No secrets stored in vault.
                </p>
              ) : (
                vaultData?.secrets.map((secret) => (
                  <article
                    className="flex items-center justify-between gap-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
                    key={secret.id}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-semibold text-sm">
                          {secret.name}
                        </code>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
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
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
