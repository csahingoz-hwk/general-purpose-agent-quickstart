import { randomUUID } from "node:crypto";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import {
  getSharedPostgresClient,
  resolveSharedPostgresUrl,
} from "@/lib/db/shared-pool";
import {
  type AtomicMemorySource,
  areMemoryFactsSemanticallyEquivalent,
  defaultPinnedForCategory,
  deriveFactKey,
  detectDisallowedProfileFactReason,
  detectSensitiveMemoryContent,
  joinMemorySources,
  normalizeMemoryCategory,
  normalizeMemoryComparisonText,
  normalizeMemorySource,
  type SensitiveMemoryReason,
} from "@/lib/memory/bulk-import";

export type CanonicalMemoryCategory =
  | "rules"
  | "preferences"
  | "about_me"
  | "family"
  | "work"
  | "projects";

export type LegacyMemoryCategory =
  | "identity"
  | "preference"
  | "finance"
  | "project"
  | "general";

export type MemoryCategory = CanonicalMemoryCategory | LegacyMemoryCategory;

export type MemorySource = AtomicMemorySource | (string & {});

export class SensitiveMemoryBlockedError extends Error {
  readonly reason: SensitiveMemoryReason;
  constructor(reason: SensitiveMemoryReason) {
    super(
      reason === "korn_ferry_data"
        ? "Blocked restricted Korn Ferry data: store only short role and region context lines in memory."
        : `Blocked sensitive memory (${reason}): passwords, card numbers, and street addresses are never stored in memory.`
    );
    this.reason = reason;
  }
}

