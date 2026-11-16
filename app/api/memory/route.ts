import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import {
  createPostgresMemoryStore,
  isMemoryToolsEnabled,
  MemoryStoreUnavailableError,
} from "@/lib/memory/store";

const profileBodySchema = z.object({
  type: z.literal("profile"),
  category: z
    .enum(["identity", "preference", "work", "finance", "project", "general"])
    .default("general"),
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(2000),
  sharedAcrossBots: z.boolean().default(true),
});

const journalBodySchema = z.object({
  type: z.literal("journal"),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
});

const createMemorySchema = z.discriminatedUnion("type", [
  profileBodySchema,
  journalBodySchema,
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
        limit: 50,
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
        key: body.key,
        value: body.value,
        sharedAcrossBots: body.sharedAcrossBots,
      });
      return Response.json({ fact }, { status: 201 });
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
    if (error instanceof MemoryStoreUnavailableError) {
      return Response.json(
        { error: "Memory tables require parity-schema.sql setup" },
        { status: 503 }
      );
    }
    return Response.json({ error: "Could not save memory" }, { status: 500 });
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
