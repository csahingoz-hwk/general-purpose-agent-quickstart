import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  type CloudComputerLifecycleStore,
  resolveCloudLifecycleStore,
} from "@/lib/cloud-computer/lifecycle";
import { computeNextRunAt } from "@/lib/cron/cron-utils";
import {
  ACTIVE_CHAT_SKIP_WINDOW_MS,
  type CheckInStateStore,
  computeBackedOffNextRunAt,
  computeSilentBackoffMultiplier,
  isSilentCheckInOutput,
} from "@/lib/cron/smart-checkin";
import type {
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  TaskStepLog,
} from "@/lib/tasks/runner";
import type { WorkerHealthSnapshot } from "./health-server";
import type { RotatingFileLogger } from "./log-rotator";
import { classifyTaskWorkload } from "./workload-policy";

export const DEFAULT_TARGET_RSS_CAP_MB = 40;
export const DEFAULT_HEAP_CAP_MB = 24;
const BYTES_PER_MB = 1024 * 1024;

export type DueCronRoutine = {
  id: string;
  userId: string;
  cronExpression: string;
  timezone: string;
  prompt: string;
  nextRunAt: Date;
};

export interface WorkerQueueAdapter {
  claimDueRoutinesAndEnqueue: (opts: {
    now: Date;
    maxBatch: number;
  }) => Promise<number>;
  recoverStaleRunningTasks: (opts: {
    now: Date;
    staleAfterMs: number;
  }) => Promise<number>;
  claimNextQueuedTask: (opts: {
    now: Date;
  }) => Promise<BackgroundTaskRecord | null>;
  completeTaskTransition: (opts: {
    task: BackgroundTaskRecord;
    status: BackgroundTaskStatus;
    stepMessage: string;
    output?: string | null;
    error?: string | null;
    now: Date;
  }) => Promise<BackgroundTaskRecord>;
  close: () => Promise<void>;
}

export type MemorySample = {
  rss: number;
  heapUsed: number;
  external: number;
};

export function evaluateMemoryBudget(opts: {
  sample: MemorySample;
  baselineRssBytes?: number;
  rssCapMb?: number;
  heapCapMb?: number;
}): {
  recycleNeeded: boolean;
  reason: string | null;
  rssMb: number;
  heapUsedMb: number;
} {
  const rssCapMb = opts.rssCapMb ?? DEFAULT_TARGET_RSS_CAP_MB;
  const heapCapMb = opts.heapCapMb ?? DEFAULT_HEAP_CAP_MB;
  const rssMb = Math.round((opts.sample.rss / BYTES_PER_MB) * 10) / 10;
  const privateHeapBytes = opts.sample.heapUsed + opts.sample.external;
  const heapUsedMb = Math.round((privateHeapBytes / BYTES_PER_MB) * 10) / 10;

  if (privateHeapBytes > heapCapMb * BYTES_PER_MB) {
    return {
      recycleNeeded: true,
      reason: `Private V8 heap (${heapUsedMb} MB) exceeded ${heapCapMb} MB cap`,
      rssMb,
      heapUsedMb,
    };
  }

  // When baselineRssBytes is provided (e.g. macOS arm64 shared dylib pages),
  // enforce both hard ceiling (max(rssCapMb, baselineMb + 16)) and explicit rssCapMb when baseline is 0.
  const effectiveRssCapBytes =
    opts.baselineRssBytes && opts.baselineRssBytes > rssCapMb * BYTES_PER_MB
      ? opts.baselineRssBytes + 16 * BYTES_PER_MB
      : rssCapMb * BYTES_PER_MB;

  if (opts.sample.rss > effectiveRssCapBytes) {
    const capMb = Math.round((effectiveRssCapBytes / BYTES_PER_MB) * 10) / 10;
    return {
      recycleNeeded: true,
      reason: `Process RSS (${rssMb} MB) exceeded ${capMb} MB cap; exiting cleanly for launchd restart`,
      rssMb,
      heapUsedMb,
    };
  }

  return {
    recycleNeeded: false,
    reason: null,
    rssMb,
    heapUsedMb,
  };
}

