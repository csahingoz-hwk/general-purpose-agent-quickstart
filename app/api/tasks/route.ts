import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { commitApprovedMeetingReview } from "@/lib/meetings/meeting-copilot";
import {
  createPostgresTaskStore,
  executeDryRunTask,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";

const enqueueSchema = z.object({
  kind: z
    .enum([
      "routine",
      "research",
      "executor",
      "draft_review",
      "browser_agent",
      "coding_worktree",
      "media_gen",
      "meeting_copilot",
    ])
    .default("executor"),
  title: z.string().trim().min(2).max(200),
  prompt: z.string().trim().min(2).max(4000),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["cancel", "approve"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const store = createPostgresTaskStore();
    const tasks = await store.listTasks({
      userId: session.user.id,
      limit: 30,
    });
    return Response.json({ status: "ready", tasks });
  } catch (error) {
    if (error instanceof TaskStoreUnavailableError) {
      return Response.json({ status: "setup_required", tasks: [] });
    }
    return Response.json({ error: "Task runner unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof enqueueSchema>;
  try {
    body = enqueueSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid task payload" }, { status: 400 });
  }

  try {
    const store = createPostgresTaskStore();
    const created = await store.enqueueTask({
      userId: session.user.id,
      kind: body.kind,
      title: body.title,
      prompt: body.prompt,
      riskLevel: body.riskLevel,
    });
    const updated = await executeDryRunTask({
      store,
      userId: session.user.id,
      taskId: created.id,
    });
    return Response.json({ task: updated ?? created }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskStoreUnavailableError) {
      return Response.json(
        { error: "BackgroundTask table requires parity-schema.sql setup" },
        { status: 503 }
      );
    }
    return Response.json({ error: "Could not enqueue task" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid task action" }, { status: 400 });
  }

  try {
    const store = createPostgresTaskStore();
    if (body.action === "approve") {
      const existing = await store.getTask({
        userId: session.user.id,
        id: body.id,
      });
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
          taskId: body.id,
          taskStore: store,
        });
        return Response.json({ task: committed.task, committed });
      }
      const resumed = await store.transitionTask({
        userId: session.user.id,
        id: body.id,
        status: "queued",
        stepMessage: "Approved by owner in Routines & Tasks hub",
      });
      return Response.json({ task: resumed });
    }

    const updated = await store.cancelTask({
      userId: session.user.id,
      id: body.id,
    });
    if (!updated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ task: updated });
  } catch {
    return Response.json({ error: "Could not update task" }, { status: 503 });
  }
}
