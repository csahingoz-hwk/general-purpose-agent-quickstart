import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import {
  isRoutinesEnabled,
  ROUTINE_PRESETS,
  validateRoutineInput,
} from "@/lib/cron/routine-presets";
import { createCronJob, getCronJobsByUserId } from "@/lib/db/queries";

const createScheduleSchema = z.object({
  cronExpression: z.string().min(5).max(64),
  timezone: z.string().min(1).max(64).optional(),
  prompt: z.string().min(1).max(4000),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobs = await getCronJobsByUserId({ userId: session.user.id });
  return Response.json({
    routinesEnabled: isRoutinesEnabled(),
    presets: ROUTINE_PRESETS,
    schedules: jobs.map((j) => ({
      id: j.id,
      cronExpression: j.cronExpression,
      timezone: j.timezone,
      prompt: j.prompt,
      enabled: j.enabled,
      nextRunAt: j.nextRunAt.toISOString(),
      lastRunAt: j.lastRunAt?.toISOString() ?? null,
      lastError: j.lastError,
      lastOutput: j.lastOutput,
      createdAt: j.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof createScheduleSchema>;
  try {
    parsed = createScheduleSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid routine fields" }, { status: 400 });
  }

  const validated = validateRoutineInput(parsed);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const created = await createCronJob({
    userId: session.user.id,
    cronExpression: validated.cronExpression,
    timezone: validated.timezone,
    prompt: validated.prompt,
    nextRunAt: validated.nextRunAt,
  });

  return Response.json(
    {
      schedule: {
        id: created.id,
        cronExpression: created.cronExpression,
        timezone: created.timezone,
        prompt: created.prompt,
        enabled: created.enabled,
        nextRunAt: created.nextRunAt.toISOString(),
        lastRunAt: created.lastRunAt?.toISOString() ?? null,
        lastError: created.lastError,
        lastOutput: created.lastOutput,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
