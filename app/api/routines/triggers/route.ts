import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import {
  defaultEventTriggerRegistry,
  pollEventTriggeredRoutinesForUser,
  resolveEventRoutineStore,
} from "@/lib/routines/event-routines";

const createTriggerSchema = z.object({
  source: z.string().trim().min(2).max(48),
  eventFilter: z.string().trim().max(120).optional().default("*"),
  title: z.string().trim().min(2).max(180),
  promptTemplate: z.string().trim().min(2).max(4000),
});

const toggleTriggerSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = resolveEventRoutineStore();
  const triggers = await store.listTriggers(session.user.id).catch(() => []);

  return NextResponse.json(
    {
      catalog: defaultEventTriggerRegistry.listCatalog(),
      triggers,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "poll_now") {
    const polled = await pollEventTriggeredRoutinesForUser({
      userId: session.user.id,
    });
    return NextResponse.json({
      status: "ok",
      seededCursors: polled.seededCursors,
      enqueuedCount: polled.enqueuedTasks.length,
      enqueuedTasks: polled.enqueuedTasks,
    });
  }

  let parsed: z.infer<typeof createTriggerSchema>;
  try {
    parsed = createTriggerSchema.parse(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid event trigger fields" },
      { status: 400 }
    );
  }

  const adapter = defaultEventTriggerRegistry.get(parsed.source);
  if (!adapter) {
    return NextResponse.json(
      { error: `Unsupported event source: ${parsed.source}` },
      { status: 400 }
    );
  }

  const store = resolveEventRoutineStore();
  const created = await store.createTrigger({
    userId: session.user.id,
    source: adapter.source,
    eventFilter: parsed.eventFilter,
    title: parsed.title,
    promptTemplate: parsed.promptTemplate,
  });

  // Best-effort initial baseline cursor seed for poll-based sources (e.g. Gmail)
  if (adapter.pollNewEvents) {
    await pollEventTriggeredRoutinesForUser({
      userId: session.user.id,
      eventStore: store,
    }).catch(() => null);
  }

  return NextResponse.json({ trigger: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof toggleTriggerSchema>;
  try {
    parsed = toggleTriggerSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const store = resolveEventRoutineStore();
  const updated = await store.toggleTrigger({
    userId: session.user.id,
    id: parsed.id,
    enabled: parsed.enabled,
  });
  if (!updated) {
    return NextResponse.json({ error: "Trigger not found" }, { status: 404 });
  }
  return NextResponse.json({ trigger: updated });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const store = resolveEventRoutineStore();
  const deleted = await store.deleteTrigger({
    userId: session.user.id,
    id,
  });
  return NextResponse.json({ deleted });
}
