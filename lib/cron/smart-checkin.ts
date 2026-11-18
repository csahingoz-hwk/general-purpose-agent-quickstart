import postgres from "postgres";
import { computeNextRunAt } from "@/lib/cron/cron-utils";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";

export const ACTIVE_CHAT_SKIP_WINDOW_MS = 20 * 60 * 1000; // 20 minutes
export const SILENT_RUNS_BACKOFF_THRESHOLD = 3;
export const MAX_BACKOFF_MULTIPLIER = 8;

export type CheckInOutcome =
  | "delivered"
  | "silent"
  | "skipped_active_chat"
  | "skipped_backoff";

export type RoutineCheckInStateRecord = {
  scheduleId: string;
  userId: string;
  consecutiveSilentRuns: number;
  backoffMultiplier: number;
  lastOutcome: CheckInOutcome | null;
  lastCheckedAt: string | null;
  nextEligibleAt: string | null;
};

const SILENT_OUTPUT_RE =
  /^\s*(?:\[?\s*(?:QUIET|NO_UPDATE|NOTHING_NEW|NO_ACTION_NEEDED|SILENT)\s*\]?|nothing\s+(?:new|useful|urgent|to\s+report)(?:\s+right\s+now|\s+today)?\.?|no\s+(?:new|urgent|important)\s+(?:updates?|messages?|emails?|events?)(?:\s+found)?\.?|yeni\s+(?:bir\s+)?(?:gelişme|güncelleme|bildirim|mesaj|e-?posta)\s+yok\.?|önemli\s+bir\s+(?:durum|gelişme)\s+yok\.?)\s*$/iu;

/**
 * Returns true when a scheduled check-in produced no actionable/useful news
 * and should remain completely quiet rather than notifying the owner.
 */
export function isSilentCheckInOutput(
  output: string | null | undefined
): boolean {
  if (!output) {
    return true;
  }
  const trimmed = output.trim();
  if (!trimmed) {
    return true;
  }
  return SILENT_OUTPUT_RE.test(trimmed);
}

export function computeSilentBackoffMultiplier(
  consecutiveSilentRuns: number,
  threshold = SILENT_RUNS_BACKOFF_THRESHOLD
): number {
  if (consecutiveSilentRuns < threshold) {
    return 1;
  }
  const exponent = consecutiveSilentRuns - threshold + 1;
  return Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** exponent);
}

/**
 * Advances a cron schedule `multiplier` steps forward so backed-off silent
 * check-ins wait longer before polling again.
 */
export function computeBackedOffNextRunAt(opts: {
  cronExpression: string;
  timezone: string;
  from: Date;
  multiplier: number;
}): Date {
  const steps = Math.max(1, Math.min(MAX_BACKOFF_MULTIPLIER, opts.multiplier));
  let cursor = opts.from;
  for (let i = 0; i < steps; i++) {
    cursor = computeNextRunAt(opts.cronExpression, opts.timezone, cursor);
  }
  return cursor;
}

export interface CheckInStateStore {
  getState: (scheduleId: string) => Promise<RoutineCheckInStateRecord | null>;
  saveState: (
    record: RoutineCheckInStateRecord
  ) => Promise<RoutineCheckInStateRecord>;
  getLastUserChatAt: (userId: string) => Promise<Date | null>;
}

