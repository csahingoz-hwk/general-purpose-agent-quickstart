import { validTimeZone } from "../temporal";
import { computeNextRunAt, validateCronExpression } from "./cron-utils";

export type RoutinePreset = {
  id: string;
  label: string;
  description: string;
  cronExpression: string;
  timezone: string;
  prompt: string;
};

export const ROUTINE_PRESETS: readonly RoutinePreset[] = [
  {
    id: "morning-brief",
    label: "Weekday 08:00 Brief",
    description: "London morning weather, top priorities, and day structure",
    cronExpression: "0 8 * * 1-5",
    timezone: "Europe/London",
    prompt:
      "Prepare my concise weekday morning brief for London: check today's weather, highlight key focus blocks, and list any open items from memory.",
  },
  {
    id: "close-checklist",
    label: "Month-End Close (WD 1–5)",
    description: "09:00 reminder during the first 5 calendar days of the month",
    cronExpression: "0 9 1-5 * *",
    timezone: "Europe/London",
    prompt:
      "Run my month-end close control check: summarize open accruals, FX revaluation checks, SOX sign-off reminders, and key variance questions to review today.",
  },
  {
    id: "fx-market-pulse",
    label: "Weekday 07:30 FX Pulse",
    description: "Early GBP, USD, EUR, SAR, AED, and TRY rate & headline check",
    cronExpression: "30 7 * * 1-5",
    timezone: "Europe/London",
    prompt:
      "Check current GBP/USD, EUR/USD, and USD/TRY movements and summarize any material macro headlines in 5 bullet points.",
  },
  {
    id: "weekly-review",
    label: "Friday 17:00 Wrap-Up",
    description: "End-of-week journal synthesis and next-week carryovers",
    cronExpression: "0 17 * * 5",
    timezone: "Europe/London",
    prompt:
      "Synthesize this week's key decisions and open follow-ups into a crisp Friday wrap-up and suggest top 3 priorities for Monday.",
  },
];

export function isRoutinesEnabled(): boolean {
  return process.env.ROUTINES_ENABLED === "true";
}

export function validateRoutineInput(input: {
  cronExpression: string;
  timezone?: string;
  prompt: string;
}):
  | {
      ok: true;
      cronExpression: string;
      timezone: string;
      prompt: string;
      nextRunAt: Date;
    }
  | { ok: false; error: string } {
  const cronExpression = input.cronExpression.trim();
  const prompt = input.prompt.trim();

  if (!prompt) {
    return { ok: false, error: "Routine prompt cannot be empty" };
  }
  if (prompt.length > 4000) {
    return {
      ok: false,
      error: "Routine prompt must be 4000 characters or fewer",
    };
  }

  const resolvedTz =
    input.timezone === undefined
      ? "Europe/London"
      : validTimeZone(input.timezone.trim());

  if (!resolvedTz) {
    return { ok: false, error: "Invalid IANA timezone" };
  }

  const fields = cronExpression.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    return {
      ok: false,
      error:
        "Cron expression must have exactly 5 fields (min hour dom mon dow)",
    };
  }

  const check = validateCronExpression(cronExpression, resolvedTz);
  if (!check.valid) {
    return { ok: false, error: check.error };
  }

  const nextRunAt = computeNextRunAt(cronExpression, resolvedTz);
  return {
    ok: true,
    cronExpression,
    timezone: resolvedTz,
    prompt,
    nextRunAt,
  };
}
