import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { executeApprovedTask } from "@/lib/ai/tools/delegate-task";
import { commitApprovedMeetingReview } from "@/lib/meetings/meeting-copilot";
import {
  createPostgresTaskStore,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";

const patchBodySchema = z.object({
  action: z.enum(["approve", "cancel"]),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    const store = createPostgresTaskStore();
    const task = await store.getTask({ userId: session.user.id, id });
    if (!task) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ status: "ready", task });
  } catch (error) {
    if (error instanceof TaskStoreUnavailableError) {
      return Response.json({ status: "setup_required", task: null });
    }
    return Response.json({ error: "Task runner unavailable" }, { status: 503 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  let body: z.infer<typeof patchBodySchema>;
  try {
    body = patchBodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid task action" }, { status: 400 });
  }

  try {
    const store = createPostgresTaskStore();
    if (body.action === "approve") {
      const existing = await store.getTask({ userId: session.user.id, id });
      if (!existing) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      if (existing.status !== "awaiting_approval") {
        return Response.json(
          { error: "Task is not awaiting approval" },
          { status: 400 }
        );
      }
      if (existing.kind === "meeting_copilot") {
        const committed = await commitApprovedMeetingReview({
          userId: session.user.id,
          taskId: id,
          taskStore: store,
        });
        return Response.json({ task: committed.task, committed });
      }
      const executed = await executeApprovedTask({
        userId: session.user.id,
        taskId: id,
        store,
      });
      return Response.json({ task: executed });
    }

    const cancelled = await store.cancelTask({ userId: session.user.id, id });
    if (!cancelled) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ task: cancelled });
  } catch {
    return Response.json({ error: "Could not update task" }, { status: 503 });
  }
}