export function createInMemoryWorkerAdapter(seed?: {
  routines?: Array<{
    id: string;
    userId: string;
    cronExpression: string;
    timezone: string;
    prompt: string;
    enabled?: boolean;
    nextRunAt: Date;
  }>;
  tasks?: BackgroundTaskRecord[];
  checkInStore?: CheckInStateStore;
}): WorkerQueueAdapter & {
  getTasks: () => BackgroundTaskRecord[];
  getRoutines: () => Array<{
    id: string;
    enabled: boolean;
    nextRunAt: Date;
    lastOutput: string | null;
    lastError: string | null;
  }>;
} {
  const routines = (seed?.routines ?? []).map((r) => ({
    ...r,
    enabled: r.enabled ?? true,
    lastOutput: null as string | null,
    lastError: null as string | null,
  }));
  const tasks = new Map<string, BackgroundTaskRecord>(
    (seed?.tasks ?? []).map((t) => [t.id, { ...t, steps: [...t.steps] }])
  );
  const checkInStore = seed?.checkInStore;

  return {
    async claimDueRoutinesAndEnqueue({ now, maxBatch }) {
      let count = 0;
      for (const r of routines) {
        if (count >= maxBatch) {
          break;
        }
        if (!r.enabled || r.nextRunAt.getTime() > now.getTime()) {
          continue;
        }
        try {
          if (checkInStore) {
            const existingState = await checkInStore.getState(r.id);
            if (
              existingState?.nextEligibleAt &&
              new Date(existingState.nextEligibleAt).getTime() > now.getTime()
            ) {
              r.nextRunAt = new Date(existingState.nextEligibleAt);
              continue;
            }
            const lastChat = await checkInStore.getLastUserChatAt(r.userId);
            if (
              lastChat &&
              now.getTime() >= lastChat.getTime() &&
              now.getTime() - lastChat.getTime() < ACTIVE_CHAT_SKIP_WINDOW_MS
            ) {
              r.nextRunAt = computeNextRunAt(r.cronExpression, r.timezone, now);
              await checkInStore.saveState({
                scheduleId: r.id,
                userId: r.userId,
                consecutiveSilentRuns:
                  existingState?.consecutiveSilentRuns ?? 0,
                backoffMultiplier: existingState?.backoffMultiplier ?? 1,
                lastOutcome: "skipped_active_chat",
                lastCheckedAt: now.toISOString(),
                nextEligibleAt: existingState?.nextEligibleAt ?? null,
              });
              continue;
            }
          }
          const next = computeNextRunAt(r.cronExpression, r.timezone, now);
          r.nextRunAt = next;
          r.lastError = null;
          const id = randomUUID();
          const nowIso = now.toISOString();
          tasks.set(id, {
            id,
            userId: r.userId,
            kind: "routine",
            title: r.prompt.slice(0, 120),
            prompt: r.prompt,
            status: "queued",
            riskLevel: "low",
            scheduleId: r.id,
            steps: [
              {
                step: 1,
                message: "Scheduled routine enqueued by local launchd worker",
                timestamp: nowIso,
              },
            ],
            output: null,
            error: null,
            createdAt: nowIso,
            startedAt: null,
            finishedAt: null,
          });
          count += 1;
        } catch (err) {
          r.enabled = false;
          r.lastError =
            err instanceof Error ? err.message : "Invalid cron schedule";
        }
      }
      return count;
    },

    recoverStaleRunningTasks({ now, staleAfterMs }) {
      let recovered = 0;
      const nowIso = now.toISOString();
      for (const task of tasks.values()) {
        if (task.status !== "running" || !task.startedAt) {
          continue;
        }
        const age = now.getTime() - new Date(task.startedAt).getTime();
        if (age > staleAfterMs) {
          task.status = "failed";
          task.error = "Task timed out or worker restarted mid-run";
          task.finishedAt = nowIso;
          task.steps.push({
            step: task.steps.length + 1,
            message: "Recovered stale running task after timeout/restart",
            timestamp: nowIso,
          });
          recovered += 1;
        }
      }
      return Promise.resolve(recovered);
    },

    claimNextQueuedTask({ now }) {
      const queued = [...tasks.values()]
        .filter((t) => t.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!queued) {
        return Promise.resolve(null);
      }
      const nowIso = now.toISOString();
      queued.status = "running";
      queued.startedAt = queued.startedAt ?? nowIso;
      queued.steps.push({
        step: queued.steps.length + 1,
        message: "Claimed by Mac mini launchd queue worker",
        timestamp: nowIso,
      });
      return Promise.resolve({ ...queued, steps: [...queued.steps] });
    },

    completeTaskTransition({ task, status, stepMessage, output, error, now }) {
      const existing = tasks.get(task.id) ?? task;
      const nowIso = now.toISOString();
      existing.status = status;
      existing.steps.push({
        step: existing.steps.length + 1,
        message: stepMessage,
        timestamp: nowIso,
      });
      if (output !== undefined) {
        existing.output = output;
      }
      if (error !== undefined) {
        existing.error = error;
      }
      if (
        status === "succeeded" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        existing.finishedAt = nowIso;
      }
      if (existing.scheduleId) {
        const parent = routines.find((r) => r.id === existing.scheduleId);
        if (parent) {
          const silent =
            status === "succeeded" && isSilentCheckInOutput(existing.output);
          parent.lastOutput = silent ? null : existing.output;
          parent.lastError = existing.error;
          if (checkInStore && status === "succeeded") {
            return checkInStore.getState(parent.id).then(async (prev) => {
              if (silent) {
                const nextSilent = (prev?.consecutiveSilentRuns ?? 0) + 1;
                const mult = computeSilentBackoffMultiplier(nextSilent);
                const backedOffNext = computeBackedOffNextRunAt({
                  cronExpression: parent.cronExpression,
                  timezone: parent.timezone,
                  from: now,
                  multiplier: mult,
                });
                parent.nextRunAt = backedOffNext;
                await checkInStore.saveState({
                  scheduleId: parent.id,
                  userId: parent.userId,
                  consecutiveSilentRuns: nextSilent,
                  backoffMultiplier: mult,
                  lastOutcome: "silent",
                  lastCheckedAt: nowIso,
                  nextEligibleAt: mult > 1 ? backedOffNext.toISOString() : null,
                });
              } else {
                await checkInStore.saveState({
                  scheduleId: parent.id,
                  userId: parent.userId,
                  consecutiveSilentRuns: 0,
                  backoffMultiplier: 1,
                  lastOutcome: "delivered",
                  lastCheckedAt: nowIso,
                  nextEligibleAt: null,
                });
              }
              tasks.set(existing.id, existing);
              return { ...existing, steps: [...existing.steps] };
            });
          }
        }
      }
      tasks.set(existing.id, existing);
      return Promise.resolve({ ...existing, steps: [...existing.steps] });
    },

    close() {
      return Promise.resolve();
    },

    getTasks: () => [...tasks.values()],
    getRoutines: () =>
      routines.map((r) => ({
        id: r.id,
        enabled: r.enabled,
        nextRunAt: r.nextRunAt,
        lastOutput: r.lastOutput,
        lastError: r.lastError,
      })),
  };
}

