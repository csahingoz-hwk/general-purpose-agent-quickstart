import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { getRequestModelAvailability } from "@/lib/ai/model-runtime";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { isPremiumModel, premiumLaneEnabled } from "@/lib/ai/routing/catalog";
import { createUsageLedger } from "@/lib/ai/routing/ledger";
import { inferenceSession } from "@/lib/ai/routing/session";
import { computeNextRunAt } from "@/lib/cron/cron-utils";
import {
  deleteCronJob,
  getCronJobByIdAndUser,
  setCronJobEnabled,
  updateCronJobAfterRun,
} from "@/lib/db/queries";
import {
  createPostgresTaskStore,
  executeDryRunTask,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";
import { generateUUID } from "@/lib/utils";

const toggleSchema = z.object({
  enabled: z.boolean(),
});

const uuidSchema = z.string().uuid();

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
  if (!uuidSchema.safeParse(id).success) {
    return Response.json({ error: "Invalid schedule id" }, { status: 400 });
  }
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
  if (!uuidSchema.safeParse(id).success) {
    return Response.json({ error: "Invalid schedule id" }, { status: 400 });
  }
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

    const availability = await getRequestModelAvailability();
    if (premiumLaneEnabled() && availability.status === "ready") {
      await store.transitionTask({
        userId: session.user.id,
        id: task.id,
        status: "running",
        stepMessage: "Executing routine prompt with assistant model",
      });
      const execution = {
        ledger: createUsageLedger(session.user.id, generateUUID()),
        available: availability.models.map((m) => m.id).filter(isPremiumModel),
        exposed: false,
        toolBoundary: false,
        fallbackUsed: false,
      };
      try {
        const generated = await inferenceSession.run(execution, () =>
          generateText({
            model: getLanguageModel(DEFAULT_CHAT_MODEL),
            system:
              "You are executing a scheduled briefing routine for the workspace owner. Return a crisp, well-structured, factual response with no filler.",
            prompt: job.prompt,
            maxOutputTokens: 900,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(35_000),
          })
        );
        const output = generated.text.trim() || "Routine completed.";
        const completed = await store.transitionTask({
          userId: session.user.id,
          id: task.id,
          status: "succeeded",
          stepMessage: "Routine run completed",
          output,
        });
        await updateCronJobAfterRun({
          id: job.id,
          nextRunAt: computeNextRunAt(job.cronExpression, job.timezone),
          lastRunAt: new Date(),
          lastError: null,
          lastOutput: output.slice(0, 4000),
        });
        return Response.json({ task: completed ?? task }, { status: 201 });
      } catch (runErr) {
        const errMsg =
          runErr instanceof Error ? runErr.message : "Model execution failed";
        const failed = await store.transitionTask({
          userId: session.user.id,
          id: task.id,
          status: "failed",
          stepMessage: "Routine execution failed",
          error: errMsg.slice(0, 500),
        });
        await updateCronJobAfterRun({
          id: job.id,
          nextRunAt: computeNextRunAt(job.cronExpression, job.timezone),
          lastRunAt: new Date(),
          lastError: errMsg.slice(0, 500),
          lastOutput: job.lastOutput,
        });
        return Response.json({ task: failed ?? task }, { status: 201 });
      }
    }

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
  if (!uuidSchema.safeParse(id).success) {
    return new Response("Invalid schedule id", { status: 400 });
  }
  const deleted = await deleteCronJob({ id, userId: session.user.id });
  if (!deleted) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json({ id, deleted: true });
}
