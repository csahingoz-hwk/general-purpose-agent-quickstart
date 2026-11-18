import { randomUUID } from "node:crypto";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import { getSharedPostgresClient } from "@/lib/db/shared-pool";

export type SkillItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  builtIn: boolean;
  updatedAt: string;
};

export const BUILT_IN_SKILLS: readonly SkillItem[] = [
  {
    id: "builtin-month-end-close",
    slug: "month-end-close",
    name: "Month-End Close & SOX Reviewer",
    description:
      "Structured GAAP/IFRS close review: cutoff, completeness of accruals, FX reval, and SOX evidence checklist.",
    instructions:
      "Apply a Finance Controller lens: verify period cutoff, check completeness and valuation of accruals, highlight missing SOX sign-off/tie-out evidence, and present findings in a crisp Materiality / Risk / Action table.",
    builtIn: true,
    updatedAt: "2026-11-16T00:00:00.000Z",
  },
  {
    id: "builtin-ksa-eosb",
    slug: "ksa-eosb-audit",
    name: "KSA EOSB Accrual Checker",
    description:
      "Saudi Labor Law Art. 84/85 End-of-Service Benefit calculation, tenure tiers, and GL rollforward check.",
    instructions:
      "Check KSA End-of-Service Benefit logic carefully: distinguish resignation vs employer termination tiers (first 5 years 0.5 month/yr vs >5 years 1.0 month/yr, Art. 85 vesting fractions 0 / 1/3 / 2/3 / full), flag transfer continuity, and show clear formula steps.",
    builtIn: true,
    updatedAt: "2026-11-16T00:00:00.000Z",
  },
  {
    id: "builtin-variance-commentary",
    slug: "variance-commentary",
    name: "Executive Variance Commentary",
    description:
      "CFO-ready Actual vs Budget / Prior Year commentary separating volume, rate, mix, and FX.",
    instructions:
      "Write concise CFO-ready variance commentary: lead with headline net impact, separate operational drivers (volume, price/mix, headcount timing) from FX translation, avoid filler prose, and end with 2–3 forward risks/opportunities.",
    builtIn: true,
    updatedAt: "2026-11-16T00:00:00.000Z",
  },
  {
    id: "builtin-vibecode-audit",
    slug: "vibecode-audit",
    name: "Vibecode Security & Diff Audit",
    description:
      "Surgical code review checking auth boundaries, spend leaks, untrusted input handling, and mobile UX.",
    instructions:
      "Audit the code or plan surgically: check fail-closed authentication, cost/token ceilings, prompt-injection or XSS vectors, 44px mobile touch targets, and unnecessary complexity. Report concrete file/line fixes.",
    builtIn: true,
    updatedAt: "2026-11-16T00:00:00.000Z",
  },
  {
    id: "builtin-firecrawl",
    slug: "firecrawl",
    name: "Firecrawl Web Research & Scraping",
    description:
      "Playbook for server-side web search vs URL-to-Markdown scrape vs site map/crawl, always citing sources with publication dates.",
    instructions: [
      "1. When to Search (`firecrawlSearch` / `webSearch`): Use search first for open-ended questions, breaking news, prices, or multi-source comparisons when you do not have an exact target URL yet.",
      "2. When to Scrape (`firecrawlScrape`): Use scrape when the user gives a specific URL or after search/map identifies 1–3 authoritative pages whose full clean Markdown body, tables, or release notes you need to read.",
      "3. When to Map or Crawl (`firecrawlCrawlMap`): Start with `mode: 'map'` to quickly list subpages of a documentation or news domain, then `firecrawlScrape` the best 1–3 URLs; use `mode: 'crawl'` (bounded <=8 pages) only when synthesizing a multi-page docs section.",
      "4. Mandatory Source & Date Citations: Every factual claim or news item MUST cite its clickable `[Source Title](https://...)` URL AND its publication/retrieval date (`YYYY-MM-DD`). Never invent headlines, dates, or URLs. If `FIRECRAWL_API_KEY` is not connected, state plainly that Firecrawl is not connected yet and point to `/setup#setup-firecrawl` (`https://www.firecrawl.dev/app/api-keys`).",
    ].join("\n"),
    builtIn: true,
    updatedAt: "2026-11-18T00:00:00.000Z",
  },
];

export interface SkillStore {
  listSkills: (userId: string) => Promise<SkillItem[]>;
  upsertSkill: (input: {
    userId: string;
    slug: string;
    name: string;
    description: string;
    instructions: string;
  }) => Promise<SkillItem>;
  deleteSkill: (opts: { userId: string; slug: string }) => Promise<boolean>;
}

export class SkillStoreUnavailableError extends Error {}

export function normalizeSkillSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const EXPLICIT_SKILL_REGEX = /(?:^|\s)(?:\/skill:|@skill:)([a-z0-9-]{2,64})\b/i;

