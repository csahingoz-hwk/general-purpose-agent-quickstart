import type postgres from "postgres";

let schemaEnsuredForProcess = false;
let inflightPromise: Promise<void> | null = null;

export function resetParitySchemaStateForTests(): void {
  schemaEnsuredForProcess = false;
  inflightPromise = null;
}

/**
 * Idempotently creates all additive owner-assistant tables once per process
 * (or during `lib/db/migrate.ts`). Fast-paths via `to_regclass` when tables
 * already exist so runtime requests emit zero Postgres 42P07 "already exists"
 * notices and take zero catalog locks.
 */
export async function ensureParitySchema(
  sql: ReturnType<typeof postgres>
): Promise<void> {
  if (schemaEnsuredForProcess) {
    return;
  }
  if (inflightPromise) {
    await inflightPromise;
    return;
  }

  inflightPromise = (async () => {
    const existing = await sql<
      {
        pf: string | null;
        rt: string | null;
        cb: string | null;
        mpf: string | null;
        oas: string | null;
        rtpe: string | null;
      }[]
    >`
      SELECT
        to_regclass('public."PrivateFile"')::text AS pf,
        to_regclass('public."RoutineTrigger"')::text AS rt,
        to_regclass('public."ChatBotBinding"')::text AS cb,
        to_regclass('public."MemoryProfileFact"')::text AS mpf,
        to_regclass('public."OwnerAssistantSettings"')::text AS oas,
        to_regclass('public."RoutineTriggerProcessedEvent"')::text AS rtpe
    `.catch(() => []);
    const row = existing[0];
    const hasCoreTables = Boolean(row?.pf && row?.rt && row?.cb && row?.mpf);
    const missingAutonomyTables =
      row !== undefined &&
      ("oas" in row || "rtpe" in row) &&
      (!row.oas || !row.rtpe);
    if (hasCoreTables && !missingAutonomyTables) {
      schemaEnsuredForProcess = true;
      return;
    }

    await sql.unsafe(`
      SET client_min_messages TO warning;
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
        "category" varchar(48) NOT NULL DEFAULT 'about_me',
        "key" varchar(120) NOT NULL,
        "value" text NOT NULL,
        "source" varchar(64) NOT NULL DEFAULT 'chat',
        "pinned" boolean NOT NULL DEFAULT false,
        "learnedAt" timestamptz NOT NULL DEFAULT now(),
        "sharedAcrossBots" boolean NOT NULL DEFAULT true,
        "botSlug" varchar(80),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "key")
      );
      ALTER TABLE "MemoryProfileFact"
        ADD COLUMN IF NOT EXISTS "botSlug" varchar(80);
      ALTER TABLE "MemoryProfileFact"
        ADD COLUMN IF NOT EXISTS "source" varchar(64) NOT NULL DEFAULT 'chat';
      ALTER TABLE "MemoryProfileFact"
        ALTER COLUMN "source" TYPE varchar(64);
      ALTER TABLE "MemoryProfileFact"
        ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false;
      ALTER TABLE "MemoryProfileFact"
        ADD COLUMN IF NOT EXISTS "learnedAt" timestamptz NOT NULL DEFAULT now();
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

      CREATE TABLE IF NOT EXISTS "OwnerAssistantSettings" (
        "userId" uuid PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
        "approvalMode" varchar(32) NOT NULL DEFAULT 'ask_every_time',
        "uiLocale" varchar(8) NOT NULL DEFAULT 'auto',
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "ToolApprovalRule" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "toolName" varchar(80) NOT NULL,
        "decision" varchar(16) NOT NULL CHECK ("decision" IN ('always_allow', 'never_allow')),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "toolName")
      );
      CREATE INDEX IF NOT EXISTS "ToolApprovalRule_user_updated"
        ON "ToolApprovalRule" ("userId", "updatedAt" DESC);

      CREATE TABLE IF NOT EXISTS "ToolExecutionJournal" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "chatId" uuid NOT NULL,
        "toolCallId" varchar(160) NOT NULL,
        "toolName" varchar(80) NOT NULL,
        "digest" varchar(64) NOT NULL,
        "bootId" varchar(64) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'in_flight',
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        UNIQUE ("chatId", "toolCallId")
      );
      CREATE INDEX IF NOT EXISTS "ToolExecutionJournal_user_status"
        ON "ToolExecutionJournal" ("userId", "status");

      CREATE TABLE IF NOT EXISTS "ChatThreadSummary" (
        "chatId" uuid PRIMARY KEY REFERENCES "Chat"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "coveredUntilMessageId" varchar(128) NOT NULL,
        "coveredMessageCount" integer NOT NULL DEFAULT 0,
        "summaryText" text NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "CloudComputerSession" (
        "userId" uuid PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
        "state" varchar(24) NOT NULL DEFAULT 'sleeping',
        "lastActiveAt" timestamptz NOT NULL DEFAULT now(),
        "sleptAt" timestamptz,
        "wakeCount" integer NOT NULL DEFAULT 0,
        "lastWakeDurationMs" integer,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "RoutineCheckInState" (
        "scheduleId" uuid PRIMARY KEY REFERENCES "CronJob"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "consecutiveSilentRuns" integer NOT NULL DEFAULT 0,
        "backoffMultiplier" integer NOT NULL DEFAULT 1,
        "lastOutcome" varchar(32),
        "lastCheckedAt" timestamptz,
        "nextEligibleAt" timestamptz
      );

      CREATE TABLE IF NOT EXISTS "RoutineTriggerCursor" (
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "source" varchar(64) NOT NULL,
        "cursorValue" varchar(255) NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userId", "source")
      );

      CREATE TABLE IF NOT EXISTS "RoutineTriggerProcessedEvent" (
        "id" uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "source" varchar(64) NOT NULL,
        "externalEventId" varchar(255) NOT NULL,
        "processedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("userId", "source", "externalEventId")
      );
      CREATE INDEX IF NOT EXISTS "RoutineTriggerProcessedEvent_user_source"
        ON "RoutineTriggerProcessedEvent" ("userId", "source", "processedAt" DESC);
    `);
    schemaEnsuredForProcess = true;
  })().finally(() => {
    inflightPromise = null;
  });

  await inflightPromise;
}