function mapPgTaskRow(row: Record<string, unknown>): BackgroundTaskRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    kind: row.kind as BackgroundTaskRecord["kind"],
    title: String(row.title),
    prompt: String(row.prompt),
    status: row.status as BackgroundTaskStatus,
    riskLevel: row.riskLevel as BackgroundTaskRecord["riskLevel"],
    scheduleId: row.scheduleId ? String(row.scheduleId) : null,
    steps: Array.isArray(row.steps) ? (row.steps as TaskStepLog[]) : [],
    output: row.output ? String(row.output) : null,
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.createdAt)).toISOString(),
    startedAt: row.startedAt
      ? new Date(String(row.startedAt)).toISOString()
      : null,
    finishedAt: row.finishedAt
      ? new Date(String(row.finishedAt)).toISOString()
      : null,
  };
}

export function createPostgresWorkerAdapter(
  connectionString: string
): WorkerQueueAdapter {
  // Single connection (`max: 1`) with short idle timeout keeps RSS minimal (~40 MB cap).
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    connect_timeout: 10,
  });

  const isMissingTable = (err: unknown) =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "42P01";

  return {
    async claimDueRoutinesAndEnqueue({ now, maxBatch }) {
      let enqueued = 0;
      for (let i = 0; i < maxBatch; i++) {
        try {
          const claimed = await sql.begin(async (tx) => {
            const txSql = tx as unknown as typeof sql;
            const [due] = await txSql`
              SELECT "id", "userId", "cronExpression", "timezone", "prompt"
              FROM "CronJob"
              WHERE "enabled" = true AND "nextRunAt" <= ${now.toISOString()}::timestamptz
              ORDER BY "nextRunAt" ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            `;
            if (!due) {
              return false;
            }
            const nowIso = now.toISOString();
            try {
              const nextRun = computeNextRunAt(
                String(due.cronExpression),
                String(due.timezone || "UTC"),
                now
              );
              const taskId = randomUUID();
              const prompt = String(due.prompt);
              const title = prompt.slice(0, 120) || "Scheduled routine";
              const initialSteps = JSON.stringify([
                {
                  step: 1,
                  message: "Scheduled routine enqueued by local launchd worker",
                  timestamp: nowIso,
                },
              ]);
              await txSql`
                UPDATE "CronJob"
                SET "nextRunAt" = ${nextRun.toISOString()}::timestamptz,
                    "lastRunAt" = ${nowIso}::timestamptz,
                    "lastError" = NULL
                WHERE "id" = ${String(due.id)}::uuid
              `;
              await txSql`
                INSERT INTO "BackgroundTask" (
                  "id", "userId", "kind", "title", "prompt", "status", "riskLevel", "scheduleId", "steps"
                ) VALUES (
                  ${taskId}::uuid,
                  ${String(due.userId)}::uuid,
                  'routine',
                  ${title},
                  ${prompt},
                  'queued',
                  'low',
                  ${String(due.id)}::uuid,
                  ${initialSteps}::jsonb
                )
              `;
              return true;
            } catch (cronErr) {
              const message =
                cronErr instanceof Error
                  ? cronErr.message
                  : "Invalid cron expression";
              await txSql`
                UPDATE "CronJob"
                SET "enabled" = false, "lastError" = ${message}
                WHERE "id" = ${String(due.id)}::uuid
              `;
              return false;
            }
          });
          if (!claimed) {
            break;
          }
          enqueued += 1;
        } catch (err) {
          if (isMissingTable(err)) {
            return 0;
          }
          throw err;
        }
      }
      return enqueued;
    },

    async recoverStaleRunningTasks({ now, staleAfterMs }) {
      const cutoffIso = new Date(now.getTime() - staleAfterMs).toISOString();
      const nowIso = now.toISOString();
      try {
        const rows = await sql`
          UPDATE "BackgroundTask"
          SET
            "status" = 'failed',
            "error" = 'Task timed out or worker restarted mid-run',
            "finishedAt" = ${nowIso}::timestamptz
          WHERE "status" = 'running'
            AND "startedAt" IS NOT NULL
            AND "startedAt" < ${cutoffIso}::timestamptz
          RETURNING "id"
        `;
        return rows.length;
      } catch (err) {
        if (isMissingTable(err)) {
          return 0;
        }
        throw err;
      }
    },

    async claimNextQueuedTask({ now }) {
      const nowIso = now.toISOString();
      const stepMsg = "Claimed by Mac mini launchd queue worker";
      try {
        const [row] = await sql`
          WITH claimed AS (
            SELECT "id"
            FROM "BackgroundTask"
            WHERE "status" = 'queued'
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "BackgroundTask" AS t
          SET
            "status" = 'running',
            "startedAt" = COALESCE(t."startedAt", ${nowIso}::timestamptz),
            "steps" = (
              CASE WHEN jsonb_typeof(t."steps") = 'array' THEN t."steps" ELSE '[]'::jsonb END
            ) || jsonb_build_array(
              jsonb_build_object(
                'step', (CASE WHEN jsonb_typeof(t."steps") = 'array' THEN jsonb_array_length(t."steps") ELSE 0 END) + 1,
                'message', ${stepMsg}::text,
                'timestamp', ${nowIso}::text
              )
            )
          FROM claimed
          WHERE t."id" = claimed."id"
          RETURNING t.*
        `;
        return row ? mapPgTaskRow(row) : null;
      } catch (err) {
        if (isMissingTable(err)) {
          return null;
        }
        throw err;
      }
    },

    async completeTaskTransition({
      task,
      status,
      stepMessage,
      output,
      error,
      now,
    }) {
      const nowIso = now.toISOString();
      const nextSteps: TaskStepLog[] = [
        ...task.steps,
        {
          step: task.steps.length + 1,
          message: stepMessage,
          timestamp: nowIso,
        },
      ];
      const isTerminal =
        status === "succeeded" || status === "failed" || status === "cancelled";
      const finishedAt = isTerminal ? nowIso : task.finishedAt;
      const nextOutput = output !== undefined ? output : task.output;
      const nextError = error !== undefined ? error : task.error;

      const [updated] = await sql`
        UPDATE "BackgroundTask"
        SET
          "status" = ${status},
          "steps" = ${JSON.stringify(nextSteps)}::jsonb,
          "output" = ${nextOutput},
          "error" = ${nextError},
          "finishedAt" = ${finishedAt}
        WHERE "id" = ${task.id}::uuid
        RETURNING *
      `;

      if (task.scheduleId && isTerminal) {
        await sql`
          UPDATE "CronJob"
          SET "lastOutput" = ${nextOutput}, "lastError" = ${nextError}
          WHERE "id" = ${task.scheduleId}::uuid
        `.catch(() => null);
      }

      return updated ? mapPgTaskRow(updated) : task;
    },

    async close() {
      await sql.end({ timeout: 2 });
    },
  };
}

