import { z } from "zod";
import { validTimeZone } from "./temporal";

/** The owner's clock. Next-match answers are judged against this zone. */
export const OWNER_TIME_ZONE = "Europe/London" as const;

/** Default timezone for Turkish clubs / Süper Lig when no browser zone is known. */
export const TURKEY_TIME_ZONE = "Europe/Istanbul" as const;

export const FIXTURES_COVERAGE_NOTE =
  "May list domestic league matches only; European (Champions League/Europa/Conference) and cup matches can be missing. If the user asks about a European/cup match or another source mentions one, use webSearch and trust it.";

export type FixtureSide = {
  name: string;
  badge: string | null;
};

export type FixtureMatch = {
  id: string;
  competition: string;
  venue: string;
  kickoffUtc: string;
  kickoffLocal?: string;
  kickoffTimeZone?: string;
  home: FixtureSide;
  away: FixtureSide;
  homeScore: number | null;
  awayScore: number | null;
};

export type FixturePayload = {
  team: FixtureSide & { id: string };
  timeZone: string;
  kickoffTimeZone?: string;
  competitions?: string[];
  coverageNote?: string;
  now: string;
  upcoming: FixtureMatch[];
  last: FixtureMatch | null;
};

const sideSchema = z.object({
  name: z.string().min(1).max(80),
  badge: z.string().nullable(),
});

const matchSchema = z.object({
  id: z.string().min(1).max(40),
  competition: z.string().max(80),
  venue: z.string().max(80),
  kickoffUtc: z.string().min(16).max(40),
  kickoffLocal: z.string().max(80).optional(),
  kickoffTimeZone: z.string().max(80).optional(),
  home: sideSchema,
  away: sideSchema,
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
});

const payloadSchema = z.object({
  team: sideSchema.extend({ id: z.string().min(1).max(20) }),
  timeZone: z
    .string()
    .min(1)
    .max(64)
    .refine((tz) => validTimeZone(tz) !== null),
  kickoffTimeZone: z.string().max(80).optional(),
  competitions: z.array(z.string().max(80)).max(12).optional(),
  coverageNote: z.string().max(400).optional(),
  now: z.string().min(16).max(40),
  upcoming: z.array(matchSchema).max(3),
  last: matchSchema.nullable(),
});

export function readFixturePayload(value: unknown): FixturePayload | null {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  if (Number.isNaN(Date.parse(parsed.data.now))) {
    return null;
  }
  const upcoming = parsed.data.upcoming.filter(
    (match) => !Number.isNaN(Date.parse(match.kickoffUtc))
  );
  const last =
    parsed.data.last && !Number.isNaN(Date.parse(parsed.data.last.kickoffUtc))
      ? parsed.data.last
      : null;
  return { ...parsed.data, upcoming, last };
}

const BADGE_HOSTS = new Set([
  "r2.thesportsdb.com",
  "www.thesportsdb.com",
  "crests.football-data.org",
]);

export function safeBadgeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !BADGE_HOSTS.has(url.hostname)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function foldTurkish(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const TURKISH_COMPETITION_RE =
  /(?:super\s*lig|turkish|turkiye|\btff\b|ziraat|1\.\s*lig)/i;

const TURKISH_CLUB_RE =
  /\b(?:galatasaray|fenerbahce|besiktas|trabzonspor|basaksehir|samsunspor|kocaelispor|erzurumspor|konyaspor|antalyaspor|alanyaspor|kayserispor|sivasspor|goztepe|kasimpasa|eyupspor|rizespor|hatayspor|gaziantep|adana\s*demir|bodrumspor|ankaragucu|genclerbirligi|bursaspor|pendikspor|istanbulspor|karagumruk|umraniyespor|sakaryaspor|bandirmaspor|boluspor|manisaspor|corum|igdir|amed)\b/i;

export function isTurkishClubOrCompetition(
  teamName: string,
  competitions: readonly string[] = []
): boolean {
  if (TURKISH_CLUB_RE.test(foldTurkish(teamName))) {
    return true;
  }
  return competitions.some((comp) =>
    TURKISH_COMPETITION_RE.test(foldTurkish(comp))
  );
}

/**
 * Resolves the display time zone for fixtures:
 * 1. Explicit valid user/browser time zone when provided.
 * 2. Europe/Istanbul for Turkish clubs or Süper Lig when no user zone is known.
 * 3. Europe/London (OWNER_TIME_ZONE) otherwise.
 */
export function resolveFixtureTimeZone(opts: {
  userTimeZone?: string | null;
  teamName?: string;
  competitions?: readonly string[];
}): string {
  const explicit = validTimeZone(opts.userTimeZone);
  if (explicit) {
    return explicit;
  }
  if (
    isTurkishClubOrCompetition(opts.teamName ?? "", opts.competitions ?? [])
  ) {
    return TURKEY_TIME_ZONE;
  }
  return OWNER_TIME_ZONE;
}

export function formatTimeZoneLabel(
  timeZone: string,
  atDate: Date = new Date()
): string {
  const tz = validTimeZone(timeZone) ?? OWNER_TIME_ZONE;
  if (tz === "Europe/Istanbul" || tz === "Asia/Istanbul" || tz === "Turkey") {
    return "Europe/Istanbul (TSİ)";
  }
  const shortName = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    timeZoneName: "short",
  })
    .formatToParts(atDate)
    .find((p) => p.type === "timeZoneName")?.value;
  return shortName ? `${tz} (${shortName})` : tz;
}

