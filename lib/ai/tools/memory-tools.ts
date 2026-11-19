import { tool } from "ai";
import { z } from "zod";
import {
  inferenceSession,
  type MemoryTurnDedupeState,
} from "@/lib/ai/routing/session";
import {
  deriveFactKey,
  toSelfContainedSentence,
} from "@/lib/memory/bulk-import";
import {
  type MemorySource,
  type MemoryStore,
  type ProfileFact,
  SensitiveMemoryBlockedError,
} from "@/lib/memory/store";

export type { MemoryTurnDedupeState } from "@/lib/ai/routing/session";

export function createMemoryTurnState(
  alreadySavedFact: ProfileFact | null = null
): MemoryTurnDedupeState {
  return {
    savedFact: alreadySavedFact,
    savedJournal: null,
    inFlightSavePromise: null,
  };
}

export function dedupeAssistantMemoryParts<
  T extends { type: string; output?: unknown },
>(parts: readonly T[]): T[] {
  let keptMemoryCard = false;
  return parts.filter((part) => {
    const isMemoryCardPart =
      part.type === "tool-saveProfileFact" ||
      part.type === "tool-addJournalEntry";
    if (!isMemoryCardPart) {
      return true;
    }
    const isMarkedDuplicate =
      Boolean(part.output) &&
      typeof part.output === "object" &&
      (part.output as { deduplicated?: boolean }).deduplicated === true;
    if (isMarkedDuplicate || keptMemoryCard) {
      return false;
    }
    keptMemoryCard = true;
    return true;
  });
}

export function createMemoryTools({
  userId,
  store,
  defaultSource = "chat",
  alreadySavedFact = null,
  dedupePerTurn = false,
  turnState,
}: {
  userId: string;
  store: MemoryStore;
  defaultSource?: MemorySource;
  alreadySavedFact?: ProfileFact | null;
  dedupePerTurn?: boolean;
  turnState?: MemoryTurnDedupeState;
}) {
  const state: MemoryTurnDedupeState =
    turnState ??
    (dedupePerTurn
      ? inferenceSession.getStore()?.memoryTurnState
      : undefined) ??
    createMemoryTurnState(alreadySavedFact);
  if (alreadySavedFact && !state.savedFact) {
    state.savedFact = alreadySavedFact;
  }

  const saveProfileFact = tool({
    description:
      "Save or update one self-contained durable sentence about the user in their memory (categories: rules, preferences, about_me, family, work, projects). Call at most once per turn. Never store passwords, payment card numbers, or physical street addresses.",
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
        if (state.inFlightSavePromise) {
          const firstSaved = await state.inFlightSavePromise;
          return {
            saved: true as const,
            deduplicated: true as const,
            fact: firstSaved,
          };
        }

        const sentence = toSelfContainedSentence(value);
        if (state.savedFact) {
          const existingLower = state.savedFact.value.toLowerCase();
          const incomingLower = sentence.toLowerCase();
          const sameFact =
            existingLower.includes(incomingLower) ||
            incomingLower.includes(existingLower) ||
            state.savedFact.key === key.trim();
          if (dedupePerTurn || sameFact) {
            return {
              saved: true as const,
              deduplicated: true as const,
              fact: state.savedFact,
            };
          }
        }

        if (dedupePerTurn && state.savedJournal) {
          return {
            saved: false as const,
            deduplicated: true as const,
            skippedSensitive: false as const,
            warning: "Memory note already saved on this turn.",
          };
        }

        const writePromise = store.upsertProfileFact({
          userId,
          category,
          key: key.trim().length >= 2 ? key : deriveFactKey(sentence),
          value: sentence,
          source: defaultSource,
          pinned,
          sharedAcrossBots,
        });
        state.inFlightSavePromise = writePromise;
        try {
          const saved = await writePromise;
          state.savedFact = saved;
          return {
            saved: true as const,
            fact: saved,
          };
        } finally {
          state.inFlightSavePromise = null;
        }
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
            skippedSensitive: output.skippedSensitive,
            reason: "reason" in output ? output.reason : undefined,
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
        if (state.savedJournal) {
          const sameEntry =
            state.savedJournal.title.trim().toLowerCase() ===
              title.trim().toLowerCase() ||
            state.savedJournal.body.trim().toLowerCase() ===
              body.trim().toLowerCase();
          if (dedupePerTurn || sameEntry) {
            return {
              logged: true as const,
              deduplicated: true as const,
              entry: state.savedJournal,
            };
          }
        }
        if (dedupePerTurn && state.savedFact) {
          return {
            logged: false as const,
            deduplicated: true as const,
            skippedSensitive: false as const,
            warning: "Profile memory was already saved on this turn.",
          };
        }
        const entry = await store.addJournalEntry({
          userId,
          title,
          body,
          tags,
          source: "chat",
        });
        state.savedJournal = entry;
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
            skippedSensitive: output.skippedSensitive,
            reason: "reason" in output ? output.reason : undefined,
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
