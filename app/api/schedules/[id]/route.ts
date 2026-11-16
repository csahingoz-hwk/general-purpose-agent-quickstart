import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { computeNextRunAt } from "@/lib/cron/cron-utils";
import {
  deleteCronJob,
  getCronJobByIdAndUser,
  setCronJobEnabled,
} from "@/lib/db/queries";
import {
  createPostgresTaskStore,
  executeDryRunTask,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";

const toggleSchema = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof toggleSchema>;
  try {
    body = toggleSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { id } = await params;
  const existing = await getCronJobByIdAndUser({
    id,
    userId: session.user.id,
  });
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const nextRunAt = body.enabled
    ? computeNextRunAt(existing.cronExpression, existing.timezone)
    : undefined;

  const updated = await setCronJobEnabled({
    id,
    userId: session.user.id,
    enabled: body.enabled,
    nextRunAt,
  });

  return Response.json({
    schedule: updated
      ? {
          id: updated.id,
          enabled: updated.enabled,
          nextRunAt: updated.nextRunAt.toISOString(),
        }
      : null,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await getCronJobByIdAndUser({ id, userId: session.user.id });
  if (!job) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const store = createPostgresTaskStore();
    const task = await store.enqueueTask({
      userId: session.user.id,
      kind: "routine",
      title: `Routine (${job.cronExpression})`,
      prompt: job.prompt,
      riskLevel: "medium",
      scheduleId: job.id,
    });
    const completed = await executeDryRunTask({
      store,
      userId: session.user.id,
      taskId: task.id,
    });
    return Response.json({ task: completed ?? task }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskStoreUnavailableError) {
      return Response.json(
        {
          error:
            "BackgroundTask table requires applying lib/db/parity-schema.sql first.",
        },
        { status: 503 }
      );
    }
    return Response.json(
      { error: "Could not enqueue routine preview" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteCronJob({ id, userId: session.user.id });
  if (!deleted) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json({ id, deleted: true });
}