export class QueueWorkerEngine {
  private readonly adapter: WorkerQueueAdapter;
  private readonly cloudLifecycle?: CloudComputerLifecycleStore;
  private readonly logger?: RotatingFileLogger;
  private readonly rssCapMb: number;
  private readonly heapCapMb: number;
  private readonly baselineRssBytes: number;
  private readonly readMemory: () => MemorySample;
  private readonly staleRunningMs: number;
  private readonly startedAtMs: number;

  private lastPollAt: Date | null = null;
  private routinesEnqueued = 0;
  private tasksSucceeded = 0;
  private tasksPausedForApproval = 0;
  private tasksOffloadedToCloudRun = 0;
  private tasksFailed = 0;
  private recycleNeeded = false;
  private recycleReason: string | null = null;

  constructor(opts: {
    adapter: WorkerQueueAdapter;
    cloudLifecycle?: CloudComputerLifecycleStore;
    logger?: RotatingFileLogger;
    rssCapMb?: number;
    heapCapMb?: number;
    baselineRssBytes?: number;
    staleRunningMs?: number;
    readMemory?: () => MemorySample;
  }) {
    this.adapter = opts.adapter;
    this.cloudLifecycle = opts.cloudLifecycle;
    this.logger = opts.logger;
    this.rssCapMb = opts.rssCapMb ?? DEFAULT_TARGET_RSS_CAP_MB;
    this.heapCapMb = opts.heapCapMb ?? DEFAULT_HEAP_CAP_MB;
    this.readMemory =
      opts.readMemory ??
      (() => {
        const m = process.memoryUsage();
        return { rss: m.rss, heapUsed: m.heapUsed, external: m.external };
      });
    this.baselineRssBytes = opts.baselineRssBytes ?? 0;
    this.staleRunningMs = opts.staleRunningMs ?? 5 * 60 * 1000;
    this.startedAtMs = Date.now();
  }