export type ProfileFact = {
  id: string;
  userId: string;
  category: CanonicalMemoryCategory;
  key: string;
  value: string;
  source: MemorySource;
  pinned: boolean;
  learnedAt: string;
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
    source?: MemorySource;
    pinned?: boolean;
    learnedAt?: string;
    sharedAcrossBots?: boolean;
    botSlug?: string | null;
  }) => Promise<ProfileFact>;
  upsertProfileFactsBatch: (input: {
    userId: string;
    source?: MemorySource;
    items: ReadonlyArray<{
      category?: MemoryCategory;
      key?: string;
      value: string;
      source?: MemorySource;
      pinned?: boolean;
      learnedAt?: string;
      replaceFactId?: string;
      sharedAcrossBots?: boolean;
      botSlug?: string | null;
    }>;
  }) => Promise<{
    saved: ProfileFact[];
    skippedDuplicates: number;
    skippedSensitive: number;
  }>;
  updateProfileFact: (input: {
    userId: string;
    id: string;
    category?: MemoryCategory;
    value?: string;
    source?: MemorySource;
    pinned?: boolean;
    learnedAt?: string;
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

function normalizeSource(raw?: string | null): MemorySource {
  return normalizeMemorySource(raw, "chat");
}

function validIsoOrNull(raw?: string | null): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

export function createInMemoryMemoryStore(): MemoryStore {
  const facts = new Map<string, ProfileFact>();
  const journal: JournalEntry[] = [];
  let sequence = 0;

  return {
    upsertProfileFact({
      userId,
      category = "about_me",
      key,
      value,
      source = "chat",
      pinned,
      learnedAt,
      sharedAcrossBots = true,
      botSlug = null,
    }) {
      const trimmed = value.trim();
      const disallowed = detectDisallowedProfileFactReason(trimmed);
      if (disallowed) {
        return Promise.reject(new SensitiveMemoryBlockedError(disallowed));
      }
      const canonicalCategory = normalizeMemoryCategory(category);
      const normalizedKey = normalizeFactKey(key);
      const scopeSuffix = sharedAcrossBots ? "shared" : (botSlug ?? "private");
      let semanticExisting: ProfileFact | undefined = facts.get(
        `${userId}:${scopeSuffix}:${normalizedKey}`
      );
      if (!semanticExisting) {
        for (const candidate of facts.values()) {
          const candScope = candidate.sharedAcrossBots
            ? "shared"
            : (candidate.botSlug ?? "private");
          if (
            candidate.userId === userId &&
            candScope === scopeSuffix &&
            areMemoryFactsSemanticallyEquivalent(candidate.value, trimmed)
          ) {
            semanticExisting = candidate;
            break;
          }
        }
      }
      const effectiveKey = semanticExisting?.key ?? normalizedKey;
      const mapKey = `${userId}:${scopeSuffix}:${effectiveKey}`;
      const existing = semanticExisting ?? facts.get(mapKey);
      const now = new Date(Date.now() + sequence++).toISOString();
      const validLearned = validIsoOrNull(learnedAt);
      const effectiveSource = existing
        ? joinMemorySources([existing.source, source], normalizeSource(source))
        : normalizeSource(source);
      const saved: ProfileFact = {
        id: existing?.id ?? randomUUID(),
        userId,
        category: canonicalCategory,
        key: effectiveKey,
        value: trimmed,
        source: effectiveSource,
        pinned:
          pinned ??
          existing?.pinned ??
          defaultPinnedForCategory(canonicalCategory),
        learnedAt: validLearned ?? existing?.learnedAt ?? now,
        sharedAcrossBots,
        botSlug,
        updatedAt: now,
      };
      facts.set(mapKey, saved);
      return Promise.resolve({ ...saved });
    },
    async upsertProfileFactsBatch({ userId, source = "pasted", items }) {
      const existing = await this.listProfileFacts({ userId });
      const replacingIds = new Set(
        items
          .map((i) => i.replaceFactId?.trim())
          .filter((id): id is string => Boolean(id))
      );
      const seenValues = existing
        .filter((f) => !replacingIds.has(f.id))
        .map((f) => f.value)
        .filter(Boolean);
      const seenNorm = new Set(
        seenValues.map((v) => normalizeMemoryComparisonText(v)).filter(Boolean)
      );
      const saved: ProfileFact[] = [];
      let skippedDuplicates = 0;
      let skippedSensitive = 0;
      for (const item of items) {
        const trimmed = item.value.trim();
        if (!trimmed) {
          continue;
        }
        if (detectDisallowedProfileFactReason(trimmed)) {
          skippedSensitive += 1;
          continue;
        }
        const norm = normalizeMemoryComparisonText(trimmed);
        if (!norm) {
          continue;
        }
        if (
          seenNorm.has(norm) ||
          seenValues.some((prev) =>
            areMemoryFactsSemanticallyEquivalent(prev, trimmed)
          )
        ) {
          skippedDuplicates += 1;
          continue;
        }
        seenNorm.add(norm);
        seenValues.push(trimmed);
        const canonicalCategory = normalizeMemoryCategory(item.category);
        if (item.replaceFactId) {
          const updatedExisting = await this.updateProfileFact({
            userId,
            id: item.replaceFactId,
            category: canonicalCategory,
            value: trimmed,
            source: item.source ?? source,
            pinned: item.pinned ?? defaultPinnedForCategory(canonicalCategory),
            learnedAt: item.learnedAt,
            sharedAcrossBots: item.sharedAcrossBots ?? true,
          });
          if (updatedExisting) {
            saved.push(updatedExisting);
            continue;
          }
        }
        const created = await this.upsertProfileFact({
          userId,
          category: canonicalCategory,
          key: item.key?.trim() || deriveFactKey(trimmed),
          value: trimmed,
          source: item.source ?? source,
          pinned: item.pinned ?? defaultPinnedForCategory(canonicalCategory),
          learnedAt: item.learnedAt,
          sharedAcrossBots: item.sharedAcrossBots ?? true,
          botSlug: item.botSlug ?? null,
        });
        saved.push(created);
      }
      return { saved, skippedDuplicates, skippedSensitive };
    },
    updateProfileFact({
      userId,
      id,
      category,
      value,
      source,
      pinned,
      learnedAt,
      sharedAcrossBots,
    }) {
      for (const [mapKey, item] of facts.entries()) {
        if (item.userId === userId && item.id === id) {
          const nextValue =
            value !== undefined ? value.trim() : item.value.trim();
          const disallowed = detectDisallowedProfileFactReason(nextValue);
          if (disallowed) {
            return Promise.reject(new SensitiveMemoryBlockedError(disallowed));
          }
          const nextCategory = category
            ? normalizeMemoryCategory(category)
            : item.category;
          const nextPinned = pinned ?? item.pinned;
          const nextShared = sharedAcrossBots ?? item.sharedAcrossBots;
          const nextSource = source ? normalizeSource(source) : item.source;
          const nextLearnedAt = validIsoOrNull(learnedAt) ?? item.learnedAt;
          const candidateKey =
            value !== undefined ? deriveFactKey(nextValue) : item.key;
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
            value: nextValue,
            source: nextSource,
            pinned: nextPinned,
            learnedAt: nextLearnedAt,
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
      const sensitive = detectSensitiveMemoryContent(`${title}\n${body}`);
      if (sensitive) {
        return Promise.reject(new SensitiveMemoryBlockedError(sensitive));
      }
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
      const sensitive = detectSensitiveMemoryContent(`${title}\n${body}`);
      if (sensitive) {
        return Promise.reject(new SensitiveMemoryBlockedError(sensitive));
      }
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

function getSql() {
  const url = resolveSharedPostgresUrl();
  if (!url) {
    throw new MemoryStoreUnavailableError("POSTGRES_URL is not configured");
  }
  return getSharedPostgresClient(url);
}

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function mapProfileRow(row: Record<string, unknown>): ProfileFact {
  const rawUpdated = row.updatedAt ?? row.updatedat ?? new Date();
  const updatedAtIso = new Date(
    rawUpdated as string | number | Date
  ).toISOString();
  const rawLearned = row.learnedAt ?? row.learnedat;
  const learnedAtIso = rawLearned
    ? new Date(rawLearned as string | number | Date).toISOString()
    : updatedAtIso;
  const rawShared = row.sharedAcrossBots ?? row.sharedacrossbots;
  const rawBotSlug = row.botSlug ?? row.botslug;
  return {
    id: String(row.id),
    userId: String(row.userId ?? row.userid),
    category: normalizeMemoryCategory(String(row.category ?? "about_me")),
    key: String(row.key),
    value: String(row.value),
    source: normalizeSource(row.source ? String(row.source) : "chat"),
    pinned: Boolean(row.pinned),
    learnedAt: learnedAtIso,
    sharedAcrossBots: rawShared === undefined ? true : Boolean(rawShared),
    botSlug: rawBotSlug ? String(rawBotSlug) : null,
    updatedAt: updatedAtIso,
  };
}

export function createPostgresMemoryStore(
  sqlOverride?: ReturnType<typeof getSharedPostgresClient>
): MemoryStore {
  async function readySql() {
    const sql = sqlOverride ?? getSql();
    await ensureParitySchema(sql);
    return sql;
  }
  return {
    async upsertProfileFact({
      userId,
      category = "about_me",
      key,
      value,
      source = "chat",
      pinned,
      learnedAt,
      sharedAcrossBots = true,
      botSlug = null,
    }) {
      const trimmed = value.trim();
      const disallowed = detectDisallowedProfileFactReason(trimmed);
      if (disallowed) {
        throw new SensitiveMemoryBlockedError(disallowed);
      }
      const canonicalCategory = normalizeMemoryCategory(category);
      const effectivePinned =
        pinned ?? defaultPinnedForCategory(canonicalCategory);
      const normalizedKey = normalizeFactKey(key);
      const validLearned = validIsoOrNull(learnedAt);
      const id = randomUUID();
      try {
        const sql = await readySql();
        const existingRows = await sql`
          SELECT *
          FROM "MemoryProfileFact"
          WHERE "userId" = ${userId}
          ORDER BY "updatedAt" DESC
          LIMIT 120
        `.catch(() => [] as Record<string, unknown>[]);
        const mappedExisting = existingRows.map((r) =>
          mapProfileRow(r as Record<string, unknown>)
        );
        const semanticMatch =
          mappedExisting.find((f) => f.key === normalizedKey) ??
          mappedExisting.find((f) => {
            const sameScope = sharedAcrossBots
              ? f.sharedAcrossBots
              : !f.sharedAcrossBots && f.botSlug === botSlug;
            return (
              sameScope &&
              areMemoryFactsSemanticallyEquivalent(f.value, trimmed)
            );
          });
        const effectiveKey = semanticMatch?.key ?? normalizedKey;
        const effectiveSource = semanticMatch
          ? joinMemorySources(
              [semanticMatch.source, source],
              normalizeSource(source)
            )
          : normalizeSource(source);

        const [row] = await sql`
          INSERT INTO "MemoryProfileFact" (
            "id", "userId", "category", "key", "value", "source", "pinned", "learnedAt", "sharedAcrossBots", "botSlug"
          )
          VALUES (
            ${id}, ${userId}, ${canonicalCategory}, ${effectiveKey}, ${trimmed},
            ${effectiveSource}, ${effectivePinned}, COALESCE(${validLearned}::timestamptz, now()), ${sharedAcrossBots}, ${botSlug}
          )
          ON CONFLICT ("userId", "key")
          DO UPDATE SET
            "category" = EXCLUDED."category",
            "value" = EXCLUDED."value",
            "source" = EXCLUDED."source",
            "pinned" = EXCLUDED."pinned",
            "learnedAt" = COALESCE(${validLearned}::timestamptz, "MemoryProfileFact"."learnedAt"),
            "sharedAcrossBots" = EXCLUDED."sharedAcrossBots",
            "botSlug" = EXCLUDED."botSlug",
            "updatedAt" = now()
          RETURNING "id", "userId", "category", "key", "value", "source", "pinned", "learnedAt", "sharedAcrossBots", "botSlug", "updatedAt"
        `;
        return mapProfileRow(row as Record<string, unknown>);
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async upsertProfileFactsBatch({ userId, source = "pasted", items }) {
      try {
        const existing = await this.listProfileFacts({ userId });
        const replacingIds = new Set(
          items
            .map((i) => i.replaceFactId?.trim())
            .filter((id): id is string => Boolean(id))
        );
        const seenValues = existing
          .filter((f) => !replacingIds.has(f.id))
          .map((f) => f.value)
          .filter(Boolean);
        const seenNorm = new Set(
          seenValues
            .map((v) => normalizeMemoryComparisonText(v))
            .filter(Boolean)
        );
        const saved: ProfileFact[] = [];
        let skippedDuplicates = 0;
        let skippedSensitive = 0;
        for (const item of items) {
          const trimmed = item.value.trim();
          if (!trimmed) {
            continue;
          }
          if (detectDisallowedProfileFactReason(trimmed)) {
            skippedSensitive += 1;
            continue;
          }
          const norm = normalizeMemoryComparisonText(trimmed);
          if (!norm) {
            continue;
          }
          if (
            seenNorm.has(norm) ||
            seenValues.some((prev) =>
              areMemoryFactsSemanticallyEquivalent(prev, trimmed)
            )
          ) {
            skippedDuplicates += 1;
            continue;
          }
          seenNorm.add(norm);
          seenValues.push(trimmed);
          const canonicalCategory = normalizeMemoryCategory(item.category);
          if (item.replaceFactId) {
            const updatedExisting = await this.updateProfileFact({
              userId,
              id: item.replaceFactId,
              category: canonicalCategory,
              value: trimmed,
              source: item.source ?? source,
              pinned:
                item.pinned ?? defaultPinnedForCategory(canonicalCategory),
              learnedAt: item.learnedAt,
              sharedAcrossBots: item.sharedAcrossBots ?? true,
            });
            if (updatedExisting) {
              saved.push(updatedExisting);
              continue;
            }
          }
          const created = await this.upsertProfileFact({
            userId,
            category: canonicalCategory,
            key: item.key?.trim() || deriveFactKey(trimmed),
            value: trimmed,
            source: item.source ?? source,
            pinned: item.pinned ?? defaultPinnedForCategory(canonicalCategory),
            learnedAt: item.learnedAt,
            sharedAcrossBots: item.sharedAcrossBots ?? true,
            botSlug: item.botSlug ?? null,
          });
          saved.push(created);
        }
        return { saved, skippedDuplicates, skippedSensitive };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new MemoryStoreUnavailableError("Memory tables missing");
        }
        throw error;
      }
    },
    async updateProfileFact({
      userId,
      id,
      category,
      value,
      source,
      pinned,
      learnedAt,
      sharedAcrossBots,
    }) {
      if (value !== undefined) {
        const disallowed = detectDisallowedProfileFactReason(value.trim());
        if (disallowed) {
          throw new SensitiveMemoryBlockedError(disallowed);
        }
      }
      const nextCategory = category ? normalizeMemoryCategory(category) : null;
      const trimmedValue = value !== undefined ? value.trim() : null;
      const nextSource = source ? normalizeSource(source) : null;
      const nextLearnedAt = validIsoOrNull(learnedAt);
      const nextKey =
        trimmedValue !== null ? deriveFactKey(trimmedValue) : null;
      try {
        const sql = await readySql();
        const rows = await sql`
          UPDATE "MemoryProfileFact" AS m
          SET
            "category" = COALESCE(${nextCategory}, m."category"),
            "value" = COALESCE(${trimmedValue}, m."value"),
            "source" = COALESCE(${nextSource}, m."source"),
            "pinned" = COALESCE(${pinned ?? null}, m."pinned"),
            "learnedAt" = COALESCE(${nextLearnedAt}::timestamptz, m."learnedAt"),
            "sharedAcrossBots" = COALESCE(${sharedAcrossBots ?? null}, m."sharedAcrossBots"),
            "key" = CASE
              WHEN ${nextKey}::varchar IS NULL THEN m."key"
              WHEN EXISTS (
                SELECT 1 FROM "MemoryProfileFact" AS m2
                WHERE m2."userId" = ${userId} AND m2."key" = ${nextKey} AND m2."id" <> ${id}
              ) THEN m."key"
              ELSE ${nextKey}
            END,
            "updatedAt" = now()
          WHERE m."userId" = ${userId} AND m."id" = ${id}
          RETURNING "id", "userId", "category", "key", "value", "source", "pinned", "learnedAt", "sharedAcrossBots", "botSlug", "updatedAt"
        `;
        const row = rows[0];
        if (!row) {
          return null;
        }
        return mapProfileRow(row as Record<string, unknown>);
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
              SELECT *
              FROM "MemoryProfileFact"
              WHERE "userId" = ${userId} AND "sharedAcrossBots" = true
              ORDER BY "updatedAt" DESC
            `
          : await sql`
              SELECT *
              FROM "MemoryProfileFact"
              WHERE "userId" = ${userId}
              ORDER BY "updatedAt" DESC
            `;
        return rows.map((row) => mapProfileRow(row as Record<string, unknown>));
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
      const sensitive = detectSensitiveMemoryContent(`${title}\n${body}`);
      if (sensitive) {
        throw new SensitiveMemoryBlockedError(sensitive);
      }
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
      const sensitive = detectSensitiveMemoryContent(`${title}\n${body}`);
      if (sensitive) {
        throw new SensitiveMemoryBlockedError(sensitive);
      }
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
