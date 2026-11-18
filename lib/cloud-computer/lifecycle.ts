import postgres from "postgres";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";

export const DEFAULT_CLOUD_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type CloudComputerPowerState = "sleeping" | "waking" | "running";

export type CloudComputerSessionRecord = {
  userId: string;
  state: CloudComputerPowerState;
  lastActiveAt: string;
  sleptAt: string | null;
  wakeCount: number;
  lastWakeDurationMs: number | null;
  updatedAt: string;
};

export type CloudWakeResult = {
  session: CloudComputerSessionRecord;
  wokeFromSleep: boolean;
  wakeDurationMs: number;
};

export function resolveCloudIdleTimeoutMs(overrideMs?: number): number {
  if (typeof overrideMs === "number" && overrideMs > 0) {
    return overrideMs;
  }
  const envVal = Number.parseInt(
    process.env.CLOUD_COMPUTER_IDLE_SLEEP_MS ?? "",
    10
  );
  if (Number.isFinite(envVal) && envVal >= 5000) {
    return envVal;
  }
  return DEFAULT_CLOUD_IDLE_TIMEOUT_MS;
}

export interface CloudComputerLifecycleStore {
  getSession: (opts: {
    userId: string;
    now?: Date;
    idleTimeoutMs?: number;
  }) => Promise<CloudComputerSessionRecord>;
  ensureAwakeForTask: (opts: {
    userId: string;
    now?: Date;
    idleTimeoutMs?: number;
    onWake?: () => Promise<void> | void;
  }) => Promise<CloudWakeResult>;
  recordActivity: (opts: {
    userId: string;
    now?: Date;
  }) => Promise<CloudComputerSessionRecord>;
  sleepIdleSessions: (opts?: {
    now?: Date;
    idleTimeoutMs?: number;
    onSleep?: (userId: string) => Promise<void> | void;
  }) => Promise<{ sleptCount: number; sleptUserIds: string[] }>;
}

