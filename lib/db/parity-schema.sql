-- Additive Grok Bot parity schema (Memory Profile + Journal, Secret Vault, Background Tasks).
-- Follow the same rule as lib/db/usage-schema.sql: apply explicitly to an approved
-- isolated database, never automatically from preview builds (which may share Neon).

CREATE TABLE IF NOT EXISTS "MemoryProfileFact" (
  "id" uuid PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "category" varchar(48) NOT NULL DEFAULT 'general',
  "key" varchar(120) NOT NULL,
  "value" text NOT NULL,
  "sharedAcrossBots" boolean NOT NULL DEFAULT true,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "key")
);

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

