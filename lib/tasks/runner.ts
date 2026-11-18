import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";

export type BackgroundTaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BackgroundTaskKind =
  | "routine"
  | "research"
  | "executor"
  | "draft_review"
  | "browser_agent"
  | "coding_worktree"
  | "media_gen"
  | "meeting_copilot";

export type TaskStepLog = {
  step: number;
  message: string;
  timestamp: string;
};

export type BackgroundTaskRecord = {
  id: string;
  userId: string;
  kind: BackgroundTaskKind;
  title: string;
  prompt: string;
  status: BackgroundTaskStatus;
  riskLevel: "low" | "medium" | "high" | "critical";
  scheduleId: string | null;
  steps: TaskStepLog[];
  output: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export interface BackgroundTaskStore {
  enqueueTask: (input: {
    userId: string;
    kind?: BackgroundTaskKind;
    title: string;
    prompt: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    scheduleId?: string | null;
  }) => Promise<BackgroundTaskRecord>;
  listTasks: (opts: {
    userId: string;
    status?: BackgroundTaskStatus;
    limit?: number;
  }) => Promise<BackgroundTaskRecord[]>;
  getTask: (opts: {
    userId: string;
    id: string;
  }) => Promise<BackgroundTaskRecord | null>;
  transitionTask: (opts: {
    userId: string;
    id: string;
    status: BackgroundTaskStatus;
    stepMessage?: string;
    output?: string | null;
    error?: string | null;
  }) => Promise<BackgroundTaskRecord | null>;
  cancelTask: (opts: {
    userId: string;
    id: string;
  }) => Promise<BackgroundTaskRecord | null>;
}

export class TaskStoreUnavailableError extends Error {}

const TERMINAL_STATUSES = new Set<BackgroundTaskStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

function cloneTask(record: BackgroundTaskRecord): BackgroundTaskRecord {
  return {
    ...record,
    steps: record.steps.map((s) => ({ ...s })),
  };
}

export function createInMemoryTaskStore(): BackgroundTaskStore {
  const tasks = new Map<string, BackgroundTaskRecord>();
  let seq = 0;

  return {
    enqueueTask({
      userId,
      kind = "executor",
      title,
      prompt,
      riskLevel = "medium",
      scheduleId = null,
    }) {
      const now = new Date(Date.now() + seq++).toISOString();
      const record: BackgroundTaskRecord = {
        id: randomUUID(),
        userId,
        kind,
        title: title.trim(),
        prompt: prompt.trim(),
        status: "queued",
        riskLevel,
        scheduleId,
        steps: [
          {
            step: 1,
            message: "Task queued for execution",
            timestamp: now,
          },
        ],
        output: null,
        error: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
      };
      tasks.set(record.id, record);
      return Promise.resolve(cloneTask(record));
    },
    listTasks({ userId, status, limit = 25 }) {
      const items = [...tasks.values()]
        .filter(
          (item) =>
            item.userId === userId && (!status || item.status === status)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(1, limit))
        .map(cloneTask);
      return Promise.resolve(items);
    },
    getTask({ userId, id }) {
      const found = tasks.get(id);
      if (!found || found.userId !== userId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(cloneTask(found));
    },
    transitionTask({ userId, id, status, stepMessage, output, error }) {
      const found = tasks.get(id);
      if (!found || found.userId !== userId) {
        return Promise.resolve(null);
      }
      const now = new Date(Date.now() + seq++).toISOString();
      const steps = stepMessage
        ? [
            ...found.steps,
            {
              step: found.steps.length + 1,
              message: stepMessage,
              timestamp: now,
            },
          ]
        : found.steps;
      const updated: BackgroundTaskRecord = {
        ...found,
        status,
        steps,
        output: output !== undefined ? output : found.output,
        error: error !== undefined ? error : found.error,
        startedAt:
          status === "running" && !found.startedAt ? now : found.startedAt,
        finishedAt: TERMINAL_STATUSES.has(status) ? now : found.finishedAt,
      };
      tasks.set(id, updated);
      return Promise.resolve(cloneTask(updated));
    },
    cancelTask({ userId, id }) {
      const found = tasks.get(id);
      if (!found || found.userId !== userId) {
        return Promise.resolve(null);
      }
      if (TERMINAL_STATUSES.has(found.status)) {
        return Promise.resolve(cloneTask(found));
      }
      const now = new Date(Date.now() + seq++).toISOString();
      const cancelled: BackgroundTaskRecord = {
        ...found,
        status: "cancelled",
        steps: [
          ...found.steps,
          {
            step: found.steps.length + 1,
            message: "Cancelled by owner",
            timestamp: now,
          },
        ],
        finishedAt: now,
      };
      tasks.set(id, cancelled);
      return Promise.resolve(cloneTask(cancelled));
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new TaskStoreUnavailableError("POSTGRES_URL is not configured");
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 0,
  });
  return pgClient;
}

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function mapRow(row: Record<string, any>): BackgroundTaskRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    kind: row.kind as BackgroundTaskKind,
    title: String(row.title),
    prompt: String(row.prompt),
    status: row.status as BackgroundTaskStatus,
    riskLevel: row.riskLevel as "low" | "medium" | "high" | "critical",
    scheduleId: row.scheduleId ? String(row.scheduleId) : null,
    steps: Array.isArray(row.steps) ? (row.steps as TaskStepLog[]) : [],
    output: row.output ? String(row.output) : null,
    error: row.error ? String(row.error) : null,
    createdAt: new Date(row.createdAt).toISOString(),
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
  };
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

export function createPostgresTaskStore(): BackgroundTaskStore {
  return {
    async enqueueTask({
      userId,
      kind = "executor",
      title,
      prompt,
      riskLevel = "medium",
      scheduleId = null,
    }) {
      const id = randomUUID();
      const steps: TaskStepLog[] = [
        {
          step: 1,
          message: "Task queued for execution",
          timestamp: new Date().toISOString(),
        },
      ];
      try {
        const sql = await readySql();
        const [row] = await sql`
          INSERT INTO "BackgroundTask" ("id", "userId", "kind", "title", "prompt", "status", "riskLevel", "scheduleId", "steps")
          VALUES (${id}, ${userId}, ${kind}, ${title.trim()}, ${prompt.trim()}, 'queued', ${riskLevel}, ${scheduleId}, ${JSON.stringify(steps)}::jsonb)
          RETURNING *
        `;
        return mapRow(row);
      } catch (error) {
        if (isMissingTable(error)) {
          throw new TaskStoreUnavailableError("BackgroundTask table missing");
        }
        throw error;
      }
    },
    async listTasks({ userId, status, limit = 25 }) {
      try {
        const sql = await readySql();
        const rows = status
          ? await sql`
              SELECT * FROM "BackgroundTask"
              WHERE "userId" = ${userId} AND "status" = ${status}
              ORDER BY "createdAt" DESC
              LIMIT ${Math.max(1, limit)}
            `
          : await sql`
              SELECT * FROM "BackgroundTask"
              WHERE "userId" = ${userId}
              ORDER BY "createdAt" DESC
              LIMIT ${Math.max(1, limit)}
            `;
        return rows.map(mapRow);
      } catch (error) {
        if (isMissingTable(error)) {
          throw new TaskStoreUnavailableError("BackgroundTask table missing");
        }
        throw error;
      }
    },
    async getTask({ userId, id }) {
      try {
        const sql = await readySql();
        const [row] = await sql`
          SELECT * FROM "BackgroundTask"
          WHERE "userId" = ${userId} AND "id" = ${id}
          LIMIT 1
        `;
        return row ? mapRow(row) : null;
      } catch (error) {
        if (isMissingTable(error)) {
          throw new TaskStoreUnavailableError("BackgroundTask table missing");
        }
        throw error;
      }
    },
    async transitionTask({ userId, id, status, stepMessage, output, error }) {
      const existing = await this.getTask({ userId, id });
      if (!existing) {
        return null;
      }
      const now = new Date().toISOString();
      const nextSteps = stepMessage
        ? [
            ...existing.steps,
            {
              step: existing.steps.length + 1,
              message: stepMessage,
              timestamp: now,
            },
          ]
        : existing.steps;
      const startedAt =
        status === "running" && !existing.startedAt ? now : existing.startedAt;
      const finishedAt = TERMINAL_STATUSES.has(status)
        ? now
        : existing.finishedAt;
      const nextOutput = output !== undefined ? output : existing.output;
      const nextError = error !== undefined ? error : existing.error;

      const sql = await readySql();
      const [updated] = await sql`
        UPDATE "BackgroundTask"
        SET
          "status" = ${status},
          "steps" = ${JSON.stringify(nextSteps)}::jsonb,
          "output" = ${nextOutput},
          "error" = ${nextError},
          "startedAt" = ${startedAt},
          "finishedAt" = ${finishedAt}
        WHERE "id" = ${id} AND "userId" = ${userId}
        RETURNING *
      `;
      return updated ? mapRow(updated) : null;
    },
    async cancelTask({ userId, id }) {
      const existing = await this.getTask({ userId, id });
      if (!existing) {
        return null;
      }
      if (TERMINAL_STATUSES.has(existing.status)) {
        return existing;
      }
      return await this.transitionTask({
        userId,
        id,
        status: "cancelled",
        stepMessage: "Cancelled by owner",
      });
    },
  };
}

export async function executeDryRunTask({
  store,
  userId,
  taskId,
}: {
  store: BackgroundTaskStore;
  userId: string;
  taskId: string;
}): Promise<BackgroundTaskRecord | null> {
  const running = await store.transitionTask({
    userId,
    id: taskId,
    status: "running",
    stepMessage: "Validating task scope and safety boundaries",
  });
  if (!running) {
    return null;
  }

  if (running.riskLevel === "high" || running.riskLevel === "critical") {
    return await store.transitionTask({
      userId,
      id: taskId,
      status: "awaiting_approval",
      stepMessage:
        "Paused: owner approval required before external or high-impact execution",
    });
  }

  return await store.transitionTask({
    userId,
    id: taskId,
    status: "succeeded",
    stepMessage: "Completed dry-run validation",
    output: `Dry-run preview succeeded for "${running.title}". Live background worker execution remains paused until connected to the Mac mini worker daemon.`,
  });
}