export function createInMemoryCloudLifecycleStore(): CloudComputerLifecycleStore {
  const sessions = new Map<string, CloudComputerSessionRecord>();

  return {
    getSession({ userId, now = new Date(), idleTimeoutMs }) {
      const timeout = resolveCloudIdleTimeoutMs(idleTimeoutMs);
      const existing = sessions.get(userId);
      if (!existing) {
        const initial: CloudComputerSessionRecord = {
          userId,
          state: "sleeping",
          lastActiveAt: new Date(0).toISOString(),
          sleptAt: now.toISOString(),
          wakeCount: 0,
          lastWakeDurationMs: null,
          updatedAt: now.toISOString(),
        };
        return Promise.resolve(initial);
      }
      const idleMs = now.getTime() - new Date(existing.lastActiveAt).getTime();
      if (existing.state === "running" && idleMs >= timeout) {
        const slept: CloudComputerSessionRecord = {
          ...existing,
          state: "sleeping",
          sleptAt: new Date(
            new Date(existing.lastActiveAt).getTime() + timeout
          ).toISOString(),
          updatedAt: now.toISOString(),
        };
        sessions.set(userId, slept);
        return Promise.resolve({ ...slept });
      }
      return Promise.resolve({ ...existing });
    },

    async ensureAwakeForTask({
      userId,
      now = new Date(),
      idleTimeoutMs,
      onWake,
    }) {
      const current = await this.getSession({ userId, now, idleTimeoutMs });
      const wasSleeping = current.state === "sleeping";
      let wakeDurationMs = 0;

      if (wasSleeping) {
        const wakeStart = Date.now();
        sessions.set(userId, {
          ...current,
          state: "waking",
          updatedAt: now.toISOString(),
        });
        if (onWake) {
          await onWake();
        }
        wakeDurationMs = Math.max(1, Date.now() - wakeStart);
      }

      const awake: CloudComputerSessionRecord = {
        userId,
        state: "running",
        lastActiveAt: now.toISOString(),
        sleptAt: null,
        wakeCount: wasSleeping ? current.wakeCount + 1 : current.wakeCount,
        lastWakeDurationMs: wasSleeping
          ? wakeDurationMs
          : current.lastWakeDurationMs,
        updatedAt: now.toISOString(),
      };
      sessions.set(userId, awake);
      return {
        session: { ...awake },
        wokeFromSleep: wasSleeping,
        wakeDurationMs,
      };
    },

    recordActivity({ userId, now = new Date() }) {
      const existing = sessions.get(userId);
      const next: CloudComputerSessionRecord = {
        userId,
        state: "running",
        lastActiveAt: now.toISOString(),
        sleptAt: null,
        wakeCount: existing?.wakeCount ?? 1,
        lastWakeDurationMs: existing?.lastWakeDurationMs ?? null,
        updatedAt: now.toISOString(),
      };
      sessions.set(userId, next);
      return Promise.resolve({ ...next });
    },

    async sleepIdleSessions({ now = new Date(), idleTimeoutMs, onSleep } = {}) {
      const timeout = resolveCloudIdleTimeoutMs(idleTimeoutMs);
      const sleptUserIds: string[] = [];
      for (const [userId, rec] of sessions.entries()) {
        if (rec.state !== "running") {
          continue;
        }
        const idleMs = now.getTime() - new Date(rec.lastActiveAt).getTime();
        if (idleMs >= timeout) {
          if (onSleep) {
            await Promise.resolve(onSleep(userId)).catch(() => undefined);
          }
          const updated: CloudComputerSessionRecord = {
            ...rec,
            state: "sleeping",
            sleptAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
          sessions.set(userId, updated);
          sleptUserIds.push(userId);
        }
      }
      return { sleptCount: sleptUserIds.length, sleptUserIds };
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not configured");
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 0,
  });
  return pgClient;
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

function mapSessionRow(
  row: Record<string, unknown>
): CloudComputerSessionRecord {
  return {
    userId: String(row.userId),
    state: (row.state === "running" || row.state === "waking"
      ? row.state
      : "sleeping") as CloudComputerPowerState,
    lastActiveAt: new Date(String(row.lastActiveAt)).toISOString(),
    sleptAt: row.sleptAt ? new Date(String(row.sleptAt)).toISOString() : null,
    wakeCount: Number(row.wakeCount ?? 0),
    lastWakeDurationMs:
      row.lastWakeDurationMs !== null && row.lastWakeDurationMs !== undefined
        ? Number(row.lastWakeDurationMs)
        : null,
    updatedAt: new Date(String(row.updatedAt)).toISOString(),
  };
}

export function createPostgresCloudLifecycleStore(): CloudComputerLifecycleStore {
  return {
    async getSession({ userId, now = new Date(), idleTimeoutMs }) {
      const timeout = resolveCloudIdleTimeoutMs(idleTimeoutMs);
      const sql = await readySql();
      const [row] = await sql`
        SELECT * FROM "CloudComputerSession"
        WHERE "userId" = ${userId}::uuid
        LIMIT 1
      `;
      if (!row) {
        return {
          userId,
          state: "sleeping",
          lastActiveAt: new Date(0).toISOString(),
          sleptAt: now.toISOString(),
          wakeCount: 0,
          lastWakeDurationMs: null,
          updatedAt: now.toISOString(),
        };
      }
      const mapped = mapSessionRow(row);
      const idleMs = now.getTime() - new Date(mapped.lastActiveAt).getTime();
      if (mapped.state === "running" && idleMs >= timeout) {
        const nowIso = now.toISOString();
        const [sleptRow] = await sql`
          UPDATE "CloudComputerSession"
          SET "state" = 'sleeping', "sleptAt" = ${nowIso}::timestamptz, "updatedAt" = ${nowIso}::timestamptz
          WHERE "userId" = ${userId}::uuid
          RETURNING *
        `;
        return sleptRow
          ? mapSessionRow(sleptRow)
          : { ...mapped, state: "sleeping" };
      }
      return mapped;
    },

    async ensureAwakeForTask({
      userId,
      now = new Date(),
      idleTimeoutMs,
      onWake,
    }) {
      const current = await this.getSession({ userId, now, idleTimeoutMs });
      const wasSleeping = current.state === "sleeping";
      let wakeDurationMs = 0;

      if (wasSleeping && onWake) {
        const start = Date.now();
        await onWake();
        wakeDurationMs = Math.max(1, Date.now() - start);
      } else if (wasSleeping) {
        wakeDurationMs = 1;
      }

      const nowIso = now.toISOString();
      const nextWakeCount = wasSleeping
        ? current.wakeCount + 1
        : current.wakeCount;
      const nextWakeMs = wasSleeping
        ? wakeDurationMs
        : current.lastWakeDurationMs;

      const sql = await readySql();
      const [row] = await sql`
        INSERT INTO "CloudComputerSession" (
          "userId", "state", "lastActiveAt", "sleptAt", "wakeCount", "lastWakeDurationMs", "updatedAt"
        )
        VALUES (
          ${userId}::uuid, 'running', ${nowIso}::timestamptz, NULL, ${nextWakeCount}, ${nextWakeMs}, ${nowIso}::timestamptz
        )
        ON CONFLICT ("userId")
        DO UPDATE SET
          "state" = 'running',
          "lastActiveAt" = EXCLUDED."lastActiveAt",
          "sleptAt" = NULL,
          "wakeCount" = EXCLUDED."wakeCount",
          "lastWakeDurationMs" = EXCLUDED."lastWakeDurationMs",
          "updatedAt" = EXCLUDED."updatedAt"
        RETURNING *
      `;
      return {
        session: mapSessionRow(row),
        wokeFromSleep: wasSleeping,
        wakeDurationMs,
      };
    },

    async recordActivity({ userId, now = new Date() }) {
      const nowIso = now.toISOString();
      const sql = await readySql();
      const [row] = await sql`
        INSERT INTO "CloudComputerSession" ("userId", "state", "lastActiveAt", "sleptAt", "wakeCount", "updatedAt")
        VALUES (${userId}::uuid, 'running', ${nowIso}::timestamptz, NULL, 1, ${nowIso}::timestamptz)
        ON CONFLICT ("userId")
        DO UPDATE SET
          "state" = 'running',
          "lastActiveAt" = ${nowIso}::timestamptz,
          "sleptAt" = NULL,
          "updatedAt" = ${nowIso}::timestamptz
        RETURNING *
      `;
      return mapSessionRow(row);
    },

    async sleepIdleSessions({ now = new Date(), idleTimeoutMs, onSleep } = {}) {
      const timeout = resolveCloudIdleTimeoutMs(idleTimeoutMs);
      const cutoffIso = new Date(now.getTime() - timeout).toISOString();
      const nowIso = now.toISOString();
      const sql = await readySql();
      const rows = await sql`
        UPDATE "CloudComputerSession"
        SET "state" = 'sleeping', "sleptAt" = ${nowIso}::timestamptz, "updatedAt" = ${nowIso}::timestamptz
        WHERE "state" = 'running' AND "lastActiveAt" <= ${cutoffIso}::timestamptz
        RETURNING "userId"
      `;
      const sleptUserIds = rows.map((r) => String(r.userId));
      if (onSleep) {
        for (const uid of sleptUserIds) {
          await Promise.resolve(onSleep(uid)).catch(() => undefined);
        }
      }
      return { sleptCount: sleptUserIds.length, sleptUserIds };
    },
  };
}

let fallbackLifecycleStore: CloudComputerLifecycleStore | null = null;
export function resolveCloudLifecycleStore(
  override?: CloudComputerLifecycleStore
): CloudComputerLifecycleStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresCloudLifecycleStore();
  }
  fallbackLifecycleStore ??= createInMemoryCloudLifecycleStore();
  return fallbackLifecycleStore;
}
