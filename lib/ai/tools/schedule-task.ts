import { tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  isRoutinesEnabled,
  validateRoutineInput,
} from "@/lib/cron/routine-presets";
import { createCronJob } from "@/lib/db/queries";

type ScheduleTaskProps = {
  session: Session;
};

export const scheduleTask = ({ session }: ScheduleTaskProps) =>
  tool({
    description:
      "Propose a recurring routine on a 5-field cron schedule (e.g. '0 8 * * 1-5' in 'Europe/London') for explicit owner approval.",
    inputSchema: z.object({
      cronExpression: z
        .string()
        .describe("Standard 5-field cron expression in the given timezone."),
      prompt: z
        .string()
        .describe("Self-contained instruction to run when the schedule fires."),
      timezone: z
        .string()
        .default("Europe/London")
        .describe("IANA timezone (defaults to Europe/London)."),
    }),
    needsApproval: true,
    execute: async ({ cronExpression, prompt, timezone }) => {
      if (!isRoutinesEnabled() || session.user.type === "guest") {
        return {
          error:
            "Schedule creation is disabled until ROUTINES_ENABLED=true is enabled",
        };
      }
      const validated = validateRoutineInput({
        cronExpression,
        timezone,
        prompt,
      });
      if (!validated.ok) {
        return { error: validated.error };
      }
      const created = await createCronJob({
        userId: session.user.id,
        cronExpression: validated.cronExpression,
        timezone: validated.timezone,
        prompt: validated.prompt,
        nextRunAt: validated.nextRunAt,
      });
      return {
        id: created.id,
        cronExpression: created.cronExpression,
        timezone: created.timezone,
        prompt: created.prompt,
        nextRunAt: created.nextRunAt.toISOString(),
      };
    },
  });