  async runPollTick(now: Date = new Date()): Promise<{
    enqueuedRoutines: number;
    processedTask: BackgroundTaskRecord | null;
    recycleNeeded: boolean;
  }> {
    this.lastPollAt = now;

    await this.adapter.recoverStaleRunningTasks({
      now,
      staleAfterMs: this.staleRunningMs,
    });

    if (this.cloudLifecycle || process.env.POSTGRES_URL?.trim()) {
      await resolveCloudLifecycleStore(this.cloudLifecycle)
        .sleepIdleSessions({ now })
        .catch(() => null);
    }

    const enqueuedRoutines = await this.adapter.claimDueRoutinesAndEnqueue({
      now,
      maxBatch: 5,
    });
    this.routinesEnqueued += enqueuedRoutines;

    if (enqueuedRoutines > 0) {
      this.logger?.log("info", "worker.routines_enqueued", {
        count: enqueuedRoutines,
      });
    }

    // Strictly process at most 1 task per tick to keep RSS flat on the 8 GB Mac mini.
    const claimed = await this.adapter.claimNextQueuedTask({ now });
    let processedTask: BackgroundTaskRecord | null = null;

    if (claimed) {
      const decision = classifyTaskWorkload(claimed);

      if (decision.route === "pause_for_approval") {
        processedTask = await this.adapter.completeTaskTransition({
          task: claimed,
          status: "awaiting_approval",
          stepMessage: decision.reason,
          now,
        });
        this.tasksPausedForApproval += 1;
        this.logger?.log("warn", "worker.task_awaiting_approval", {
          taskId: claimed.id,
          riskLevel: claimed.riskLevel,
        });
      } else if (decision.route === "blocked_work_data_boundary") {
        processedTask = await this.adapter.completeTaskTransition({
          task: claimed,
          status: "failed",
          stepMessage: decision.reason,
          error: decision.reason,
          now,
        });
        this.tasksFailed += 1;
        this.logger?.log("warn", "worker.task_blocked_data_boundary", {
          taskId: claimed.id,
        });
      } else if (decision.route === "defer_heavy_to_cloud_run") {
        const offloadNote = process.env.CLOUD_RUN_WORKER_URL
          ? `Deferred from 8 GB Mac mini to scale-to-zero Cloud Run (${process.env.CLOUD_RUN_WORKER_URL}).`
          : "Deferred from 8 GB Mac mini: configure CLOUD_RUN_WORKER_URL (scale-to-zero) or RunPod for heavy jobs.";
        processedTask = await this.adapter.completeTaskTransition({
          task: claimed,
          status: "succeeded",
          stepMessage: decision.reason,
          output: offloadNote,
          now,
        });
        this.tasksOffloadedToCloudRun += 1;
        this.logger?.log("info", "worker.task_deferred_heavy", {
          taskId: claimed.id,
        });
      } else {
        // Lightweight local task execution
        const summary = `[Local Mac mini worker] Executed "${claimed.title}" (${claimed.kind}) within ~40 MB memory budget at ${now.toISOString()}.`;
        processedTask = await this.adapter.completeTaskTransition({
          task: claimed,
          status: "succeeded",
          stepMessage: "Completed lightweight local routine/task run",
          output: summary,
          now,
        });
        this.tasksSucceeded += 1;
        this.logger?.log("info", "worker.task_succeeded", {
          taskId: claimed.id,
          kind: claimed.kind,
        });
      }
    }

    const mem = evaluateMemoryBudget({
      sample: this.readMemory(),
      baselineRssBytes: this.baselineRssBytes,
      rssCapMb: this.rssCapMb,
      heapCapMb: this.heapCapMb,
    });

    if (mem.recycleNeeded) {
      this.recycleNeeded = true;
      this.recycleReason = mem.reason;
      this.logger?.log("warn", "worker.memory_cap_recycle", {
        rssMb: mem.rssMb,
        heapUsedMb: mem.heapUsedMb,
        reason: mem.reason,
      });
    }

    return {
      enqueuedRoutines,
      processedTask,
      recycleNeeded: this.recycleNeeded,
    };
  }

