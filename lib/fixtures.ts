import { z } from "zod";

/** The owner's clock. Next-match answers are judged against this zone. */
export const OWNER_TIME_ZONE = "Europe/London" as const;

export type FixtureSide = {
  name: string;
  badge: string | null;
};

export type FixtureMatch = {
  id: string;
  competition: string;
  venue: string;
  kickoffUtc: string;
  home: FixtureSide;
  away: FixtureSide;
  homeScore: number | null;
  awayScore: number | null;
};

export type FixturePayload = {
  team: FixtureSide & { id: string };
  timeZone: typeof OWNER_TIME_ZONE;
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
  home: sideSchema,
  away: sideSchema,
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
});

const payloadSchema = z.object({
  team: sideSchema.extend({ id: z.string().min(1).max(20) }),
  timeZone: z.literal(OWNER_TIME_ZONE),
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

type LondonDate = { year: number; month: number; day: number };

function londonDate(date: Date): LondonDate {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: OWNER_TIME_ZONE,
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

function dayIndex(date: LondonDate): number {
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
  locale: "en" | "tr"
): KickoffLabel | null {
  const kickoff = new Date(kickoffUtc);
  const now = new Date(nowIso);
  if (Number.isNaN(kickoff.getTime()) || Number.isNaN(now.getTime())) {
    return null;
  }
  const delta = dayIndex(londonDate(kickoff)) - dayIndex(londonDate(now));
  const weekday = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    timeZone: OWNER_TIME_ZONE,
    weekday: "long",
  }).format(kickoff);
  const fullDate = new Intl.DateTimeFormat(
    locale === "tr" ? "tr-TR" : "en-GB",
    {
      timeZone: OWNER_TIME_ZONE,
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(kickoff);
  const shortDate = new Intl.DateTimeFormat(
    locale === "tr" ? "tr-TR" : "en-GB",
    {
      timeZone: OWNER_TIME_ZONE,
      day: "numeric",
      month: "short",
    }
  ).format(kickoff);
  const clock = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    timeZone: OWNER_TIME_ZONE,
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
