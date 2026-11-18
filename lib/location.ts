import type { HomeLocation } from "./temporal";

export type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
  country: string | null;
  timeZone: string | null;
};

/** Resolve a city name through Open-Meteo geocoding. Returns null when not found. */
export async function geocodeCity(
  city: string,
  fetcher: typeof fetch = fetch
): Promise<GeocodeResult | null> {
  const name = city.trim();
  if (name.length < 2 || name.length > 120) {
    return null;
  }
  try {
    const response = await fetcher(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const hit = data?.results?.[0];
    if (
      !hit ||
      typeof hit.latitude !== "number" ||
      typeof hit.longitude !== "number"
    ) {
      return null;
    }
    return {
      label: String(hit.name ?? name),
      latitude: hit.latitude,
      longitude: hit.longitude,
      country: typeof hit.country === "string" ? hit.country : null,
      timeZone: typeof hit.timezone === "string" ? hit.timezone : null,
    };
  } catch {
    return null;
  }
}

/** Coordinates saved after explicit browser permission are rounded to about 1 km. */
export function browserLocation(
  latitude: unknown,
  longitude: unknown,
  timeZone: string | null
): HomeLocation | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }
  return {
    label: "Current location",
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100,
    timeZone,
    source: "browser",
  };
}

/** Name the place for rounded coordinates. Falls back to a neutral label on any failure. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch
): Promise<{ label: string; country: string | null } | null> {
  try {
    const response = await fetcher(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const label = [data?.locality, data?.city].find(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    return label
      ? {
          label: String(label).trim(),
          country:
            typeof data?.countryName === "string" ? data.countryName : null,
        }
      : null;
  } catch {
    return null;
  }
}
