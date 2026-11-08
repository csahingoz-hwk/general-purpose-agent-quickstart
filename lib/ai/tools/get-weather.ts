import { tool } from "ai";
import { z } from "zod";

async function geocodeCity(
  city: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return null;
    }

    const result = data.results[0];
    return {
      latitude: result.latitude,
      longitude: result.longitude,
    };
  } catch {
    return null;
  }
}

export const getWeather = tool({
  description:
    "Get the current weather at a location. You can provide either coordinates or a city name.",
  inputSchema: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    city: z
      .string()
      .describe("City name (e.g., 'San Francisco', 'New York', 'London')")
      .optional(),
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
  execute: async (input) => {
    let latitude: number;
    let longitude: number;

    if (input.city) {
      const coords = await geocodeCity(input.city);
      if (!coords) {
        return {
          error: `Could not find coordinates for "${input.city}". Please check the city name.`,
        };
      }
      latitude = coords.latitude;
      longitude = coords.longitude;
    } else if (input.latitude !== undefined && input.longitude !== undefined) {
      latitude = input.latitude;
      longitude = input.longitude;
    } else {
      return {
        error:
          "Please provide either a city name or both latitude and longitude coordinates.",
      };
    }

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
    );

    const weatherData = await response.json();

    if ("city" in input) {
      weatherData.cityName = input.city;
    }

    return weatherData;
  },
});