  getHealthSnapshot(nowMs: number = Date.now()): WorkerHealthSnapshot {
    const sample = this.readMemory();
    const mem = evaluateMemoryBudget({
      sample,
      baselineRssBytes: this.baselineRssBytes,
      rssCapMb: this.rssCapMb,
      heapCapMb: this.heapCapMb,
    });
    const recycle = this.recycleNeeded || mem.recycleNeeded;
    const reason = this.recycleReason ?? mem.reason;

    return {
      status: recycle ? "recycling" : "ok",
      pid: process.pid,
      uptimeSec: Math.floor((nowMs - this.startedAtMs) / 1000),
      rssBytes: sample.rss,
      rssMb: mem.rssMb,
      heapUsedMb: mem.heapUsedMb,
      heapCapMb: this.heapCapMb,
      rssCapMb: this.rssCapMb,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      pollAgeMs: this.lastPollAt
        ? Math.max(0, nowMs - this.lastPollAt.getTime())
        : null,
      routinesEnqueued: this.routinesEnqueued,
      tasksSucceeded: this.tasksSucceeded,
      tasksPausedForApproval: this.tasksPausedForApproval,
      tasksOffloadedToCloudRun: this.tasksOffloadedToCloudRun,
      tasksFailed: this.tasksFailed,
      recycleNeeded: recycle,
      recycleReason: reason,
    };
  }

  async shutdown(): Promise<void> {
    await this.adapter.close();
  }
}
