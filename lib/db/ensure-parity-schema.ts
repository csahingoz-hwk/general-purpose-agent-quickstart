import type postgres from "postgres";

const ensuredClients = new WeakSet<object>();
let inflightPromise: Promise<void> | null = null;

/**
 * Idempotently creates all additive owner-assistant tables (ModelUsage,
 * MemoryProfileFact, MemoryJournalEntry, VaultSecret, BackgroundTask,
 * SkillEntry, BotProfile, ChatBotBinding, RoutineTrigger, PublishedPage,
 * and PrivateFile) on first connection or during `lib/db/migrate.ts`.
 *
 * Uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` only — never
 * drops or alters existing user/chat columns.
 */
export async function ensureParitySchema(
  sql: ReturnType<typeof postgres>
): Promise<void> {
  if (ensuredClients.has(sql as unknown as object)) {
    return;
  }
  if (inflightPromise) {
    await inflightPromise;
    ensuredClients.add(sql as unknown as object);
    return;
  }

  inflightPromise = (async () => {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "ModelUsage" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
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
      CREATE INDEX IF NOT EXISTS "ModelUsage_owner_date"
        ON "ModelUsage" ("userId", "createdAt");

      CREATE TABLE IF NOT EXISTS "MemoryProfileFact" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "category" varchar(48) NOT NULL DEFAULT 'general',
        "key" varchar(120) NOT NULL,
        "value" text NOT NULL,
        "sharedAcrossBots" boolean NOT NULL DEFAULT true,
        "botSlug" varchar(80),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "key")
      );
      ALTER TABLE "MemoryProfileFact"
        ADD COLUMN IF NOT EXISTS "botSlug" varchar(80);
      CREATE INDEX IF NOT EXISTS "MemoryProfileFact_user_updated"
        ON "MemoryProfileFact" ("userId", "updatedAt" DESC);

      CREATE TABLE IF NOT EXISTS "MemoryJournalEntry" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "source" varchar(48) NOT NULL DEFAULT 'chat',
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "MemoryJournalEntry_user_created"
        ON "MemoryJournalEntry" ("userId", "createdAt" DESC);

      CREATE TABLE IF NOT EXISTS "VaultSecret" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "name" varchar(120) NOT NULL,
        "provider" varchar(64) NOT NULL DEFAULT 'custom',
        "ciphertext" text NOT NULL,
        "iv" varchar(64) NOT NULL,
        "authTag" varchar(64) NOT NULL,
        "keyHint" varchar(16) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "name")
      );
      CREATE INDEX IF NOT EXISTS "VaultSecret_user_name"
        ON "VaultSecret" ("userId", "name");

      CREATE TABLE IF NOT EXISTS "BackgroundTask" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "kind" varchar(48) NOT NULL DEFAULT 'routine',
        "title" varchar(200) NOT NULL,
        "prompt" text NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'queued',
        "riskLevel" varchar(16) NOT NULL DEFAULT 'medium',
        "scheduleId" uuid REFERENCES "CronJob"("id") ON DELETE SET NULL,
        "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "output" text,
        "error" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "startedAt" timestamptz,
        "finishedAt" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "BackgroundTask_user_created"
        ON "BackgroundTask" ("userId", "createdAt" DESC);

      CREATE TABLE IF NOT EXISTS "SkillEntry" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "slug" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(280) NOT NULL,
        "instructions" text NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "slug")
      );
      CREATE INDEX IF NOT EXISTS "SkillEntry_user_slug"
        ON "SkillEntry" ("userId", "slug");

      CREATE TABLE IF NOT EXISTS "BotProfile" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "slug" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(280) NOT NULL DEFAULT '',
        "soul" text NOT NULL,
        "defaultModel" varchar(64) NOT NULL DEFAULT 'gpt-6-luna',
        "mascotVariant" varchar(32) NOT NULL DEFAULT 'blue',
        "skillSlugs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "slug")
      );
      CREATE INDEX IF NOT EXISTS "BotProfile_user_slug"
        ON "BotProfile" ("userId", "slug");

      CREATE TABLE IF NOT EXISTS "ChatBotBinding" (
        "chatId" uuid PRIMARY KEY REFERENCES "Chat"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "botSlug" varchar(80) NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "RoutineTrigger" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "source" varchar(64) NOT NULL,
        "eventFilter" varchar(120) NOT NULL DEFAULT '*',
        "title" varchar(180) NOT NULL,
        "promptTemplate" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "RoutineTrigger_user_source"
        ON "RoutineTrigger" ("userId", "source");

      CREATE TABLE IF NOT EXISTS "PublishedPage" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "title" varchar(160) NOT NULL,
        "sanitizedPayload" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz
      );
      CREATE INDEX IF NOT EXISTS "PublishedPage_user_created"
        ON "PublishedPage" ("userId", "createdAt" DESC);

      CREATE TABLE IF NOT EXISTS "PrivateFile" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "envelope" bytea NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "PrivateFile_user_created"
        ON "PrivateFile" ("userId", "createdAt" DESC);
    `);
    ensuredClients.add(sql as unknown as object);
  })().finally(() => {
    inflightPromise = null;
  });

  await inflightPromise;
}
