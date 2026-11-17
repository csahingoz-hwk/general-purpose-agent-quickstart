"use client";

import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CloudIcon,
  LaptopIcon,
  Loader2Icon,
  ShieldAlertIcon,
  SparklesIcon,
  SquareIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import type {
  BackgroundTaskRecord,
  BackgroundTaskStatus,
} from "@/lib/tasks/runner";
import { cn, fetcher } from "@/lib/utils";

export type TaskCardPayload = {
  status?: string;
  target?: "cloud" | "mac" | "assistant";
  digest?: string;
  riskLevel?: string;
  message?: string;
  task?: BackgroundTaskRecord;
};

export type AgentLoopStepItem = {
  stepIndex: number;
  label: string;
  toolName: string;
  status: "running" | "done" | "error";
  elapsedMs: number;
};

export function isTaskCardPayload(value: unknown): value is TaskCardPayload {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    ("task" in (value as Record<string, unknown>) ||
      (value as { status?: string }).status === "blocked_data_boundary")
  );
}

const STATUS_META: Record<
  BackgroundTaskStatus,
  { en: string; tr: string; badgeClass: string }
> = {
  queued: {
    en: "Queued",
    tr: "Sırada",
    badgeClass: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
  running: {
    en: "Running",
    tr: "Çalışıyor",
    badgeClass: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  },
  awaiting_approval: {
    en: "Needs approval",
    tr: "Onay bekliyor",
    badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  succeeded: {
    en: "Done",
    tr: "Tamamlandı",
    badgeClass: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    en: "Failed",
    tr: "Hata",
    badgeClass: "bg-destructive/12 text-destructive",
  },
  cancelled: {
    en: "Stopped",
    tr: "Durduruldu",
    badgeClass: "bg-muted text-muted-foreground",
  },
};

export function AgentLoopStepStrip({
  steps,
  locale = "en",
}: {
  steps: readonly AgentLoopStepItem[];
  locale?: "en" | "tr";
}) {
  const [open, setOpen] = useState(false);
  if (steps.length < 2) {
    return null;
  }
  const totalMs = steps.reduce((acc, s) => acc + s.elapsedMs, 0);

  return (
    <div
      className="w-[min(100%,460px)] rounded-2xl border border-[color:var(--hairline)] bg-card/85 px-3.5 py-2.5 text-xs"
      data-testid="agent-step-strip"
    >
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" />
          <span className="truncate font-medium text-foreground">
            {locale === "tr"
              ? `${steps.length} adım tamamlandı`
              : `Completed ${steps.length} steps`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
          <span>{(totalMs / 1000).toFixed(1)}s</span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180"
            )}
          />
        </span>
      </button>

      {open && (
        <ol className="mt-2 space-y-1 border-[color:var(--hairline)] border-t pt-2">
          {steps.map((s) => (
            <li
              className="flex items-center justify-between gap-2 text-muted-foreground"
              key={`${s.stepIndex}-${s.toolName}`}
            >
              <span className="min-w-0 truncate">
                {s.stepIndex}. {s.label}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums">
                {s.elapsedMs}ms
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TaskCard({
  payload,
  input,
  state,
  isReadonly = false,
  locale = "en",
}: {
  payload?: TaskCardPayload;
  input?: Record<string, unknown>;
  state: string;
  isReadonly?: boolean;
  locale?: "en" | "tr";
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const initialTask = payload?.task;
  const [localTask, setLocalTask] = useState<BackgroundTaskRecord | undefined>(
    undefined
  );
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const currentStatus = localTask?.status ?? initialTask?.status;
  const taskId = localTask?.id ?? initialTask?.id;

  const { data: fetchedById, mutate } = useSWR<{
    task?: BackgroundTaskRecord | null;
  }>(taskId ? `${basePath}/api/tasks/${taskId}` : null, fetcher, {
    refreshInterval: (latestData) => {
      const st = localTask?.status ?? latestData?.task?.status ?? currentStatus;
      return st === "queued" || st === "running" ? 1200 : 0;
    },
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const liveTask = localTask ?? fetchedById?.task ?? initialTask;

  if (payload?.status === "blocked_data_boundary") {
    return (
      <div
        className="w-[min(100%,460px)] rounded-2xl border border-amber-500/30 bg-amber-500/8 p-4 text-sm"
        data-testid="task-card-blocked"
      >
        <p className="font-medium text-foreground">
          {payload.message ?? "Blocked by work-data boundary."}
        </p>
      </div>
    );
  }

  const status: BackgroundTaskStatus =
    liveTask?.status ??
    (state === "input-streaming" || state === "input-available"
      ? "running"
      : "succeeded");

  const meta = STATUS_META[status] ?? STATUS_META.running;
  const target = payload?.target ?? "assistant";
  const title =
    liveTask?.title ??
    (typeof input?.title === "string" ? input.title : undefined) ??
    (locale === "tr" ? "Arka plan görevi" : "Task");

  const steps = liveTask?.steps ?? [];
  const outputText = liveTask?.output ?? liveTask?.error ?? payload?.message;

  async function handleAction(action: "approve" | "cancel") {
    if (!liveTask?.id || busy) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/tasks/${liveTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const json = (await res.json()) as { task?: BackgroundTaskRecord };
        if (json.task) {
          setLocalTask(json.task);
          await mutate({ task: json.task }, false);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="w-[min(100%,460px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-sm shadow-2xs"
      data-status={status}
      data-target={target}
      data-testid="task-card"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {status === "running" || status === "queued" ? (
            <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
          ) : status === "awaiting_approval" ? (
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
          ) : status === "failed" ? (
            <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          )}
          <div className="min-w-0">
            <p className="break-words font-semibold text-foreground leading-snug">
              {title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
                {target === "cloud" ? (
                  <>
                    <CloudIcon className="size-3" />
                    Cloud VM
                  </>
                ) : target === "mac" ? (
                  <>
                    <LaptopIcon className="size-3" />
                    Mac mini
                  </>
                ) : (
                  <>
                    <SparklesIcon className="size-3" />
                    Assistant
                  </>
                )}
              </span>
              {steps.length > 0 && (
                <span
                  className="rounded-full border border-[color:var(--hairline)] px-2 py-0.5 tabular-nums"
                  data-testid="task-card-step-counter"
                >
                  {locale === "tr"
                    ? `Adım ${steps.length}`
                    : `Step ${steps.length}`}
                </span>
              )}
              {payload?.digest ? (
                <span className="font-mono text-[10px]">
                  #{payload.digest.slice(0, 8)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs",
            meta.badgeClass
          )}
          data-testid="task-card-status"
        >
          {locale === "tr" ? meta.tr : meta.en}
        </span>
      </div>

      {steps.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-[color:var(--hairline)] border-t pt-2.5 text-xs">
          {steps.slice(-5).map((s) => (
            <li
              className="flex items-start gap-2 text-muted-foreground"
              data-testid="task-card-step-row"
              key={`${s.step}-${s.timestamp}`}
            >
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
              <span className="min-w-0 flex-1 break-words">{s.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {outputText ? (
        <div className="mt-2.5">
          <button
            className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
            data-testid="task-card-toggle-details"
            onClick={() => setExpanded((prev) => !prev)}
            type="button"
          >
            {expanded
              ? locale === "tr"
                ? "Çıktıyı gizle"
                : "Hide details"
              : locale === "tr"
                ? "Çıktıyı göster"
                : "Show details"}
          </button>
          {expanded ? (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/60 p-2.5 font-mono text-[11px] text-foreground">
              {outputText}
            </pre>
          ) : null}
        </div>
      ) : null}

      {!isReadonly &&
      liveTask?.id &&
      (status === "awaiting_approval" ||
        status === "queued" ||
        status === "running") ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-[color:var(--hairline)] border-t pt-3">
          <button
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-4 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            data-testid="task-card-stop"
            disabled={busy}
            onClick={() => handleAction("cancel")}
            type="button"
          >
            <SquareIcon className="size-3 fill-current" />
            {locale === "tr" ? "Durdur" : "Stop"}
          </button>
          {status === "awaiting_approval" ? (
            <button
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
              data-testid="task-card-approve"
              disabled={busy}
              onClick={() => handleAction("approve")}
              type="button"
            >
              {locale === "tr" ? "Onayla ve Çalıştır" : "Approve & Run"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