export function formatKickoffLocal(
  kickoffUtc: string,
  timeZone: string,
  locale: "en" | "tr" = "tr"
): string | null {
  const kickoff = new Date(kickoffUtc);
  if (Number.isNaN(kickoff.getTime())) {
    return null;
  }
  const tz = validTimeZone(timeZone) ?? OWNER_TIME_ZONE;
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat(
    locale === "tr" ? "tr-TR" : "en-GB",
    {
      timeZone: tz,
      day: "numeric",
      month: "long",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  ).formatToParts(kickoff)) {
    parts[part.type] = part.value;
  }
  const day = parts.day ?? "";
  const month = parts.month ?? "";
  const weekday = parts.weekday ?? "";
  const clock = `${parts.hour ?? "00"}:${parts.minute ?? "00"}`;
  if (locale === "tr") {
    return `${day} ${month} ${weekday} ${clock}`.replace(/\s+/g, " ").trim();
  }
  return `${weekday}, ${day} ${month} ${clock}`.replace(/\s+/g, " ").trim();
}

type ZonedDate = { year: number; month: number; day: number };

function zonedDate(date: Date, timeZone: string): ZonedDate {
  const tz = validTimeZone(timeZone) ?? OWNER_TIME_ZONE;
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)) {
    out[part.type] = part.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
  };
}

function dayIndex(date: ZonedDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

export type KickoffLabel = {
  relative: string;
  clock: string;
  fullDate: string;
  shortDate: string;
};

export function labelKickoff(
  kickoffUtc: string,
  nowIso: string,
  locale: "en" | "tr",
  timeZone: string = OWNER_TIME_ZONE
): KickoffLabel | null {
  const kickoff = new Date(kickoffUtc);
  const now = new Date(nowIso);
  if (Number.isNaN(kickoff.getTime()) || Number.isNaN(now.getTime())) {
    return null;
  }
  const tz = validTimeZone(timeZone) ?? OWNER_TIME_ZONE;
  const delta = dayIndex(zonedDate(kickoff, tz)) - dayIndex(zonedDate(now, tz));
  const weekday = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    timeZone: tz,
    weekday: "long",
  }).format(kickoff);
  const fullDate = new Intl.DateTimeFormat(
    locale === "tr" ? "tr-TR" : "en-GB",
    {
      timeZone: tz,
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(kickoff);
  const shortDate = new Intl.DateTimeFormat(
    locale === "tr" ? "tr-TR" : "en-GB",
    {
      timeZone: tz,
      day: "numeric",
      month: "short",
    }
  ).format(kickoff);
  const clock = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(kickoff);
  let relative = "";
  if (locale === "tr") {
    if (delta === 0) {
      relative = "bugün";
    } else if (delta === 1) {
      relative = "yarın";
    } else if (delta === -1) {
      relative = "dün";
    } else if (delta > 1) {
      relative = `${delta} gün sonra`;
    } else {
      relative = `${Math.abs(delta)} gün önce`;
    }
  } else if (delta === 0) {
    relative = "today";
  } else if (delta === 1) {
    relative = "tomorrow";
  } else if (delta === -1) {
    relative = "yesterday";
  } else if (delta > 1) {
    relative = `in ${delta} days`;
  } else {
    relative = `${Math.abs(delta)} days ago`;
  }
  return {
    relative: `${weekday} · ${relative}`,
    clock,
    fullDate,
    shortDate,
  };
}

export function textLocale(text: string): "en" | "tr" {
  if (/[çğıöşüÇĞİÖŞÜıİ]/.test(text)) {
    return "tr";
  }
  if (
    /(?<![\p{L}])(?:maci|macı|maç|sıradaki|siradaki|bir sonraki|ne zaman|karşı|karsi|fikstür|fikstur|sonuç|sonuc|skor)(?![\p{L}])/iu.test(
      text
    )
  ) {
    return "tr";
  }
  return "en";
}
