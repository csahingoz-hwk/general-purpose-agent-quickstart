import { tool } from "ai";
import { z } from "zod";
import { setUserHomeLocation } from "@/lib/db/queries";
import { geocodeCity } from "@/lib/location";

/** Only for a city the user explicitly states as their home. Never guessed. */
export const setHomeLocation = ({ userId }: { userId: string }) =>
  tool({
    description:
      "Save the city the user explicitly says is their home, so weather and local time questions do not need a city each time. Call only when the user states it. Never infer a city.",
    inputSchema: z.object({ city: z.string().min(2).max(120) }),
    execute: async ({ city }) => {
      const found = await geocodeCity(city);
      if (!found) {
        return { error: "city_not_found" as const };
      }
      await setUserHomeLocation({
        userId,
        homeLocation: { ...found, source: "city" },
      });
      return {
        saved: true as const,
        label: found.label,
        country: found.country,
      };
    },
  });