export function createInMemoryCheckInStateStore(seed?: {
  lastUserChatByUser?: Record<string, Date>;
}): CheckInStateStore & {
  setLastUserChatAt: (userId: string, at: Date | null) => void;
} {
  const states = new Map<string, RoutineCheckInStateRecord>();
  const lastChat = new Map<string, Date>(
    Object.entries(seed?.lastUserChatByUser ?? {})
  );

  return {
    getState(scheduleId) {
      const found = states.get(scheduleId);
      return Promise.resolve(found ? { ...found } : null);
    },
    saveState(record) {
      const copy = { ...record };
      states.set(record.scheduleId, copy);
      return Promise.resolve({ ...copy });
    },
    getLastUserChatAt(userId) {
      return Promise.resolve(lastChat.get(userId) ?? null);
    },
    setLastUserChatAt(userId, at) {
      if (at === null) {
        lastChat.delete(userId);
      } else {
        lastChat.set(userId, at);
      }
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not configured");
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 2,
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

export function createPostgresCheckInStateStore(): CheckInStateStore {
  return {
    async getState(scheduleId) {
      const sql = await readySql();
      const [row] = await sql`
        SELECT * FROM "RoutineCheckInState"
        WHERE "scheduleId" = ${scheduleId}::uuid
        LIMIT 1
      `;
      if (!row) {
        return null;
      }
      return {
        scheduleId: String(row.scheduleId),
        userId: String(row.userId),
        consecutiveSilentRuns: Number(row.consecutiveSilentRuns ?? 0),
        backoffMultiplier: Number(row.backoffMultiplier ?? 1),
        lastOutcome: (row.lastOutcome as CheckInOutcome) ?? null,
        lastCheckedAt: row.lastCheckedAt
          ? new Date(String(row.lastCheckedAt)).toISOString()
          : null,
        nextEligibleAt: row.nextEligibleAt
          ? new Date(String(row.nextEligibleAt)).toISOString()
          : null,
      };
    },
    async saveState(record) {
      const sql = await readySql();
      const [row] = await sql`
        INSERT INTO "RoutineCheckInState" (
          "scheduleId", "userId", "consecutiveSilentRuns", "backoffMultiplier", "lastOutcome", "lastCheckedAt", "nextEligibleAt"
        )
        VALUES (
          ${record.scheduleId}::uuid,
          ${record.userId}::uuid,
          ${record.consecutiveSilentRuns},
          ${record.backoffMultiplier},
          ${record.lastOutcome},
          ${record.lastCheckedAt}::timestamptz,
          ${record.nextEligibleAt}::timestamptz
        )
        ON CONFLICT ("scheduleId")
        DO UPDATE SET
          "consecutiveSilentRuns" = EXCLUDED."consecutiveSilentRuns",
          "backoffMultiplier" = EXCLUDED."backoffMultiplier",
          "lastOutcome" = EXCLUDED."lastOutcome",
          "lastCheckedAt" = EXCLUDED."lastCheckedAt",
          "nextEligibleAt" = EXCLUDED."nextEligibleAt"
        RETURNING *
      `;
      return {
        scheduleId: String(row.scheduleId),
        userId: String(row.userId),
        consecutiveSilentRuns: Number(row.consecutiveSilentRuns ?? 0),
        backoffMultiplier: Number(row.backoffMultiplier ?? 1),
        lastOutcome: (row.lastOutcome as CheckInOutcome) ?? null,
        lastCheckedAt: row.lastCheckedAt
          ? new Date(String(row.lastCheckedAt)).toISOString()
          : null,
        nextEligibleAt: row.nextEligibleAt
          ? new Date(String(row.nextEligibleAt)).toISOString()
          : null,
      };
    },
    async getLastUserChatAt(userId) {
      const sql = await readySql();
      const [row] = await sql`
        SELECT m."createdAt"
        FROM "Message_v2" AS m
        INNER JOIN "Chat" AS c ON c."id" = m."chatId"
        WHERE c."userId" = ${userId}::uuid AND m."role" = 'user'
        ORDER BY m."createdAt" DESC
        LIMIT 1
      `.catch(() => []);
      return row?.createdAt ? new Date(String(row.createdAt)) : null;
    },
  };
}

let fallbackCheckInStore: CheckInStateStore | null = null;
export function resolveCheckInStateStore(
  override?: CheckInStateStore
): CheckInStateStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresCheckInStateStore();
  }
  fallbackCheckInStore ??= createInMemoryCheckInStateStore();
  return fallbackCheckInStore;
}

/**
 * Item 11: Evaluates a scheduled check-in run with three guardrails:
 * 1. Skip if the user chatted within the last 20 minutes (`skipped_active_chat`).
 * 2. Respect `nextEligibleAt` when backed off (`skipped_backoff`).
 * 3. Stay quiet when nothing useful happened (`silent`), incrementing
 *    `consecutiveSilentRuns` and applying exponential backoff after 3+ silent
 *    runs; reset backoff immediately when useful news is delivered (`delivered`).
 */
export async function runSmartScheduledCheckIn(opts: {
  scheduleId: string;
  userId: string;
  cronExpression: string;
  timezone: string;
  now?: Date;
  activeChatWindowMs?: number;
  silentThreshold?: number;
  store?: CheckInStateStore;
  evaluate: () => Promise<string | { output: string; useful?: boolean }>;
}): Promise<{
  outcome: CheckInOutcome;
  notified: boolean;
  output: string | null;
  state: RoutineCheckInStateRecord;
  nextRunAt: Date;
}> {
  const now = opts.now ?? new Date();
  const activeWindowMs = opts.activeChatWindowMs ?? ACTIVE_CHAT_SKIP_WINDOW_MS;
  const silentThreshold = opts.silentThreshold ?? SILENT_RUNS_BACKOFF_THRESHOLD;
  const store = resolveCheckInStateStore(opts.store);

  const existing = (await store.getState(opts.scheduleId)) ?? {
    scheduleId: opts.scheduleId,
    userId: opts.userId,
    consecutiveSilentRuns: 0,
    backoffMultiplier: 1,
    lastOutcome: null,
    lastCheckedAt: null,
    nextEligibleAt: null,
  };

  // 1. Honor active backoff window if still before nextEligibleAt
  if (
    existing.nextEligibleAt &&
    new Date(existing.nextEligibleAt).getTime() > now.getTime()
  ) {
    const updated = await store.saveState({
      ...existing,
      lastOutcome: "skipped_backoff",
      lastCheckedAt: now.toISOString(),
    });
    return {
      outcome: "skipped_backoff",
      notified: false,
      output: null,
      state: updated,
      nextRunAt: new Date(existing.nextEligibleAt),
    };
  }

  // 2. Skip if the owner chatted in the last 20 minutes
  const lastChatAt = await store.getLastUserChatAt(opts.userId);
  if (
    lastChatAt &&
    now.getTime() >= lastChatAt.getTime() &&
    now.getTime() - lastChatAt.getTime() < activeWindowMs
  ) {
    const nextSlot = computeNextRunAt(opts.cronExpression, opts.timezone, now);
    const updated = await store.saveState({
      ...existing,
      lastOutcome: "skipped_active_chat",
      lastCheckedAt: now.toISOString(),
    });
    return {
      outcome: "skipped_active_chat",
      notified: false,
      output: null,
      state: updated,
      nextRunAt: nextSlot,
    };
  }

  // 3. Run the check-in evaluator
  const rawResult = await opts.evaluate();
  const rawOutput =
    typeof rawResult === "string" ? rawResult : rawResult.output;
  const explicitUseful =
    typeof rawResult === "object" && rawResult !== null
      ? rawResult.useful
      : undefined;
  const isSilent =
    explicitUseful === false ||
    (explicitUseful === undefined && isSilentCheckInOutput(rawOutput));

  if (isSilent) {
    const nextSilentCount = existing.consecutiveSilentRuns + 1;
    const multiplier = computeSilentBackoffMultiplier(
      nextSilentCount,
      silentThreshold
    );
    const nextRunAt = computeBackedOffNextRunAt({
      cronExpression: opts.cronExpression,
      timezone: opts.timezone,
      from: now,
      multiplier,
    });
    const updated = await store.saveState({
      scheduleId: opts.scheduleId,
      userId: opts.userId,
      consecutiveSilentRuns: nextSilentCount,
      backoffMultiplier: multiplier,
      lastOutcome: "silent",
      lastCheckedAt: now.toISOString(),
      nextEligibleAt: multiplier > 1 ? nextRunAt.toISOString() : null,
    });
    return {
      outcome: "silent",
      notified: false,
      output: null,
      state: updated,
      nextRunAt,
    };
  }

  // Useful news -> deliver and reset silent/backoff counters!
  const nextRunAt = computeNextRunAt(opts.cronExpression, opts.timezone, now);
  const updated = await store.saveState({
    scheduleId: opts.scheduleId,
    userId: opts.userId,
    consecutiveSilentRuns: 0,
    backoffMultiplier: 1,
    lastOutcome: "delivered",
    lastCheckedAt: now.toISOString(),
    nextEligibleAt: null,
  });

  return {
    outcome: "delivered",
    notified: true,
    output: rawOutput.trim(),
    state: updated,
    nextRunAt,
  };
}
