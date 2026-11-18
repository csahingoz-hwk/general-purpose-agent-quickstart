-- Additive usage ledger. Apply to an approved database explicitly, never from
-- the normal preview build (preview and production may share Neon settings).
CREATE TABLE IF NOT EXISTS "ModelUsage" (
  "id" uuid PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES "User"("id"),
  "requestId" uuid NOT NULL,
  "model" text NOT NULL,
  "fallbackReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "reservedUsd" numeric(16,9) NOT NULL CHECK ("reservedUsd" >= 0),
  "estimatedUsd" numeric(16,9),
  "inputTokens" integer,
  "cachedInputTokens" integer,
  "cacheWriteTokens" integer,
  "outputTokens" integer,
  "reasoningTokens" integer,
  "usageReported" boolean NOT NULL DEFAULT false,
  "outcome" text NOT NULL DEFAULT 'reserved'
);
CREATE INDEX IF NOT EXISTS "ModelUsage_owner_date" ON "ModelUsage" ("userId", "createdAt");
