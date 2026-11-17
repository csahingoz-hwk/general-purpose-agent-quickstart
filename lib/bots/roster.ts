import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { buildSoulPrompt } from "@/lib/ai/prompts";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import { isMascotVariant, type MascotVariant } from "@/lib/mascot";
import type { ProfileFact } from "@/lib/memory/store";

export type BotTeammate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  soul: string;
  defaultModel: "gpt-6-luna" | "gpt-6.1-terra";
  mascotVariant: MascotVariant;
  skillSlugs: string[];
  builtIn: boolean;
};

export const ACTIVE_BOT_STORAGE_KEY = "assistant-active-bot";

export const BUILT_IN_TEAMMATES: readonly BotTeammate[] = [
  {
    id: "builtin-chief-of-staff",
    slug: "chief-of-staff",
    name: "Chief of Staff",
    description:
      "Daily planning, crisp executive synthesis, schedule triage, and bilingual EN/TR follow-ups.",
    soul: "## Role: Chief of Staff\nPrioritize clarity, time-boxed action plans, and proactive risk callouts. Keep summaries structured and concise.",
    defaultModel: "gpt-6-luna",
    mascotVariant: "blue",
    skillSlugs: [],
    builtIn: true,
  },
  {
    id: "builtin-finance-controller",
    slug: "finance-controller",
    name: "Finance Controller",
    description:
      "Audit-ready close checklists, variance commentary, reconciliations, and exact numerical grounding.",
    soul: "## Role: Finance Controller\nTreat every number as audit evidence: reconcile totals explicitly, separate Material vs. Immaterial drivers, never invent figures, and flag control gaps.",
    defaultModel: "gpt-6.1-terra",
    mascotVariant: "green",
    skillSlugs: ["month-end-close", "variance-commentary"],
    builtIn: true,
  },
  {
    id: "builtin-vibecoder",
    slug: "vibecoder",
    name: "Vibecoder",
    description:
      "TypeScript/Next.js architecture, surgical code diffs, security hardening, and automated test design.",
    soul: "## Role: Vibecoder\nFavor simple, verifiable vertical slices, strict TypeScript types, zero unnecessary dependencies, and explicit edge-case tests.",
    defaultModel: "gpt-6.1-terra",
    mascotVariant: "purple",
    skillSlugs: ["vibecode-audit"],
    builtIn: true,
  },
];

export function normalizeBotSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function extractRequestedBotSlug(text: string): string | null {
  const match = text.match(/(?:^|\s)@bot:([a-z0-9-]{2,64})\b/i);
  return match?.[1] ? normalizeBotSlug(match[1]) : null;
}

export function filterFactsForBot(
  facts: readonly ProfileFact[],
  activeBotSlug: string | null | undefined
): ProfileFact[] {
  const normalizedActive = activeBotSlug
    ? normalizeBotSlug(activeBotSlug)
    : null;

  return facts.filter((fact) => {
    if (fact.sharedAcrossBots) {
      return true;
    }
    if (!normalizedActive || !fact.botSlug) {
      return false;
    }
    return normalizeBotSlug(fact.botSlug) === normalizedActive;
  });
}

export function composeTeammateSoul(
  userSoul: string | null,
  teammate: BotTeammate | null
): string | null {
  if (!teammate) {
    return userSoul;
  }
  const combined = userSoul
    ? `${userSoul}\n\n${teammate.soul}`
    : buildSoulPrompt(teammate.soul);
  return combined;
}

export interface BotRosterStore {
  listBots: (userId: string) => Promise<BotTeammate[]>;
  getBotBySlug: (userId: string, slug: string) => Promise<BotTeammate | null>;
  upsertBot: (input: {
    userId: string;
    slug: string;
    name: string;
    description: string;
    soul: string;
    defaultModel?: "gpt-6-luna" | "gpt-6.1-terra";
    mascotVariant?: MascotVariant;
    skillSlugs?: string[];
  }) => Promise<BotTeammate>;
  deleteCustomBot: (opts: { userId: string; slug: string }) => Promise<boolean>;
}

