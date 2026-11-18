import { tool } from "ai";
import { z } from "zod";
import {
  deriveFactKey,
  toSelfContainedSentence,
} from "@/lib/memory/bulk-import";
import {
  type MemorySource,
  type MemoryStore,
  SensitiveMemoryBlockedError,
} from "@/lib/memory/store";

export function createMemoryTools({
  userId,
  store,
  defaultSource = "chat",
}: {
  userId: string;
  store: MemoryStore;
  defaultSource?: MemorySource;
}) {
  const saveProfileFact = tool({
    description:
      "Save or update one self-contained durable sentence about the user in their memory (categories: rules, preferences, about_me, family, work, projects). Never store passwords, payment card numbers, or physical street addresses.",
    inputSchema: z.object({
      category: z
        .enum([
          "rules",
          "preferences",
          "about_me",
          "family",
          "work",
          "projects",
          "identity",
          "preference",
          "finance",
          "project",
          "general",
        ])
        .default("about_me"),
      key: z.string().trim().min(2).max(120),
      value: z.string().trim().min(1).max(1500),
      pinned: z.boolean().optional(),
      sharedAcrossBots: z.boolean().default(true),
    }),
    execute: async ({ category, key, value, pinned, sharedAcrossBots }) => {
      try {
        const sentence = toSelfContainedSentence(value);
        const saved = await store.upsertProfileFact({
          userId,
          category,
          key: key.trim().length >= 2 ? key : deriveFactKey(sentence),
          value: sentence,
          source: defaultSource,
          pinned,
          sharedAcrossBots,
        });
        return {
          saved: true as const,
          fact: saved,
        };
      } catch (err) {
        if (err instanceof SensitiveMemoryBlockedError) {
          return {
            saved: false as const,
            skippedSensitive: true as const,
            reason: err.reason,
            warning:
              "Passwords, card numbers, and street addresses are never stored in memory.",
          };
        }
        throw err;
      }
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value: output.saved
        ? {
            saved: true,
            key: output.fact.key,
            category: output.fact.category,
            source: output.fact.source,
            pinned: output.fact.pinned,
          }
        : {
            saved: false,
            skippedSensitive: true,
            reason: output.reason,
            warning: output.warning,
          },
    }),
  });

  const addJournalEntry = tool({
    description:
      "Append a timestamped note, decision, or daily summary to the user's episodic Journal memory.",
    inputSchema: z.object({
      title: z.string().trim().min(2).max(200),
      body: z.string().trim().min(2).max(4000),
      tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    }),
    execute: async ({ title, body, tags }) => {
      try {
        const entry = await store.addJournalEntry({
          userId,
          title,
          body,
          tags,
          source: defaultSource === "voice" ? "chat" : "chat",
        });
        return {
          logged: true as const,
          entry,
        };
      } catch (err) {
        if (err instanceof SensitiveMemoryBlockedError) {
          return {
            logged: false as const,
            skippedSensitive: true as const,
            reason: err.reason,
            warning:
              "Passwords, card numbers, and street addresses are never stored in memory.",
          };
        }
        throw err;
      }
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value: output.logged
        ? {
            logged: true,
            id: output.entry.id,
            title: output.entry.title,
            tags: output.entry.tags,
          }
        : {
            logged: false,
            skippedSensitive: true,
            reason: output.reason,
          },
    }),
  });

  const recallMemories = tool({
    description:
      "Search the user's durable facts and chronological Journal entries before answering questions about their preferences, rules, family, projects, or ongoing work.",
    inputSchema: z.object({
      query: z.string().trim().max(200).optional(),
      tag: z.string().trim().max(40).optional(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ query, tag, limit }) => {
      const [allFacts, journalEntries] = await Promise.all([
        store.listProfileFacts({ userId }),
        store.listJournalEntries({ userId, query, tag, limit }),
      ]);
      const q = query?.toLowerCase();
      const profileFacts = (
        q
          ? allFacts.filter(
              (item) =>
                item.key.toLowerCase().includes(q) ||
                item.value.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q)
            )
          : allFacts
      ).slice(0, 20);

      return {
        profileFacts,
        journalEntries,
      };
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value: {
        profileFacts: output.profileFacts.map((f) => ({
          category: f.category,
          value: f.value,
          source: f.source,
          pinned: f.pinned,
          learnedAt: f.learnedAt,
        })),
        journalEntries: output.journalEntries.map((j) => ({
          title: j.title,
          body: j.body.slice(0, 400),
          tags: j.tags,
          createdAt: j.createdAt,
        })),
      },
    }),
  });

  return {
    saveProfileFact,
    addJournalEntry,
    recallMemories,
  };
}
