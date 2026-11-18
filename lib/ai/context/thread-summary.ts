import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import { getSharedPostgresClient } from "@/lib/db/shared-pool";
import type { ChatMessage } from "@/lib/types";
import {
  buildEarlierInChatSummary,
  formatEarlierInChatPromptBlock,
  LONG_CHAT_MESSAGE_THRESHOLD,
} from "./thread-summary-shared";

export {
  buildEarlierInChatSummary,
  formatEarlierInChatPromptBlock,
  LONG_CHAT_MESSAGE_THRESHOLD,
  LONG_CHAT_RECENT_WINDOW,
} from "./thread-summary-shared";

export type ThreadSummaryRecord = {
  chatId: string;
  userId: string;
  coveredUntilMessageId: string;
  coveredMessageCount: number;
  summaryText: string;
  updatedAt: string;
};

export interface ThreadSummaryStore {
  getSummary: (opts: {
    chatId: string;
    userId: string;
  }) => Promise<ThreadSummaryRecord | null>;
  upsertSummary: (opts: {
    chatId: string;
    userId: string;
    coveredUntilMessageId: string;
    coveredMessageCount: number;
    summaryText: string;
  }) => Promise<ThreadSummaryRecord>;
}

export function createInMemoryThreadSummaryStore(): ThreadSummaryStore {
  const summaries = new Map<string, ThreadSummaryRecord>();

  return {
    getSummary({ chatId, userId }) {
      const found = summaries.get(chatId);
      if (!found || found.userId !== userId) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ ...found });
    },
    upsertSummary({
      chatId,
      userId,
      coveredUntilMessageId,
      coveredMessageCount,
      summaryText,
    }) {
      const record: ThreadSummaryRecord = {
        chatId,
        userId,
        coveredUntilMessageId,
        coveredMessageCount,
        summaryText,
        updatedAt: new Date().toISOString(),
      };
      summaries.set(chatId, record);
      return Promise.resolve({ ...record });
    },
  };
}

function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not configured");
  }
  return getSharedPostgresClient(process.env.POSTGRES_URL);
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

export function createPostgresThreadSummaryStore(): ThreadSummaryStore {
  return {
    async getSummary({ chatId, userId }) {
      const sql = await readySql();
      const [row] = await sql`
        SELECT "chatId", "userId", "coveredUntilMessageId", "coveredMessageCount", "summaryText", "updatedAt"
        FROM "ChatThreadSummary"
        WHERE "chatId" = ${chatId}::uuid AND "userId" = ${userId}::uuid
        LIMIT 1
      `;
      if (!row) {
        return null;
      }
      return {
        chatId: String(row.chatId),
        userId: String(row.userId),
        coveredUntilMessageId: String(row.coveredUntilMessageId),
        coveredMessageCount: Number(row.coveredMessageCount ?? 0),
        summaryText: String(row.summaryText),
        updatedAt: new Date(String(row.updatedAt)).toISOString(),
      };
    },
    async upsertSummary({
      chatId,
      userId,
      coveredUntilMessageId,
      coveredMessageCount,
      summaryText,
    }) {
      const sql = await readySql();
      const [row] = await sql`
        INSERT INTO "ChatThreadSummary" (
          "chatId", "userId", "coveredUntilMessageId", "coveredMessageCount", "summaryText", "updatedAt"
        )
        VALUES (
          ${chatId}::uuid, ${userId}::uuid, ${coveredUntilMessageId}, ${coveredMessageCount}, ${summaryText}, now()
        )
        ON CONFLICT ("chatId")
        DO UPDATE SET
          "coveredUntilMessageId" = EXCLUDED."coveredUntilMessageId",
          "coveredMessageCount" = EXCLUDED."coveredMessageCount",
          "summaryText" = EXCLUDED."summaryText",
          "updatedAt" = now()
        RETURNING "chatId", "userId", "coveredUntilMessageId", "coveredMessageCount", "summaryText", "updatedAt"
      `;
      return {
        chatId: String(row.chatId),
        userId: String(row.userId),
        coveredUntilMessageId: String(row.coveredUntilMessageId),
        coveredMessageCount: Number(row.coveredMessageCount ?? 0),
        summaryText: String(row.summaryText),
        updatedAt: new Date(String(row.updatedAt)).toISOString(),
      };
    },
  };
}

let fallbackStore: ThreadSummaryStore | null = null;
export function resolveThreadSummaryStore(
  override?: ThreadSummaryStore
): ThreadSummaryStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresThreadSummaryStore();
  }
  fallbackStore ??= createInMemoryThreadSummaryStore();
  return fallbackStore;
}

/**
 * Computes and persists the "Earlier in this chat" summary when a thread gets
 * long (`>= threshold`), or returns an existing persisted summary so reloads
 * and retries keep earlier context even when older messages are trimmed.
 */
export async function syncThreadSummary(opts: {
  chatId: string;
  userId: string;
  messages: readonly ChatMessage[];
  store?: ThreadSummaryStore;
  threshold?: number;
  isNewChat?: boolean;
  prefetchedExisting?: ThreadSummaryRecord | null;
  hasPrefetchedExisting?: boolean;
}): Promise<{
  record: ThreadSummaryRecord | null;
  promptBlock: string;
}> {
  const threshold = opts.threshold ?? LONG_CHAT_MESSAGE_THRESHOLD;
  if (opts.isNewChat && opts.messages.length < threshold) {
    return { record: null, promptBlock: "" };
  }

  const store = resolveThreadSummaryStore(opts.store);
  const existing = opts.hasPrefetchedExisting
    ? (opts.prefetchedExisting ?? null)
    : await store
        .getSummary({ chatId: opts.chatId, userId: opts.userId })
        .catch(() => null);

  const built = buildEarlierInChatSummary(opts.messages, {
    threshold,
  });

  if (!built) {
    return {
      record: existing,
      promptBlock: existing
        ? formatEarlierInChatPromptBlock(existing.summaryText)
        : "",
    };
  }

  if (
    existing &&
    existing.coveredUntilMessageId === built.coveredUntilMessageId &&
    existing.summaryText === built.summaryText
  ) {
    return {
      record: existing,
      promptBlock: formatEarlierInChatPromptBlock(existing.summaryText),
    };
  }

  const saved = await store
    .upsertSummary({
      chatId: opts.chatId,
      userId: opts.userId,
      coveredUntilMessageId: built.coveredUntilMessageId,
      coveredMessageCount: built.coveredMessageCount,
      summaryText: built.summaryText,
    })
    .catch(() => ({
      chatId: opts.chatId,
      userId: opts.userId,
      coveredUntilMessageId: built.coveredUntilMessageId,
      coveredMessageCount: built.coveredMessageCount,
      summaryText: built.summaryText,
      updatedAt: new Date().toISOString(),
    }));

  return {
    record: saved,
    promptBlock: formatEarlierInChatPromptBlock(saved.summaryText),
  };
}
