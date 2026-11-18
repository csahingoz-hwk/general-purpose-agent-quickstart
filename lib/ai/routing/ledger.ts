import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import postgres from "postgres";
import {
  createPostgresVaultStore,
  isVaultConfigured,
} from "@/lib/vault/secret-vault";
import {
  isCopilotFallbackModel,
  isVertexModel,
  MAX_MONTHLY_ALLOWANCE_USD,
  type PremiumModelId,
  safeMonthlyAllowance,
} from "./catalog";
import { usageCost } from "./cost";
import { ModelFailure } from "./policy";

export const OWNER_ALLOWANCE_VAULT_SECRET = "OWNER_MONTHLY_ALLOWANCE_USD";

let client: ReturnType<typeof postgres> | undefined;
function sql() {
  if (!process.env.POSTGRES_URL) {
    throw new ModelFailure("spend");
  }
  client ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 0,
  });
  return client;
}

const allowanceCache = new Map<
  string,
  { value: number | null; expiresAt: number }
>();

export async function resolveOwnerAllowanceUsd(
  userId: string
): Promise<number> {
  if (process.env.POSTGRES_URL && isVaultConfigured()) {
    const cached = allowanceCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return safeMonthlyAllowance(cached.value);
    }
    try {
      const raw = await createPostgresVaultStore().resolveSecret({
        userId,
        name: OWNER_ALLOWANCE_VAULT_SECRET,
      });
      const parsed = raw ? Number(raw.trim()) : null;
      const valid =
        parsed !== null &&
        Number.isFinite(parsed) &&
        parsed > 0 &&
        parsed <= MAX_MONTHLY_ALLOWANCE_USD
          ? parsed
          : null;
      allowanceCache.set(userId, {
        value: valid,
        expiresAt: Date.now() + 5 * 60_000,
      });
      return safeMonthlyAllowance(valid);
    } catch {
      /* fall back to env/default */
    }
  }
  return safeMonthlyAllowance();
}