export function extractRequestedSkillSlug(userText: string): string | null {
  const match = EXPLICIT_SKILL_REGEX.exec(userText);
  return match ? match[1].toLowerCase() : null;
}

export function formatSkillPromptBlock(skill: SkillItem): string {
  return `## Active Skill: ${skill.name} (${skill.slug})\nFollow these domain instructions for this turn while obeying all system safety and truthfulness rules:\n${skill.instructions.slice(0, 2000)}`;
}

export function createInMemorySkillStore(): SkillStore {
  const custom = new Map<string, SkillItem & { userId: string }>();

  return {
    listSkills(userId) {
      const userItems = [...custom.values()]
        .filter((item) => item.userId === userId)
        .map(({ userId: _u, ...rest }) => ({ ...rest }));
      const overriddenSlugs = new Set(userItems.map((i) => i.slug));
      const merged = [
        ...userItems,
        ...BUILT_IN_SKILLS.filter((b) => !overriddenSlugs.has(b.slug)),
      ];
      return Promise.resolve(merged);
    },
    upsertSkill({ userId, slug, name, description, instructions }) {
      const cleanSlug = normalizeSkillSlug(slug);
      if (cleanSlug.length < 2) {
        throw new Error("Invalid skill slug");
      }
      const key = `${userId}:${cleanSlug}`;
      const existing = custom.get(key);
      const saved = {
        id: existing?.id ?? randomUUID(),
        userId,
        slug: cleanSlug,
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        builtIn: false,
        updatedAt: new Date().toISOString(),
      };
      custom.set(key, saved);
      const { userId: _u, ...pub } = saved;
      return Promise.resolve(pub);
    },
    deleteSkill({ userId, slug }) {
      return Promise.resolve(
        custom.delete(`${userId}:${normalizeSkillSlug(slug)}`)
      );
    },
  };
}

function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new SkillStoreUnavailableError("POSTGRES_URL is not configured");
  }
  return getSharedPostgresClient(process.env.POSTGRES_URL);
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

export function createPostgresSkillStore(): SkillStore {
  return {
    async listSkills(userId) {
      try {
        const sql = await readySql();
        const rows = await sql`
          SELECT "id", "slug", "name", "description", "instructions", "updatedAt"
          FROM "SkillEntry"
          WHERE "userId" = ${userId}
          ORDER BY "updatedAt" DESC
        `;
        const customItems: SkillItem[] = rows.map((row) => ({
          id: String(row.id),
          slug: String(row.slug),
          name: String(row.name),
          description: String(row.description),
          instructions: String(row.instructions),
          builtIn: false,
          updatedAt: new Date(row.updatedAt).toISOString(),
        }));
        const customSlugs = new Set(customItems.map((i) => i.slug));
        return [
          ...customItems,
          ...BUILT_IN_SKILLS.filter((b) => !customSlugs.has(b.slug)),
        ];
      } catch (error) {
        if (
          isMissingTable(error) ||
          error instanceof SkillStoreUnavailableError
        ) {
          return [...BUILT_IN_SKILLS];
        }
        throw error;
      }
    },
    async upsertSkill({ userId, slug, name, description, instructions }) {
      const cleanSlug = normalizeSkillSlug(slug);
      if (cleanSlug.length < 2) {
        throw new Error("Invalid skill slug");
      }
      const id = randomUUID();
      try {
        const sql = await readySql();
        const [row] = await sql`
          INSERT INTO "SkillEntry" ("id", "userId", "slug", "name", "description", "instructions")
          VALUES (${id}, ${userId}, ${cleanSlug}, ${name.trim()}, ${description.trim()}, ${instructions.trim()})
          ON CONFLICT ("userId", "slug")
          DO UPDATE SET
            "name" = EXCLUDED."name",
            "description" = EXCLUDED."description",
            "instructions" = EXCLUDED."instructions",
            "updatedAt" = now()
          RETURNING "id", "slug", "name", "description", "instructions", "updatedAt"
        `;
        return {
          id: String(row.id),
          slug: String(row.slug),
          name: String(row.name),
          description: String(row.description),
          instructions: String(row.instructions),
          builtIn: false,
          updatedAt: new Date(row.updatedAt).toISOString(),
        };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new SkillStoreUnavailableError("SkillEntry table missing");
        }
        throw error;
      }
    },
    async deleteSkill({ userId, slug }) {
      try {
        const sql = await readySql();
        const deleted = await sql`
          DELETE FROM "SkillEntry"
          WHERE "userId" = ${userId} AND "slug" = ${normalizeSkillSlug(slug)}
          RETURNING "id"
        `;
        return deleted.length > 0;
      } catch (error) {
        if (isMissingTable(error)) {
          throw new SkillStoreUnavailableError("SkillEntry table missing");
        }
        throw error;
      }
    },
  };
}
