import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import postgres from "postgres";
import { estimateReferenceModelUsd } from "@/lib/billing/vertex-cloud-usage";
import {
  ARGON,
  COPILOT_HAIKU,
  HYDROGEN,
  isCopilotFallbackModel,
  isVertexModel,
  type PremiumModelId,
} from "./catalog";
import { usageCost } from "./cost";

let client: ReturnType<typeof postgres> | undefined;
function sql() {
  if (!process.env.POSTGRES_URL?.trim()) {
    return null;
  }
  client ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 0,
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
    /** Non-token spend for informational stats only. */
    extraUsd?: number
  ) => Promise<void>;
};

/**
 * Estimate stored when a call settles (informational only; no spend cap exists).
 */
export function settledEstimate(tokenUsd: number | undefined, extraUsd = 0) {
  return tokenUsd === undefined ? null : tokenUsd + Math.max(0, extraUsd);
}

/**
 * Informational-only call & token recorder.
 * All active models (`gemini-4-hydrogen`, `gemini-4-argon` on Google AI Ultra credit,
 * and `claude-haiku-5.5` on GitHub Copilot subscription) are subscription/credit-covered
 * with zero pay-per-use models, so `reserve` NEVER blocks or enforces an internal cap.
 */
export function createUsageLedger(
  userId: string,
  requestId: string
): UsageLedger {
  return {
    reserve({ model, fallbackReason }) {
      const prefix = isVertexModel(model)
        ? "vertex"
        : isCopilotFallbackModel(model)
          ? "copilot"
          : "stat";
      return Promise.resolve(
        `${prefix}:${crypto.randomUUID()}:${fallbackReason ?? ""}`
      );
    },
    async settle(id, model, outcome, usage, extraUsd = 0) {
      const db = sql();
      if (!db) {
        return;
      }
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
      const parts = id.split(":");
      const rawId =
        parts.length >= 2 && parts[1] ? parts[1] : crypto.randomUUID();
      const rawReason = parts.length >= 3 ? parts.slice(2).join(":") : "";

      await db`INSERT INTO "ModelUsage" ("id","userId","requestId","model","fallbackReason","reservedUsd","estimatedUsd","inputTokens","cachedInputTokens","cacheWriteTokens","outputTokens","reasoningTokens","usageReported","outcome") VALUES (${rawId},${userId},${requestId},${model},${rawReason || null},${0},${estimatedUsd},${rawInput},${rawCached},${rawCacheWrite},${rawOutput},${rawReasoning},${hasRealTokens},${outcome})`.catch(
        () => undefined
      );
    },
  };
}

export type PerModelUsageRow = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  referenceCostUsd: number;
};

export function summarizeCallsByModel(
  rows: ReadonlyArray<{
    model: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }>
): PerModelUsageRow[] {
  const bucket = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number }
  >();
  for (const baseModel of [HYDROGEN, ARGON, COPILOT_HAIKU]) {
    bucket.set(baseModel, { calls: 0, inputTokens: 0, outputTokens: 0 });
  }
  for (const row of rows) {
    const cur = bucket.get(row.model) ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    cur.calls += 1;
    cur.inputTokens += Number(row.inputTokens ?? 0);
    cur.outputTokens += Number(row.outputTokens ?? 0);
    bucket.set(row.model, cur);
  }
  return [...bucket.entries()].map(([model, agg]) => ({
    model,
    calls: agg.calls,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    totalTokens: agg.inputTokens + agg.outputTokens,
    referenceCostUsd:
      Math.round(
        estimateReferenceModelUsd(model, agg.inputTokens, agg.outputTokens) *
          10_000
      ) / 10_000,
  }));
}

export async function usageSummary(userId: string) {
  const db = sql();
  if (!db) {
    return {
      timezone: "UTC",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      invocations: 0,
      requests: 0,
      fallbackInvocations: 0,
      byModel: summarizeCallsByModel([]),
      calls: [],
    };
  }
  const rows = await db<
    {
      model: string;
      requestId: string;
      fallbackReason: string | null;
      createdAt: Date;
      inputTokens: number | null;
      cachedInputTokens: number | null;
      cacheWriteTokens: number | null;
      outputTokens: number | null;
      reasoningTokens: number | null;
      usageReported: boolean;
      outcome: string;
    }[]
  >`
    SELECT "model", "requestId", "fallbackReason", "createdAt", "inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "usageReported", "outcome"
    FROM "ModelUsage"
    WHERE "userId" = ${userId}
      AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ORDER BY "createdAt" DESC
    LIMIT 500
  `;
  const totalInputTokens = rows.reduce(
    (sum, r) => sum + Number(r.inputTokens ?? 0),
    0
  );
  const totalOutputTokens = rows.reduce(
    (sum, r) => sum + Number(r.outputTokens ?? 0),
    0
  );
  return {
    timezone: "UTC",
    totalInputTokens,
    totalOutputTokens,
    invocations: rows.length,
    requests: new Set(rows.map((r) => r.requestId)).size,
    fallbackInvocations: rows.filter((r) => r.fallbackReason).length,
    byModel: summarizeCallsByModel(rows),
    calls: rows,
  };
}
