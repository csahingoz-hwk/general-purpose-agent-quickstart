import { tool } from "ai";
import { z } from "zod";
import { describeTime, validTimeZone } from "@/lib/temporal";

/** Deterministic: computed from the server clock, never from model memory. */
export const getCurrentTime = ({
  defaultTimeZone,
  now = () => new Date(),
}: {
  defaultTimeZone: string | null;
  now?: () => Date;
}) =>
  tool({
    description:
      "Get the exact current date and time from the server clock in any IANA time zone (e.g. Europe/London, Europe/Istanbul), including UTC offset and whether daylight saving is in effect. Omit timeZone to use the user's browser time zone. Never answer clock or date questions from memory.",
    inputSchema: z.object({
      timeZone: z
        .string()
        .max(64)
        .optional()
        .describe("IANA time zone name such as Europe/Istanbul"),
    }),
    execute: ({ timeZone }) => {
      const requested =
        timeZone === undefined ? undefined : validTimeZone(timeZone);
      if (timeZone !== undefined && !requested) {
        return { error: "invalid_timezone" as const };
      }
      const zone = requested ?? defaultTimeZone;
      if (!zone) {
        return { error: "timezone_unknown" as const, utc: now().toISOString() };
      }
      return describeTime(now(), zone);
    },
  });
