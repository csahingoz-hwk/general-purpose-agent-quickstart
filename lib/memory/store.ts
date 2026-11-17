import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import {
  deriveFactKey,
  normalizeMemoryComparisonText,
} from "@/lib/memory/bulk-import";

export type MemoryCategory =
  | "identity"
  | "preference"
  | "work"
  | "finance"
  | "project"
  | "general";

export type ProfileFact = {
  id: string;
  userId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  sharedAcrossBots: boolean;
  botSlug?: string | null;
  updatedAt: string;
};

export type JournalEntry = {
  id: string;
  userId: string;
  title: string;
  body: string;
  tags: string[];
  source: "chat" | "routine" | "manual";
  createdAt: string;
};

export interface MemoryStore {
  upsertProfileFact: (input: {
    userId: string;
    category?: MemoryCategory;
    key: string;
    value: string;
    sharedAcrossBots?: boolean;
    botSlug?: string | null;
  }) => Promise<ProfileFact>;
  upsertProfileFactsBatch: (input: {
    userId: string;
    items: ReadonlyArray<{
      category?: MemoryCategory;
      key?: string;
      value: string;
      sharedAcrossBots?: boolean;
      botSlug?: string | null;
    }>;
  }) => Promise<{
    saved: ProfileFact[];
    skippedDuplicates: number;
  }>;
  updateProfileFact: (input: {
    userId: string;
    id: string;
    category?: MemoryCategory;
    value: string;
    sharedAcrossBots?: boolean;
  }) => Promise<ProfileFact | null>;
  listProfileFacts: (opts: {
    userId: string;
    sharedOnly?: boolean;
  }) => Promise<ProfileFact[]>;
  deleteProfileFact: (opts: { userId: string; id: string }) => Promise<boolean>;
  addJournalEntry: (input: {
    userId: string;
    title: string;
    body: string;
    tags?: string[];
    source?: "chat" | "routine" | "manual";
  }) => Promise<JournalEntry>;
  updateJournalEntry: (input: {
    userId: string;
    id: string;
    title: string;
    body: string;
    tags?: string[];
  }) => Promise<JournalEntry | null>;
  listJournalEntries: (opts: {
    userId: string;
    query?: string;
    tag?: string;
    limit?: number;
  }) => Promise<JournalEntry[]>;
  deleteJournalEntry: (opts: {
    userId: string;
    id: string;
  }) => Promise<boolean>;
}

export class MemoryStoreUnavailableError extends Error {}

export function isMemoryToolsEnabled(): boolean {
  return process.env.MEMORY_TOOLS_ENABLED !== "false";
}

function normalizeFactKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

