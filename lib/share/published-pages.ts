import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";

export type SanitizedShareItem = {
  kind: "openui" | "fixture" | "weather" | "document" | "summary";
  title: string;
  subtitle: string;
  bodyText?: string;
};

export type PublishedPageMetadata = {
  id: string;
  title: string;
  itemCount: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type PublicPageSnapshot = {
  id: string;
  title: string;
  items: SanitizedShareItem[];
  createdAt: string;
  expiresAt: string;
};

export interface PublishedPageStore {
  publish: (opts: {
    userId: string;
    title: string;
    items: SanitizedShareItem[];
    ttlHours?: number;
    ownerEmailToScrub?: string | null;
  }) => Promise<{ token: string; page: PublishedPageMetadata }>;
  resolveByToken: (opts: {
    token: string;
    now?: Date;
  }) => Promise<PublicPageSnapshot | null>;
  listForOwner: (userId: string) => Promise<PublishedPageMetadata[]>;
  revoke: (opts: { userId: string; id: string }) => Promise<boolean>;
}

const DEFAULT_SHARE_TTL_HOURS = 24 * 14; // 14 days

export function hashShareToken(rawToken: string): string {
  return createHash("sha256")
    .update("assistant-share-page-v1:")
    .update(rawToken, "utf8")
    .digest("hex");
}

export function generateShareToken(): string {
  return randomBytes(24).toString("base64url"); // 32 URL-safe chars (192 bits entropy)
}

export function scrubShareText(
  input: string,
  ownerEmailToScrub?: string | null
): string {
  let text = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/javascript:/gi, "");

  const ownerEmail = (
    ownerEmailToScrub ??
    process.env.APP_OWNER_EMAIL ??
    ""
  ).trim();
  if (ownerEmail) {
    const escaped = ownerEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), "[redacted-owner]");
  }

  return text.trim().slice(0, 8000);
}

export function sanitizeSnapshotItems(
  items: readonly SanitizedShareItem[],
  ownerEmailToScrub?: string | null
): SanitizedShareItem[] {
  return items.slice(0, 25).map((item) => ({
    kind: item.kind,
    title: scrubShareText(item.title, ownerEmailToScrub).slice(0, 160),
    subtitle: scrubShareText(item.subtitle, ownerEmailToScrub).slice(0, 200),
    ...(item.bodyText
      ? { bodyText: scrubShareText(item.bodyText, ownerEmailToScrub) }
      : {}),
  }));
}

