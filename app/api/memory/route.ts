import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { deriveFactKey } from "@/lib/memory/bulk-import";
import {
  createPostgresMemoryStore,
  isMemoryToolsEnabled,
  MemoryStoreUnavailableError,
  SensitiveMemoryBlockedError,
} from "@/lib/memory/store";

const categoryEnum = z.enum([
  "rules",
  "preferences",
  "about_me",
  "family",
  "work",
  "projects",
  // Legacy compatibility aliases
  "identity",
  "preference",
  "finance",
  "project",
  "general",
]);

const sourceEnum = z.enum(["pasted", "chat", "voice"]);

const profileBodySchema = z.object({
  type: z.literal("profile"),
  category: categoryEnum.default("about_me"),
  key: z.string().trim().min(1).max(120).optional(),
  value: z.string().trim().min(1).max(2000),
  source: sourceEnum.default("pasted"),
  pinned: z.boolean().optional(),
  sharedAcrossBots: z.boolean().default(true),
});

const profileBatchBodySchema = z.object({
  type: z.literal("profile_batch"),
  source: sourceEnum.default("pasted"),
  items: z
    .array(
      z.object({
        category: categoryEnum.default("about_me"),
        key: z.string().trim().min(1).max(120).optional(),
        value: z.string().trim().min(1).max(2000),
        source: sourceEnum.optional(),
        pinned: z.boolean().optional(),
        sharedAcrossBots: z.boolean().default(true),
      })
    )
    .min(1)
    .max(250),
});

const journalBodySchema = z.object({
  type: z.literal("journal"),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
});

const createMemorySchema = z.discriminatedUnion("type", [
  profileBodySchema,
  profileBatchBodySchema,
  journalBodySchema,
]);

const updateMemorySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("profile"),
    id: z.string().uuid(),
    category: categoryEnum.optional(),
    value: z.string().trim().min(1).max(2000).optional(),
    pinned: z.boolean().optional(),
    sharedAcrossBots: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("journal"),
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(8000),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  }),
]);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() || undefined;
  const tag = searchParams.get("tag")?.trim() || undefined;
  const toolsEnabled = isMemoryToolsEnabled();

  try {
    const store = createPostgresMemoryStore();
    const [allFacts, journalEntries] = await Promise.all([
      store.listProfileFacts({ userId: session.user.id }),
      store.listJournalEntries({
        userId: session.user.id,
        query,
        tag,
        limit: 100,
      }),
    ]);
    const normalizedQuery = query?.toLowerCase();
    const profileFacts = normalizedQuery
      ? allFacts.filter(
          (f) =>
            f.key.toLowerCase().includes(normalizedQuery) ||
            f.value.toLowerCase().includes(normalizedQuery) ||
            f.category.toLowerCase().includes(normalizedQuery)
        )
      : allFacts;

    return Response.json({
      status: "ready",
      toolsEnabled,
      profileFacts,
      journalEntries,
    });
  } catch (error) {
    if (error instanceof MemoryStoreUnavailableError) {
      return Response.json({
        status: "setup_required",
        toolsEnabled,
        profileFacts: [],
        journalEntries: [],
      });
    }
    return Response.json(
      { error: "Memory store unavailable" },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof createMemorySchema>;
  try {
    body = createMemorySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid memory payload" }, { status: 400 });
  }

  try {
    const store = createPostgresMemoryStore();
    if (body.type === "profile") {
      const fact = await store.upsertProfileFact({
        userId: session.user.id,
        category: body.category,
        key: body.key || deriveFactKey(body.value),
        value: body.value,
        source: body.source,
        pinned: body.pinned,
        sharedAcrossBots: body.sharedAcrossBots,
      });
      return Response.json({ fact }, { status: 201 });
    }
    if (body.type === "profile_batch") {
      const result = await store.upsertProfileFactsBatch({
        userId: session.user.id,
        source: body.source,
        items: body.items,
      });
      return Response.json(
        {
          savedCount: result.saved.length,
          skippedDuplicates: result.skippedDuplicates,
          skippedSensitive: result.skippedSensitive,
          facts: result.saved,
        },
        { status: 201 }
      );
    }
    const entry = await store.addJournalEntry({
      userId: session.user.id,
      title: body.title,
      body: body.body,
      tags: body.tags,
      source: "manual",
    });
    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof SensitiveMemoryBlockedError) {
      return Response.json(
        {
          error:
            "Passwords, card numbers, and street addresses are never stored in memory.",
          reason: error.reason,
        },
        { status: 422 }
      );
    }
    if (error instanceof MemoryStoreUnavailableError) {
      return Response.json(
        { error: "Memory tables require parity-schema.sql setup" },
        { status: 503 }
      );
    }
    return Response.json({ error: "Could not save memory" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof updateMemorySchema>;
  try {
    body = updateMemorySchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: "Invalid memory update payload" },
      { status: 400 }
    );
  }

  try {
    const store = createPostgresMemoryStore();
    if (body.type === "profile") {
      const updated = await store.updateProfileFact({
        userId: session.user.id,
        id: body.id,
        category: body.category,
        value: body.value,
        pinned: body.pinned,
        sharedAcrossBots: body.sharedAcrossBots,
      });
      if (!updated) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ fact: updated });
    }
    const updatedEntry = await store.updateJournalEntry({
      userId: session.user.id,
      id: body.id,
      title: body.title,
      body: body.body,
      tags: body.tags,
    });
    if (!updatedEntry) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ entry: updatedEntry });
  } catch (error) {
    if (error instanceof SensitiveMemoryBlockedError) {
      return Response.json(
        {
          error:
            "Passwords, card numbers, and street addresses are never stored in memory.",
          reason: error.reason,
        },
        { status: 422 }
      );
    }
    return Response.json({ error: "Could not update memory" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("type");
  const id = searchParams.get("id")?.trim() ?? "";
  if (
    (kind !== "profile" && kind !== "journal") ||
    !z.string().uuid().safeParse(id).success
  ) {
    return Response.json(
      { error: "Missing valid type or uuid id" },
      { status: 400 }
    );
  }

  try {
    const store = createPostgresMemoryStore();
    const deleted =
      kind === "profile"
        ? await store.deleteProfileFact({ userId: session.user.id, id })
        : await store.deleteJournalEntry({ userId: session.user.id, id });
    if (!deleted) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ deleted: true, id });
  } catch {
    return Response.json({ error: "Could not delete memory" }, { status: 503 });
  }
}
