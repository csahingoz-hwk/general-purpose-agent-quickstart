import { tool } from "ai";
import { z } from "zod";
import { geocodeCity } from "@/lib/location";
import type { HomeLocation } from "@/lib/temporal";

export const getWeather = ({ home }: { home: HomeLocation | null }) =>
  tool({
    description:
      "Get the current weather. Provide a city name or coordinates the user gave; if they gave neither, the saved home location is used. If no location is known the tool returns location_required: ask the user for a city and never guess one.",
    inputSchema: z.object({
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      city: z.string().describe("City name stated by the user").optional(),
    }),
    toModelOutput: ({ output }) => {
      if (output && typeof output === "object" && "error" in output) {
        return { type: "text", value: String(output.error) } as const;
      }
      // The weather card keeps all hourly/daily data; the model receives only
      // the essential forecast so later turns don't replay huge JSON arrays.
      const forecast = output as {
        cityName?: string;
        current?: { time?: string; temperature_2m?: number };
        current_units?: { temperature_2m?: string };
        daily?: { sunrise?: string[]; sunset?: string[] };
      };
      return {
        type: "text",
        value: JSON.stringify({
          city: forecast.cityName ?? "requested location",
          time: forecast.current?.time,
          temperature: forecast.current?.temperature_2m,
          unit: forecast.current_units?.temperature_2m,
          sunrise: forecast.daily?.sunrise?.[0],
          sunset: forecast.daily?.sunset?.[0],
          note: "Full forecast available to the client weather card.",
        }),
      } as const;
    },
    execute: async (input, { abortSignal }) => {
      let latitude: number;
      let longitude: number;

      let cityName: string | undefined;
      if (input.city) {
        const coords = await geocodeCity(input.city);
        if (!coords) {
          return {
            error: `Could not find coordinates for "${input.city}". Please check the city name.`,
          };
        }
        latitude = coords.latitude;
        longitude = coords.longitude;
        cityName = input.city;
      } else if (
        input.latitude !== undefined &&
        input.longitude !== undefined
      ) {
        latitude = input.latitude;
        longitude = input.longitude;
      } else if (home) {
        latitude = home.latitude;
        longitude = home.longitude;
        cityName = home.label;
      } else {
        return { error: "location_required" as const };
      }

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`,
        {
          signal: AbortSignal.any([
            AbortSignal.timeout(10_000),
            ...(abortSignal ? [abortSignal] : []),
          ]),
        }
      );

      if (!response.ok) {
        throw new Error("Weather service unavailable");
      }
      const weatherData = await response.json();
      if (!weatherData.current || !weatherData.hourly || !weatherData.daily) {
        throw new Error("Incomplete weather forecast");
      }

      if (cityName) {
        weatherData.cityName = cityName;
      }

      return weatherData;
    },
  });