type StoredRow = {
  id: string;
  userId: string;
  tokenHash: string;
  title: string;
  items: SanitizedShareItem[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export function createInMemoryPublishedPageStore(): PublishedPageStore {
  const byId = new Map<string, StoredRow>();

  return {
    publish({
      userId,
      title,
      items,
      ttlHours = DEFAULT_SHARE_TTL_HOURS,
      ownerEmailToScrub,
    }) {
      const combinedCheck = `${title}\n${JSON.stringify(items)}`;
      if (containsRestrictedWorkData(combinedCheck)) {
        return Promise.reject(
          new Error(
            "Blocked: employer/Korn Ferry material cannot be published to a shareable link."
          )
        );
      }

      const cleanTitle =
        scrubShareText(title, ownerEmailToScrub).slice(0, 140) ||
        "Shared Snapshot";
      const cleanItems = sanitizeSnapshotItems(items, ownerEmailToScrub);
      const token = generateShareToken();
      const tokenHash = hashShareToken(token);
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + Math.max(1, ttlHours) * 3_600_000
      ).toISOString();

      const row: StoredRow = {
        id: randomUUID(),
        userId,
        tokenHash,
        title: cleanTitle,
        items: cleanItems,
        createdAt: now.toISOString(),
        expiresAt,
        revokedAt: null,
      };
      byId.set(row.id, row);

      return Promise.resolve({
        token,
        page: {
          id: row.id,
          title: row.title,
          itemCount: row.items.length,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          revokedAt: null,
        },
      });
    },

    resolveByToken({ token, now = new Date() }) {
      if (!/^[a-zA-Z0-9_-]{24,128}$/.test(token)) {
        return Promise.resolve(null);
      }
      const targetHash = hashShareToken(token);
      for (const row of byId.values()) {
        if (row.tokenHash !== targetHash) {
          continue;
        }
        if (row.revokedAt !== null) {
          return Promise.resolve(null);
        }
        if (new Date(row.expiresAt).getTime() <= now.getTime()) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: row.id,
          title: row.title,
          items: row.items.map((i) => ({ ...i })),
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        });
      }
      return Promise.resolve(null);
    },

    listForOwner(userId) {
      const list = [...byId.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({
          id: r.id,
          title: r.title,
          itemCount: r.items.length,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          revokedAt: r.revokedAt,
        }));
      return Promise.resolve(list);
    },

    revoke({ userId, id }) {
      const found = byId.get(id);
      if (!found || found.userId !== userId) {
        return Promise.resolve(false);
      }
      found.revokedAt = new Date().toISOString();
      return Promise.resolve(true);
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
const fallbackMemStore = createInMemoryPublishedPageStore();

function getSql() {
  const url = (process.env.POSTGRES_URL ?? "").trim();
  if (!url || url === "****") {
    return null;
  }
  pgClient ??= postgres(url, { max: 2, prepare: false, idle_timeout: 2 });
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

export function createPostgresPublishedPageStore(): PublishedPageStore {
  return {
    async publish(opts) {
      const sql = getSql();
      if (!sql) {
        return fallbackMemStore.publish(opts);
      }
      const combinedCheck = `${opts.title}\n${JSON.stringify(opts.items)}`;
      if (containsRestrictedWorkData(combinedCheck)) {
        throw new Error(
          "Blocked: employer/Korn Ferry material cannot be published to a shareable link."
        );
      }
      const cleanTitle =
        scrubShareText(opts.title, opts.ownerEmailToScrub).slice(0, 140) ||
        "Shared Snapshot";
      const cleanItems = sanitizeSnapshotItems(
        opts.items,
        opts.ownerEmailToScrub
      );
      const token = generateShareToken();
      const tokenHash = hashShareToken(token);
      const id = randomUUID();
      const ttlHours = opts.ttlHours ?? DEFAULT_SHARE_TTL_HOURS;
      const expiresAt = new Date(
        Date.now() + Math.max(1, ttlHours) * 3_600_000
      ).toISOString();

      try {
        await ensureParitySchema(sql);
        const [row] = await sql`
          INSERT INTO "PublishedPage" (
            "id", "userId", "tokenHash", "title", "sanitizedPayload", "expiresAt"
          ) VALUES (
            ${id}, ${opts.userId}, ${tokenHash}, ${cleanTitle},
            ${JSON.stringify(cleanItems)}::jsonb, ${expiresAt}::timestamptz
          )
          RETURNING *
        `;
        return {
          token,
          page: {
            id: String(row.id),
            title: String(row.title),
            itemCount: cleanItems.length,
            createdAt: new Date(String(row.createdAt)).toISOString(),
            expiresAt: new Date(String(row.expiresAt)).toISOString(),
            revokedAt: null,
          },
        };
      } catch (err) {
        if (isMissingTable(err)) {
          return fallbackMemStore.publish(opts);
        }
        throw err;
      }
    },

    async resolveByToken({ token, now = new Date() }) {
      if (!/^[a-zA-Z0-9_-]{24,128}$/.test(token)) {
        return null;
      }
      const sql = getSql();
      if (!sql) {
        return fallbackMemStore.resolveByToken({ token, now });
      }
      const tokenHash = hashShareToken(token);
      try {
        const [row] = await sql`
          SELECT "id", "title", "sanitizedPayload", "createdAt", "expiresAt", "revokedAt"
          FROM "PublishedPage"
          WHERE "tokenHash" = ${tokenHash}
            AND "revokedAt" IS NULL
            AND "expiresAt" > ${now.toISOString()}::timestamptz
          LIMIT 1
        `;
        if (!row) {
          return null;
        }
        return {
          id: String(row.id),
          title: String(row.title),
          items: Array.isArray(row.sanitizedPayload)
            ? (row.sanitizedPayload as SanitizedShareItem[])
            : [],
          createdAt: new Date(String(row.createdAt)).toISOString(),
          expiresAt: new Date(String(row.expiresAt)).toISOString(),
        };
      } catch (err) {
        if (isMissingTable(err)) {
          return fallbackMemStore.resolveByToken({ token, now });
        }
        return null;
      }
    },

    async listForOwner(userId) {
      const sql = getSql();
      if (!sql) {
        return fallbackMemStore.listForOwner(userId);
      }
      try {
        await ensureParitySchema(sql);
        const rows = await sql`
          SELECT "id", "title", "sanitizedPayload", "createdAt", "expiresAt", "revokedAt"
          FROM "PublishedPage"
          WHERE "userId" = ${userId}
          ORDER BY "createdAt" DESC
          LIMIT 30
        `;
        return rows.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          itemCount: Array.isArray(r.sanitizedPayload)
            ? r.sanitizedPayload.length
            : 0,
          createdAt: new Date(String(r.createdAt)).toISOString(),
          expiresAt: new Date(String(r.expiresAt)).toISOString(),
          revokedAt: r.revokedAt
            ? new Date(String(r.revokedAt)).toISOString()
            : null,
        }));
      } catch (err) {
        if (isMissingTable(err)) {
          return fallbackMemStore.listForOwner(userId);
        }
        throw err;
      }
    },

    async revoke({ userId, id }) {
      const sql = getSql();
      if (!sql) {
        return fallbackMemStore.revoke({ userId, id });
      }
      try {
        const rows = await sql`
          UPDATE "PublishedPage"
          SET "revokedAt" = now()
          WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid AND "revokedAt" IS NULL
          RETURNING "id"
        `;
        return rows.length > 0;
      } catch (err) {
        if (isMissingTable(err)) {
          return fallbackMemStore.revoke({ userId, id });
        }
        throw err;
      }
    },
  };
}
