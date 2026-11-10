import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import postgres from "postgres";
import { monthlyAllowance, type PremiumModelId } from "./catalog";
import { usageCost } from "./cost";
import { ModelFailure } from "./policy";

let client: ReturnType<typeof postgres> | undefined;
function sql() {
  if (!process.env.POSTGRES_URL) {
    throw new ModelFailure("spend");
  }
  client ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 2,
  });
  return client;
}
export type Invocation = {
  model: PremiumModelId;
  reserveUsd: number;
  fallbackReason?: string;
};
export type UsageLedger = {
  reserve: (call: Invocation) => Promise<string>;
  settle: (
    id: string,
    model: PremiumModelId,
    outcome: string,
    usage?: LanguageModelV4Usage,
    /** Non-token spend for this call (web search), added to the estimate. */
    extraUsd?: number
  ) => Promise<void>;
};
/**
 * Estimate stored when a call settles. Token usage plus non-token spend (web
 * search). Without reported usage this stays null so the full reservation, which
 * already includes the capped search cost, remains counted.
 */
export function settledEstimate(tokenUsd: number | undefined, extraUsd = 0) {
  return tokenUsd === undefined ? null : tokenUsd + Math.max(0, extraUsd);
}
export function createUsageLedger(
  userId: string,
  requestId: string
): UsageLedger {
  return {
    async reserve({ model, reserveUsd, fallbackReason }) {
      if (!Number.isFinite(reserveUsd) || reserveUsd <= 0) {
        throw new ModelFailure("spend");
      }
      const limit = monthlyAllowance();
      return await sql().begin(async (tx) => {
        // Transaction lock serializes reservations across chats/server instances.
        // UTC accounting; do not hold this lock during provider I/O.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`model-spend:${userId}`}, 0))`;
        const [total] =
          await tx`SELECT COALESCE(SUM(COALESCE("estimatedUsd", "reservedUsd")),0) AS usd FROM "ModelUsage" WHERE "userId"=${userId} AND "createdAt">=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
        if (Number(total.usd) + reserveUsd > limit) {
          throw new ModelFailure("spend");
        }
        const id = crypto.randomUUID();
        await tx`INSERT INTO "ModelUsage" ("id","userId","requestId","model","fallbackReason","reservedUsd") VALUES (${id},${userId},${requestId},${model},${fallbackReason ?? null},${reserveUsd})`;
        return id;
      });
    },
    async settle(id, model, outcome, usage, extraUsd = 0) {
      const cost = usage && usageCost(model, usage);
      const estimatedUsd = settledEstimate(cost?.usd, extraUsd);
      // Unknown usage retains the full reservation, even on disconnect/cancel.
      // This deliberately favors stopping early over undercounting lost calls.
      await sql()`UPDATE "ModelUsage" SET "outcome"=${outcome}, "estimatedUsd"=${estimatedUsd}, "inputTokens"=${cost?.input ?? null}, "cachedInputTokens"=${cost?.cached ?? null}, "cacheWriteTokens"=${cost?.cacheWrite ?? null}, "outputTokens"=${cost?.output ?? null}, "reasoningTokens"=${cost?.reasoning ?? null}, "usageReported"=${Boolean(cost)} WHERE "id"=${id} AND "userId"=${userId}`;
    },
  };
}
export async function usageSummary(userId: string) {
  const rows =
    await sql()`SELECT "model", "requestId", "fallbackReason", "createdAt", "reservedUsd", "estimatedUsd", "inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "usageReported", "outcome" FROM "ModelUsage" WHERE "userId"=${userId} AND "createdAt">=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' ORDER BY "createdAt" DESC`;
  const today = new Date().toISOString().slice(0, 10);
  const cost = (row: (typeof rows)[number]) =>
    Number(row.estimatedUsd ?? row.reservedUsd);
  return {
    currency: "USD",
    timezone: "UTC",
    allowanceUsd: monthlyAllowance(),
    monthlyEstimatedUsd: rows.reduce((sum, r) => sum + cost(r), 0),
    dailyEstimatedUsd: rows
      .filter((r) => r.createdAt.toISOString().startsWith(today))
      .reduce((sum, r) => sum + cost(r), 0),
    invocations: rows.length,
    requests: new Set(rows.map((r) => r.requestId)).size,
    fallbackInvocations: rows.filter((r) => r.fallbackReason).length,
    fallbackEstimatedUsd: rows
      .filter((r) => r.fallbackReason)
      .reduce((sum, r) => sum + cost(r), 0),
    unreportedInvocations: rows.filter((r) => !r.usageReported).length,
    calls: rows,
  };
}