export function createInMemoryMemoryStore(): MemoryStore {
  const facts = new Map<string, ProfileFact>();
  const journal: JournalEntry[] = [];
  let sequence = 0;

  return {
    upsertProfileFact({
      userId,
      category = "general",
      key,
      value,
      sharedAcrossBots = true,
      botSlug = null,
    }) {
      const normalizedKey = normalizeFactKey(key);
      const scopeSuffix = sharedAcrossBots ? "shared" : (botSlug ?? "private");
      const mapKey = `${userId}:${scopeSuffix}:${normalizedKey}`;
      const existing = facts.get(mapKey);
      const now = new Date(Date.now() + sequence++).toISOString();
      const saved: ProfileFact = {
        id: existing?.id ?? randomUUID(),
        userId,
        category,
        key: normalizedKey,
        value: value.trim(),
        sharedAcrossBots,
        botSlug,
        updatedAt: now,
      };
      facts.set(mapKey, saved);
      return Promise.resolve({ ...saved });
    },
    async upsertProfileFactsBatch({ userId, items }) {
      const existing = await this.listProfileFacts({ userId });
      const seenNorm = new Set(
        existing
          .map((f) => normalizeMemoryComparisonText(f.value))
          .filter(Boolean)
      );
      const saved: ProfileFact[] = [];
      let skippedDuplicates = 0;
      for (const item of items) {
        const trimmed = item.value.trim();
        const norm = normalizeMemoryComparisonText(trimmed);
        if (!trimmed || !norm) {
          continue;
        }
        if (seenNorm.has(norm)) {
          skippedDuplicates += 1;
          continue;
        }
        seenNorm.add(norm);
        const created = await this.upsertProfileFact({
          userId,
          category: item.category ?? "general",
          key: item.key?.trim() || deriveFactKey(trimmed),
          value: trimmed,
          sharedAcrossBots: item.sharedAcrossBots ?? true,
          botSlug: item.botSlug ?? null,
        });
        saved.push(created);
      }
      return { saved, skippedDuplicates };
    },
    updateProfileFact({ userId, id, category, value, sharedAcrossBots }) {
      for (const [mapKey, item] of facts.entries()) {
        if (item.userId === userId && item.id === id) {
          const trimmed = value.trim();
          const nextCategory = category ?? item.category;
          const nextShared = sharedAcrossBots ?? item.sharedAcrossBots;
          const candidateKey = deriveFactKey(trimmed);
          const nextScope = nextShared ? "shared" : (item.botSlug ?? "private");
          const candidateMapKey = `${userId}:${nextScope}:${candidateKey}`;
          const collision = facts.get(candidateMapKey);
          const finalKey =
            collision && collision.id !== id ? item.key : candidateKey;
          const finalMapKey = `${userId}:${nextScope}:${finalKey}`;
          const updated: ProfileFact = {
            ...item,
            category: nextCategory,
            key: finalKey,
            value: trimmed,
            sharedAcrossBots: nextShared,
            updatedAt: new Date(Date.now() + sequence++).toISOString(),
          };
          if (finalMapKey !== mapKey) {
            facts.delete(mapKey);
          }
          facts.set(finalMapKey, updated);
          return Promise.resolve({ ...updated });
        }
      }
      return Promise.resolve(null);
    },
    listProfileFacts({ userId, sharedOnly = false }) {
      const items = [...facts.values()]
        .filter(
          (item) =>
            item.userId === userId && (!sharedOnly || item.sharedAcrossBots)
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((item) => ({ ...item }));
      return Promise.resolve(items);
    },
    deleteProfileFact({ userId, id }) {
      for (const [key, item] of facts.entries()) {
        if (item.userId === userId && item.id === id) {
          facts.delete(key);
          return Promise.resolve(true);
        }
      }
      return Promise.resolve(false);
    },
    addJournalEntry({ userId, title, body, tags = [], source = "chat" }) {
      const cleanTags = [
        ...new Set(
          tags
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0)
            .slice(0, 8)
        ),
      ];
      const entry: JournalEntry = {
        id: randomUUID(),
        userId,
        title: title.trim(),
        body: body.trim(),
        tags: cleanTags,
        source,
        createdAt: new Date(Date.now() + sequence++).toISOString(),
      };
      journal.push(entry);
      return Promise.resolve({ ...entry, tags: [...entry.tags] });
    },
    updateJournalEntry({ userId, id, title, body, tags }) {
      const idx = journal.findIndex(
        (entry) => entry.userId === userId && entry.id === id
      );
      if (idx === -1) {
        return Promise.resolve(null);
      }
      const existing = journal[idx] as JournalEntry;
      const cleanTags = tags
        ? [
            ...new Set(
              tags
                .map((t) => t.trim().toLowerCase())
                .filter((t) => t.length > 0)
                .slice(0, 8)
            ),
          ]
        : existing.tags;
      const updated: JournalEntry = {
        ...existing,
        title: title.trim(),
        body: body.trim(),
        tags: cleanTags,
      };
      journal[idx] = updated;
      return Promise.resolve({ ...updated, tags: [...updated.tags] });
    },
    listJournalEntries({ userId, query, tag, limit = 25 }) {
      const q = query?.trim().toLowerCase();
      const t = tag?.trim().toLowerCase();
      const filtered = journal
        .filter((entry) => {
          if (entry.userId !== userId) {
            return false;
          }
          if (t && !entry.tags.includes(t)) {
            return false;
          }
          if (
            q &&
            !entry.title.toLowerCase().includes(q) &&
            !entry.body.toLowerCase().includes(q) &&
            !entry.tags.some((item) => item.includes(q))
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(1, limit))
        .map((entry) => ({ ...entry, tags: [...entry.tags] }));
      return Promise.resolve(filtered);
    },
    deleteJournalEntry({ userId, id }) {
      const index = journal.findIndex(
        (entry) => entry.userId === userId && entry.id === id
      );
      if (index === -1) {
        return Promise.resolve(false);
      }
      journal.splice(index, 1);
      return Promise.resolve(true);
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new MemoryStoreUnavailableError("POSTGRES_URL is not configured");
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 2,
  });
  return pgClient;
}

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

export function createPostgresMemoryStore(): MemoryStore {
  return {
    async upsertProfileFact({
      userId,
      category = "general",
      key,
      value,
      sharedAcrossBots = true,
      botSlug = null,
    }) {
      const normalizedKey = normalizeFactKey(key);
      const id = randomUUID();
      try {
        const sql = await readySql();
        const [row] = await sql`
          INSERT INTO "MemoryProfileFact" ("id", "userId", "category", "key", "value", "sharedAcrossBots", "botSlug")
          VALUES (${id}, ${userId}, ${category}, ${normalizedKey}, ${value.trim()}, ${sharedAcrossBots}, ${botSlug})
          ON CONFLICT ("userId", "key")
          DO UPDATE SET
            "category" = EXCLUDED."category",
            "value" = EXCLUDED."value",
            "sharedAcrossBots" = EXCLUDED."sharedAcrossBots",
            "botSlug" = EXCLUDED."botSlug",
            "updatedAt" = now()
          RETURNING "id", "userId", "category", "key", "value", "sharedAcrossBots", "botSlug", "updatedAt"
        `;
        return {
          id: String(row.id),
          userId: String(row.userId),
          category: row.category as MemoryCategory,
          key: String(row.key),
          value: String(row.value),
          sharedAcrossBots: Boolean(row.sharedAcrossBots),
          botSlug: row.botSlug ? String(row.botSlug) : null,
          updatedAt: new Date(row.updatedAt).toISOString(),
        };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async upsertProfileFactsBatch({ userId, items }) {
      try {
        const existing = await this.listProfileFacts({ userId });
        const seenNorm = new Set(
          existing
            .map((f) => normalizeMemoryComparisonText(f.value))
            .filter(Boolean)
        );
        const saved: ProfileFact[] = [];
        let skippedDuplicates = 0;
        for (const item of items) {
          const trimmed = item.value.trim();
          const norm = normalizeMemoryComparisonText(trimmed);
          if (!trimmed || !norm) {
            continue;
          }
          if (seenNorm.has(norm)) {
            skippedDuplicates += 1;
            continue;
          }
          seenNorm.add(norm);
          const created = await this.upsertProfileFact({
            userId,
            category: item.category ?? "general",
            key: item.key?.trim() || deriveFactKey(trimmed),
            value: trimmed,
            sharedAcrossBots: item.sharedAcrossBots ?? true,
            botSlug: item.botSlug ?? null,
          });
          saved.push(created);
        }
        return { saved, skippedDuplicates };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async updateProfileFact({ userId, id, category, value, sharedAcrossBots }) {
      const trimmed = value.trim();
      const nextKey = deriveFactKey(trimmed);
      try {
        const sql = await readySql();
        const rows = await sql`
          UPDATE "MemoryProfileFact" AS m
          SET
            "category" = COALESCE(${category ?? null}, m."category"),
            "value" = ${trimmed},
            "sharedAcrossBots" = COALESCE(${sharedAcrossBots ?? null}, m."sharedAcrossBots"),
            "key" = CASE
              WHEN EXISTS (
                SELECT 1 FROM "MemoryProfileFact" AS m2
                WHERE m2."userId" = ${userId} AND m2."key" = ${nextKey} AND m2."id" <> ${id}
              ) THEN m."key"
              ELSE ${nextKey}
            END,
            "updatedAt" = now()
          WHERE m."userId" = ${userId} AND m."id" = ${id}
          RETURNING "id", "userId", "category", "key", "value", "sharedAcrossBots", "botSlug", "updatedAt"
        `;
        const row = rows[0];
        if (!row) {
          return null;
        }
        return {
          id: String(row.id),
          userId: String(row.userId),
          category: row.category as MemoryCategory,
          key: String(row.key),
          value: String(row.value),
          sharedAcrossBots: Boolean(row.sharedAcrossBots),
          botSlug: row.botSlug ? String(row.botSlug) : null,
          updatedAt: new Date(row.updatedAt).toISOString(),
        };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async listProfileFacts({ userId, sharedOnly = false }) {
      try {
        const sql = await readySql();
        const rows = sharedOnly
          ? await sql`
              SELECT "id", "userId", "category", "key", "value", "sharedAcrossBots", "botSlug", "updatedAt"
              FROM "MemoryProfileFact"
              WHERE "userId" = ${userId} AND "sharedAcrossBots" = true
              ORDER BY "updatedAt" DESC
            `
          : await sql`
              SELECT "id", "userId", "category", "key", "value", "sharedAcrossBots", "botSlug", "updatedAt"
              FROM "MemoryProfileFact"
              WHERE "userId" = ${userId}
              ORDER BY "updatedAt" DESC
            `;
        return rows.map((row) => ({
          id: String(row.id),
          userId: String(row.userId),
          category: row.category as MemoryCategory,
          key: String(row.key),
          value: String(row.value),
          sharedAcrossBots: Boolean(row.sharedAcrossBots),
          botSlug: row.botSlug ? String(row.botSlug) : null,
          updatedAt: new Date(row.updatedAt).toISOString(),
        }));
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async deleteProfileFact({ userId, id }) {
      try {
        const sql = await readySql();
        const deleted = await sql`
          DELETE FROM "MemoryProfileFact"
          WHERE "userId" = ${userId} AND "id" = ${id}
          RETURNING "id"
        `;
        return deleted.length > 0;
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async addJournalEntry({ userId, title, body, tags = [], source = "chat" }) {
      const cleanTags = [
        ...new Set(
          tags
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0)
            .slice(0, 8)
        ),
      ];
      const id = randomUUID();
      try {
        const sql = await readySql();
        const [row] = await sql`
          INSERT INTO "MemoryJournalEntry" ("id", "userId", "title", "body", "tags", "source")
          VALUES (${id}, ${userId}, ${title.trim()}, ${body.trim()}, ${JSON.stringify(cleanTags)}::jsonb, ${source})
          RETURNING "id", "userId", "title", "body", "tags", "source", "createdAt"
        `;
        return {
          id: String(row.id),
          userId: String(row.userId),
          title: String(row.title),
          body: String(row.body),
          tags: Array.isArray(row.tags) ? row.tags.map(String) : cleanTags,
          source: row.source as "chat" | "routine" | "manual",
          createdAt: new Date(row.createdAt).toISOString(),
        };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async updateJournalEntry({ userId, id, title, body, tags }) {
      const cleanTags = tags
        ? [
            ...new Set(
              tags
                .map((t) => t.trim().toLowerCase())
                .filter((t) => t.length > 0)
                .slice(0, 8)
            ),
          ]
        : null;
      try {
        const sql = await readySql();
        const rows =
          cleanTags !== null
            ? await sql`
                UPDATE "MemoryJournalEntry"
                SET
                  "title" = ${title.trim()},
                  "body" = ${body.trim()},
                  "tags" = ${JSON.stringify(cleanTags)}::jsonb
                WHERE "userId" = ${userId} AND "id" = ${id}
                RETURNING "id", "userId", "title", "body", "tags", "source", "createdAt"
              `
            : await sql`
                UPDATE "MemoryJournalEntry"
                SET
                  "title" = ${title.trim()},
                  "body" = ${body.trim()}
                WHERE "userId" = ${userId} AND "id" = ${id}
                RETURNING "id", "userId", "title", "body", "tags", "source", "createdAt"
              `;
        const row = rows[0];
        if (!row) {
          return null;
        }
        return {
          id: String(row.id),
          userId: String(row.userId),
          title: String(row.title),
          body: String(row.body),
          tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
          source: row.source as "chat" | "routine" | "manual",
          createdAt: new Date(row.createdAt).toISOString(),
        };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async listJournalEntries({ userId, query, tag, limit = 25 }) {
      try {
        const sql = await readySql();
        const rows = await sql`
          SELECT "id", "userId", "title", "body", "tags", "source", "createdAt"
          FROM "MemoryJournalEntry"
          WHERE "userId" = ${userId}
          ORDER BY "createdAt" DESC
          LIMIT ${Math.min(100, Math.max(1, limit * 2))}
        `;
        const q = query?.trim().toLowerCase();
        const t = tag?.trim().toLowerCase();
        return rows
          .map((row) => ({
            id: String(row.id),
            userId: String(row.userId),
            title: String(row.title),
            body: String(row.body),
            tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
            source: row.source as "chat" | "routine" | "manual",
            createdAt: new Date(row.createdAt).toISOString(),
          }))
          .filter((entry) => {
            if (t && !entry.tags.includes(t)) {
              return false;
            }
            if (
              q &&
              !entry.title.toLowerCase().includes(q) &&
              !entry.body.toLowerCase().includes(q) &&
              !entry.tags.some((item) => item.includes(q))
            ) {
              return false;
            }
            return true;
          })
          .slice(0, Math.max(1, limit));
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async deleteJournalEntry({ userId, id }) {
      try {
        const sql = await readySql();
        const deleted = await sql`
          DELETE FROM "MemoryJournalEntry"
          WHERE "userId" = ${userId} AND "id" = ${id}
          RETURNING "id"
        `;
        return deleted.length > 0;
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
  };
}