export function createInMemoryBotRosterStore(): BotRosterStore {
  const customByUser = new Map<string, Map<string, BotTeammate>>();

  return {
    listBots(userId) {
      const merged = new Map<string, BotTeammate>();
      for (const b of BUILT_IN_TEAMMATES) {
        merged.set(b.slug, { ...b, skillSlugs: [...b.skillSlugs] });
      }
      const userMap = customByUser.get(userId);
      if (userMap) {
        for (const [slug, bot] of userMap.entries()) {
          merged.set(slug, { ...bot, skillSlugs: [...bot.skillSlugs] });
        }
      }
      return Promise.resolve([...merged.values()]);
    },

    async getBotBySlug(userId, slug) {
      const normalized = normalizeBotSlug(slug);
      const all = await this.listBots(userId);
      return all.find((b) => b.slug === normalized) ?? null;
    },

    upsertBot({
      userId,
      slug,
      name,
      description,
      soul,
      defaultModel = "gpt-6-luna",
      mascotVariant = "blue",
      skillSlugs = [],
    }) {
      const normalized = normalizeBotSlug(slug);
      if (!normalized || normalized.length < 2) {
        return Promise.reject(
          new Error("Bot slug must be at least 2 characters")
        );
      }
      const safeMascot: MascotVariant = isMascotVariant(mascotVariant)
        ? mascotVariant
        : "blue";
      const safeModel =
        defaultModel === "gpt-6.1-terra" ? "gpt-6.1-terra" : "gpt-6-luna";

      let userMap = customByUser.get(userId);
      if (!userMap) {
        userMap = new Map();
        customByUser.set(userId, userMap);
      }
      const existing = userMap.get(normalized);
      const saved: BotTeammate = {
        id: existing?.id ?? randomUUID(),
        slug: normalized,
        name: name.trim().slice(0, 80),
        description: description.trim().slice(0, 240),
        soul: soul.trim().slice(0, 4000),
        defaultModel: safeModel,
        mascotVariant: safeMascot,
        skillSlugs: skillSlugs
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8),
        builtIn: false,
      };
      userMap.set(normalized, saved);
      return Promise.resolve({ ...saved, skillSlugs: [...saved.skillSlugs] });
    },

    deleteCustomBot({ userId, slug }) {
      const normalized = normalizeBotSlug(slug);
      const userMap = customByUser.get(userId);
      if (!userMap) {
        return Promise.resolve(false);
      }
      return Promise.resolve(userMap.delete(normalized));
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    return null;
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 2,
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

export function createPostgresBotRosterStore(): BotRosterStore {
  return {
    async listBots(userId) {
      const merged = new Map<string, BotTeammate>();
      for (const b of BUILT_IN_TEAMMATES) {
        merged.set(b.slug, { ...b, skillSlugs: [...b.skillSlugs] });
      }
      const sql = getSql();
      if (!sql) {
        return [...merged.values()];
      }
      try {
        await ensureParitySchema(sql);
        const rows = await sql`
          SELECT * FROM "BotProfile"
          WHERE "userId" = ${userId}
          ORDER BY "updatedAt" DESC
        `;
        for (const r of rows) {
          const slug = String(r.slug);
          const mv = String(r.mascotVariant ?? "blue");
          merged.set(slug, {
            id: String(r.id),
            slug,
            name: String(r.name),
            description: String(r.description ?? ""),
            soul: String(r.soul),
            defaultModel:
              r.defaultModel === "gpt-6.1-terra"
                ? "gpt-6.1-terra"
                : "gpt-6-luna",
            mascotVariant: isMascotVariant(mv) ? mv : "blue",
            skillSlugs: Array.isArray(r.skillSlugs)
              ? r.skillSlugs.map(String)
              : [],
            builtIn: false,
          });
        }
      } catch (err) {
        if (!isMissingTable(err)) {
          throw err;
        }
      }
      return [...merged.values()];
    },

    async getBotBySlug(userId, slug) {
      const normalized = normalizeBotSlug(slug);
      const bots = await this.listBots(userId);
      return bots.find((b) => b.slug === normalized) ?? null;
    },

    async upsertBot({
      userId,
      slug,
      name,
      description,
      soul,
      defaultModel = "gpt-6-luna",
      mascotVariant = "blue",
      skillSlugs = [],
    }) {
      const sql = getSql();
      if (!sql) {
        throw new Error("Database is not configured for custom teammates");
      }
      await ensureParitySchema(sql);
      const normalized = normalizeBotSlug(slug);
      const safeMascot: MascotVariant = isMascotVariant(mascotVariant)
        ? mascotVariant
        : "blue";
      const safeModel =
        defaultModel === "gpt-6.1-terra" ? "gpt-6.1-terra" : "gpt-6-luna";
      const id = randomUUID();
      const cleanedSkills = skillSlugs
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);

      const [row] = await sql`
        INSERT INTO "BotProfile" (
          "id", "userId", "slug", "name", "description", "soul", "defaultModel", "mascotVariant", "skillSlugs"
        ) VALUES (
          ${id}, ${userId}, ${normalized}, ${name.trim().slice(0, 80)}, ${description.trim().slice(0, 240)},
          ${soul.trim().slice(0, 4000)}, ${safeModel}, ${safeMascot}, ${JSON.stringify(cleanedSkills)}::jsonb
        )
        ON CONFLICT ("userId", "slug") DO UPDATE SET
          "name" = EXCLUDED."name",
          "description" = EXCLUDED."description",
          "soul" = EXCLUDED."soul",
          "defaultModel" = EXCLUDED."defaultModel",
          "mascotVariant" = EXCLUDED."mascotVariant",
          "skillSlugs" = EXCLUDED."skillSlugs",
          "updatedAt" = now()
        RETURNING *
      `;
      return {
        id: String(row.id),
        slug: String(row.slug),
        name: String(row.name),
        description: String(row.description ?? ""),
        soul: String(row.soul),
        defaultModel: safeModel,
        mascotVariant: safeMascot,
        skillSlugs: cleanedSkills,
        builtIn: false,
      };
    },

    async deleteCustomBot({ userId, slug }) {
      const sql = getSql();
      if (!sql) {
        return false;
      }
      const normalized = normalizeBotSlug(slug);
      try {
        const res = await sql`
          DELETE FROM "BotProfile"
          WHERE "userId" = ${userId} AND "slug" = ${normalized}
          RETURNING "id"
        `;
        return res.length > 0;
      } catch (err) {
        if (isMissingTable(err)) {
          return false;
        }
        throw err;
      }
    },
  };
}
