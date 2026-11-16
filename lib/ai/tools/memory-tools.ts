import { tool } from "ai";
import { z } from "zod";
import type { MemoryStore } from "@/lib/memory/store";

export function createMemoryTools({
  userId,
  store,
}: {
  userId: string;
  store: MemoryStore;
}) {
  const saveProfileFact = tool({
    description:
      "Save or update a durable fact about the user in their structured Profile memory (e.g. role, reporting currency, communication preferences). Only call when the user states a lasting preference or fact.",
    inputSchema: z.object({
      category: z
        .enum([
          "identity",
          "preference",
          "work",
          "finance",
          "project",
          "general",
        ])
        .default("general"),
      key: z.string().trim().min(2).max(120),
      value: z.string().trim().min(1).max(1500),
      sharedAcrossBots: z.boolean().default(true),
    }),
    execute: async ({ category, key, value, sharedAcrossBots }) => {
      const saved = await store.upsertProfileFact({
        userId,
        category,
        key,
        value,
        sharedAcrossBots,
      });
      return {
        saved: true as const,
        fact: saved,
      };
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value: {
        saved: output.saved,
        key: output.fact.key,
        category: output.fact.category,
        sharedAcrossBots: output.fact.sharedAcrossBots,
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
      const entry = await store.addJournalEntry({
        userId,
        title,
        body,
        tags,
        source: "chat",
      });
      return {
        logged: true as const,
        entry,
      };
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value: {
        logged: output.logged,
        id: output.entry.id,
        title: output.entry.title,
        tags: output.entry.tags,
      },
    }),
  });

  const recallMemories = tool({
    description:
      "Search the user's durable Profile facts and chronological Journal entries before answering questions about their preferences, prior decisions, or ongoing work.",
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
      ).slice(0, 15);

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
          key: f.key,
          value: f.value,
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
