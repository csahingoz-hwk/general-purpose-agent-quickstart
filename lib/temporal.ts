/** Deterministic time and timezone helpers. Pure: callers inject the clock. */

export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function parts(date: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
  }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

/** UTC offset in minutes at an instant (positive east of UTC). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return Math.round(
    (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000
  );
}

function formatOffset(minutes: number) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Daylight saving is in force when the offset is the larger of the zone's two yearly offsets. */
export function isDaylightSaving(date: Date, timeZone: string): boolean {
  const year = date.getUTCFullYear();
  const jan = offsetMinutes(new Date(Date.UTC(year, 0, 1)), timeZone);
  const jul = offsetMinutes(new Date(Date.UTC(year, 6, 1)), timeZone);
  return jan !== jul && offsetMinutes(date, timeZone) === Math.max(jan, jul);
}

/** First instant (to the minute) within a year where the offset changes, or null. */
export function nextOffsetChange(date: Date, timeZone: string): string | null {
  const start = offsetMinutes(date, timeZone);
  const DAY = 86_400_000;
  let lo = date.getTime();
  for (let i = 1; i <= 400; i++) {
    const hi = date.getTime() + i * DAY;
    if (offsetMinutes(new Date(hi), timeZone) !== start) {
      let a = lo;
      let b = hi;
      while (b - a > 60_000) {
        const mid = Math.floor((a + b) / 2 / 60_000) * 60_000;
        if (offsetMinutes(new Date(mid), timeZone) === start) {
          a = mid === a ? a + 60_000 : mid;
        } else {
          b = mid;
        }
      }
      return new Date(b).toISOString();
    }
    lo = hi;
  }
  return null;
}

export type TimeDescription = {
  timeZone: string;
  utc: string;
  local: string;
  weekday: string;
  utcOffset: string;
  isDaylightSaving: boolean;
  abbreviation: string;
  nextOffsetChangeUtc: string | null;
};

export function describeTime(now: Date, timeZone: string): TimeDescription {
  const p = parts(now, timeZone);
  const offset = offsetMinutes(now, timeZone);
  const abbreviation =
    new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
      .formatToParts(now)
      .find((x) => x.type === "timeZoneName")?.value ?? "";
  return {
    timeZone,
    utc: now.toISOString(),
    local: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${formatOffset(offset)}`,
    weekday: p.weekday,
    utcOffset: formatOffset(offset),
    isDaylightSaving: isDaylightSaving(now, timeZone),
    abbreviation,
    nextOffsetChangeUtc: nextOffsetChange(now, timeZone),
  };
}

export type HomeLocation = {
  label: string;
  latitude: number;
  longitude: number;
  country?: string | null;
  timeZone?: string | null;
  source: "city" | "browser";
};

/** System-prompt block injected on every request. Never invents a location. */
export function contextBlock({
  now,
  timeZone,
  home,
}: {
  now: Date;
  timeZone: string | null;
  home: HomeLocation | null;
}): string {
  const lines = ["## Current context (authoritative, set by the server)"];
  lines.push(`- Server time (UTC): ${now.toISOString()}`);
  if (timeZone) {
    const t = describeTime(now, timeZone);
    lines.push(
      `- User's browser time zone: ${t.timeZone}; local time ${t.local} (${t.weekday}, ${t.abbreviation}, daylight saving ${t.isDaylightSaving ? "in effect" : "not in effect"})`
    );
  } else {
    lines.push(
      "- User's time zone: unknown. Say so, or ask, before giving a local time; do not guess."
    );
  }
  lines.push(
    home
      ? `- Saved home location: ${home.label}${home.country ? `, ${home.country}` : ""} (chosen by the user)`
      : "- Saved home location: none. The user's physical location is unknown; never guess it."
  );
  return lines.join("\n");
}