export async function saveOwnerAllowanceUsd(
  userId: string,
  allowanceUsd: number
): Promise<number> {
  if (
    !Number.isFinite(allowanceUsd) ||
    allowanceUsd <= 0 ||
    allowanceUsd > MAX_MONTHLY_ALLOWANCE_USD
  ) {
    throw new Error("spend_configuration");
  }
  const rounded = Math.round(allowanceUsd * 100) / 100;
  await createPostgresVaultStore().upsertSecret({
    userId,
    name: OWNER_ALLOWANCE_VAULT_SECRET,
    provider: "custom",
    plaintext: String(rounded),
  });
  allowanceCache.set(userId, {
    value: rounded,
    expiresAt: Date.now() + 5 * 60_000,
  });
  return rounded;
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
 * search). Without reported usage this stays null so active reservations remain
 * visible until reconciled.
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
      // Both Vertex AI (`gemini-4-hydrogen`, `gemini-4-argon` on Ultra credit)
      // and Copilot (`claude-haiku-5.5` on GitHub Copilot subscription) carry
      // $0 pay-per-use cash spend (`reserveUsd === 0`), so never fail on `<= 0`
      // or take advisory locks before streaming.
      if (isVertexModel(model) && reserveUsd === 0) {
        return `vertex:${crypto.randomUUID()}:${fallbackReason ?? ""}`;
      }
      if (isCopilotFallbackModel(model) && reserveUsd === 0) {
        return `copilot:${crypto.randomUUID()}:${fallbackReason ?? ""}`;
      }
      if (!Number.isFinite(reserveUsd) || reserveUsd <= 0) {
        throw new ModelFailure("spend");
      }
      const limit = await resolveOwnerAllowanceUsd(userId);
      return await sql().begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`model-spend:${userId}`}, 0))`;
        // Count real settled `estimatedUsd` plus only recent (<10m) in-flight reservations
        // so abandoned preview test reservations never permanently lock out production.
        const [total] = await tx`
          SELECT COALESCE(
            SUM(
              CASE
                WHEN "estimatedUsd" IS NOT NULL THEN "estimatedUsd"
                WHEN "outcome" = 'reserved' AND "createdAt" >= now() - interval '10 minutes' THEN "reservedUsd"
                ELSE 0
              END
            ),
            0
          ) AS usd
          FROM "ModelUsage"
          WHERE "userId" = ${userId}
            AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        `;
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
      const rawInput = usage?.inputTokens.total ?? cost?.input ?? null;
      const rawCached = usage?.inputTokens.cacheRead ?? cost?.cached ?? null;
      const rawCacheWrite =
        usage?.inputTokens.cacheWrite ?? cost?.cacheWrite ?? null;
      const rawOutput = usage?.outputTokens.total ?? cost?.output ?? null;
      const rawReasoning =
        usage?.outputTokens.reasoning ?? cost?.reasoning ?? null;
      const hasRealTokens =
        Boolean(cost) || (rawInput !== null && rawOutput !== null);
      const estimatedUsd = settledEstimate(cost?.usd, extraUsd);

      if (id.startsWith("vertex:") || id.startsWith("copilot:")) {
        if (!process.env.POSTGRES_URL) {
          return;
        }
        const [, rawId = crypto.randomUUID(), rawReason = ""] = id.split(":");
        await sql()`INSERT INTO "ModelUsage" ("id","userId","requestId","model","fallbackReason","reservedUsd","estimatedUsd","inputTokens","cachedInputTokens","cacheWriteTokens","outputTokens","reasoningTokens","usageReported","outcome") VALUES (${rawId},${userId},${requestId},${model},${rawReason || null},${0},${0},${rawInput},${rawCached},${rawCacheWrite},${rawOutput},${rawReasoning},${hasRealTokens},${outcome})`.catch(
          () => undefined
        );
        return;
      }
      await sql()`UPDATE "ModelUsage" SET "outcome"=${outcome}, "estimatedUsd"=${estimatedUsd}, "inputTokens"=${rawInput}, "cachedInputTokens"=${rawCached}, "cacheWriteTokens"=${rawCacheWrite}, "outputTokens"=${rawOutput}, "reasoningTokens"=${rawReasoning}, "usageReported"=${hasRealTokens} WHERE "id"=${id} AND "userId"=${userId}`;
    },
  };
}

export async function usageSummary(userId: string) {
  const [allowanceUsd, rows] = await Promise.all([
    resolveOwnerAllowanceUsd(userId),
    sql()`SELECT "model", "requestId", "fallbackReason", "createdAt", "reservedUsd", "estimatedUsd", "inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "usageReported", "outcome" FROM "ModelUsage" WHERE "userId"=${userId} AND "createdAt">=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' ORDER BY "createdAt" DESC`,
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const settledCost = (row: (typeof rows)[number]) =>
    Number(
      row.estimatedUsd ?? (row.outcome === "reserved" ? row.reservedUsd : 0)
    );
  const totalInputTokens = rows.reduce(
    (sum, r) => sum + Number(r.inputTokens ?? 0),
    0
  );
  const totalOutputTokens = rows.reduce(
    (sum, r) => sum + Number(r.outputTokens ?? 0),
    0
  );
  return {
    currency: "USD",
    timezone: "UTC",
    allowanceUsd,
    monthlyEstimatedUsd: rows.reduce((sum, r) => sum + settledCost(r), 0),
    dailyEstimatedUsd: rows
      .filter((r) => r.createdAt.toISOString().startsWith(today))
      .reduce((sum, r) => sum + settledCost(r), 0),
    totalInputTokens,
    totalOutputTokens,
    invocations: rows.length,
    requests: new Set(rows.map((r) => r.requestId)).size,
    fallbackInvocations: rows.filter((r) => r.fallbackReason).length,
    fallbackEstimatedUsd: rows
      .filter((r) => r.fallbackReason)
      .reduce((sum, r) => sum + settledCost(r), 0),
    unreportedInvocations: rows.filter((r) => !r.usageReported).length,
    calls: rows,
  };
}
