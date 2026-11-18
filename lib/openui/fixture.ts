/**
 * Fixture cards are copied from text the answer and a source snippet both
 * state. Missing kickoff details stay "TBC".
 */

export const FIXTURE_UNKNOWN = "TBC";

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

type FoundDate = {
  iso: string;
  display: string;
  index: number;
  end: number;
};

type Matchup = {
  team: string;
  opponent: string;
  index: number;
};

const CLUB =
  "[\\p{Lu}][\\p{L}\\p{M}.'’-]{1,30}(?:\\s+[\\p{Lu}][\\p{L}\\p{M}.'’-]{1,30}){0,2}";
const TAIL = "(?![\\p{L}\\p{M}])";
const HEAD = "(?<![\\p{L}\\p{M}])";
const CLUB_PATTERN = new RegExp(`${HEAD}(${CLUB})${TAIL}`, "gu");
const VS_PATTERN = new RegExp(
  `${HEAD}(${CLUB})\\s+(?:vs\\.?|VS\\.?|versus|Versus)\\s+(${CLUB})${TAIL}`,
  "gu"
);
const DASH_PATTERN = new RegExp(
  `${HEAD}(${CLUB})\\s+[-–—]\\s+(${CLUB})${TAIL}`,
  "gu"
);
const ILE_PATTERN = new RegExp(
  `${HEAD}(${CLUB})${TAIL}[^\\n]{0,90}?${HEAD}(${CLUB})\\s+ile\\b`,
  "gu"
);
const AGAINST_PATTERN = new RegExp(
  `${HEAD}(?:against|Against|rakibi|Rakibi)\\s+(${CLUB})${TAIL}`,
  "gu"
);
const MONTH_PATTERN = new RegExp(
  `${HEAD}(\\d{1,2})\\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\\s+(\\d{4})${TAIL}`,
  "giu"
);
const MONTH_FIRST_PATTERN = new RegExp(
  `${HEAD}(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\s+(\\d{1,2}),?\\s+(\\d{4})${TAIL}`,
  "giu"
);
const ISO_DATE_PATTERN = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const NUMERIC_DATE_PATTERN = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/g;
const CLOCK_PATTERN = /(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/g;
const MERIDIEM_PATTERN = /(?<!\d)(1[0-2]|0?[1-9])\s*(am|pm)\b/gi;
const VENUE_PATTERN = new RegExp(
  `${HEAD}((?:[\\p{Lu}][\\p{L}\\p{M}\\d.'’-]{1,24}\\s+){1,4}(?:Park|Stadium|Arena|Stadyumu|Stadı|Stad))${TAIL}`,
  "gu"
);

const MONTHS = new Map<string, number>([
  ["january", 1],
  ["jan", 1],
  ["ocak", 1],
  ["february", 2],
  ["feb", 2],
  ["subat", 2],
  ["march", 3],
  ["mar", 3],
  ["mart", 3],
  ["april", 4],
  ["apr", 4],
  ["nisan", 4],
  ["may", 5],
  ["mayis", 5],
  ["june", 6],
  ["jun", 6],
  ["haziran", 6],
  ["july", 7],
  ["jul", 7],
  ["temmuz", 7],
  ["august", 8],
  ["aug", 8],
  ["agustos", 8],
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["eylul", 9],
  ["october", 10],
  ["oct", 10],
  ["ekim", 10],
  ["november", 11],
  ["nov", 11],
  ["kasim", 11],
  ["december", 12],
  ["dec", 12],
  ["aralik", 12],
]);

const WEEKDAYS = new Set([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "pazar",
  "pazartesi",
  "sali",
  "carsamba",
  "persembe",
  "cuma",
  "cumartesi",
]);

const VENUE_WORDS = new Set([
  "park",
  "stadium",
  "arena",
  "stadyumu",
  "stadi",
  "stad",
]);

const SOFT_STOP = new Set([
  "the",
  "and",
  "for",
  "next",
  "match",
  "game",
  "fixture",
  "fixtures",
  "mac",
  "versus",
  "ile",
  "saat",
  "gunu",
  "gun",
  "bugun",
  "yarin",
  "today",
  "tomorrow",
  "tonight",
  "super",
  "lig",
  "league",
  "uefa",
]);

const COMPETITIONS: { label: string; keys: string[] }[] = [
  {
    label: "Trendyol Süper Lig",
    keys: ["trendyol super lig"],
  },
  { label: "Süper Lig", keys: ["super lig"] },
  { label: "Champions League", keys: ["champions league", "sampiyonlar ligi"] },
  { label: "Europa League", keys: ["europa league", "avrupa ligi"] },
  { label: "Conference League", keys: ["conference league"] },
  { label: "Premier League", keys: ["premier league"] },
  { label: "La Liga", keys: ["la liga", "laliga"] },
  { label: "Serie A", keys: ["serie a"] },
  { label: "Bundesliga", keys: ["bundesliga"] },
  { label: "Ligue 1", keys: ["ligue 1"] },
  {
    label: "Ziraat Türkiye Kupası",
    keys: ["ziraat turkiye kupasi"],
  },
  { label: "Türkiye Kupası", keys: ["turkiye kupasi", "turkish cup"] },
];

function fold(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bareName(value: string): string {
  return value
    .replace(/['’][\p{L}]{1,3}$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isClubName(raw: string): boolean {
  const name = bareName(raw);
  if (name.length < 3 || name.length > 40) {
    return false;
  }
  const tokens = name.split(" ");
  if (tokens.length > 3 || tokens.some((token) => token.length < 2)) {
    return false;
  }
  const folded = tokens.map((token) => fold(token));
  if (folded.some((token) => WEEKDAYS.has(token) || VENUE_WORDS.has(token))) {
    return false;
  }
  if (folded.some((token) => MONTHS.has(token))) {
    return false;
  }
  return folded.some((token) => !SOFT_STOP.has(token));
}

function clock(hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dateParts(
  year: number,
  month: number,
  day: number,
  display: string,
  index: number,
  end: number
): FoundDate | null {
  if (year < 2024 || year > 2035) {
    return null;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { iso, display: display.replace(/\s+/g, " ").trim(), index, end };
}

function pushDate(dates: FoundDate[], next: FoundDate | null) {
  if (!next) {
    return;
  }
  if (
    dates.some((date) => date.iso === next.iso && date.index === next.index)
  ) {
    return;
  }
  dates.push(next);
}

export function findDates(text: string): FoundDate[] {
  const dates: FoundDate[] = [];
  for (const match of text.matchAll(MONTH_PATTERN)) {
    const day = Number(match[1]);
    const month = MONTHS.get(fold(match[2] ?? ""));
    const year = Number(match[3]);
    if (!month || match.index === undefined) {
      continue;
    }
    pushDate(
      dates,
      dateParts(
        year,
        month,
        day,
        match[0],
        match.index,
        match.index + match[0].length
      )
    );
  }
  for (const match of text.matchAll(MONTH_FIRST_PATTERN)) {
    const month = MONTHS.get(fold(match[1] ?? ""));
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (!month || match.index === undefined) {
      continue;
    }
    pushDate(
      dates,
      dateParts(
        year,
        month,
        day,
        match[0],
        match.index,
        match.index + match[0].length
      )
    );
  }
  for (const match of text.matchAll(ISO_DATE_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    pushDate(
      dates,
      dateParts(
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[0],
        match.index,
        match.index + match[0].length
      )
    );
  }
  for (const match of text.matchAll(NUMERIC_DATE_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    let day = first;
    let month = second;
    if (first <= 12 && second > 12) {
      day = second;
      month = first;
    }
    pushDate(
      dates,
      dateParts(
        year,
        month,
        day,
        match[0],
        match.index,
        match.index + match[0].length
      )
    );
  }
  return dates;
}

function findTimes(text: string, dates: FoundDate[]): string[] {
  const clocks: string[] = [];
  const remember = (value: string | null) => {
    if (value && !clocks.includes(value)) {
      clocks.push(value);
    }
  };
  const insideDate = (index: number) =>
    dates.some((date) => index >= date.index && index < date.end);
  for (const match of text.matchAll(CLOCK_PATTERN)) {
    if (match.index === undefined || insideDate(match.index)) {
      continue;
    }
    remember(clock(Number(match[1]), Number(match[2])));
  }
  for (const match of text.matchAll(MERIDIEM_PATTERN)) {
    if (match.index === undefined || insideDate(match.index)) {
      continue;
    }
    let hour = Number(match[1]);
    const meridiem = (match[2] ?? "").toLowerCase();
    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }
    remember(clock(hour, 0));
  }
  return clocks;
}

function addMatchup(
  matchups: Matchup[],
  team: string,
  opponent: string,
  index: number
) {
  const home = bareName(team);
  const away = bareName(opponent);
  if (!isClubName(away) || fold(home) === fold(away)) {
    return;
  }
  const knownTeam = isClubName(home) ? home : FIXTURE_UNKNOWN;
  if (
    matchups.some(
      (item) =>
        fold(item.team) === fold(knownTeam) &&
        fold(item.opponent) === fold(away)
    )
  ) {
    return;
  }
  matchups.push({ team: knownTeam, opponent: away, index });
}

function findMatchups(text: string): Matchup[] {
  const matchups: Matchup[] = [];
  for (const pattern of [VS_PATTERN, DASH_PATTERN, ILE_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || !match[1] || !match[2]) {
        continue;
      }
      addMatchup(matchups, match[1], match[2], match.index);
    }
  }
  for (const match of text.matchAll(AGAINST_PATTERN)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const previous = [...before.matchAll(CLUB_PATTERN)].at(-1);
    addMatchup(matchups, previous?.[1] ?? "", match[1], match.index);
  }
  return matchups;
}

function sharedClock(answer: string, source: string): string {
  const answerTimes = findTimes(answer, findDates(answer));
  const sourceTimes = new Set(findTimes(source, findDates(source)));
  return answerTimes.find((time) => sourceTimes.has(time)) ?? FIXTURE_UNKNOWN;
}

function sharedCompetition(answer: string, source: string): string {
  const left = fold(answer);
  const right = fold(source);
  for (const competition of COMPETITIONS) {
    if (
      competition.keys.some((key) => left.includes(key) && right.includes(key))
    ) {
      return competition.label;
    }
  }
  return FIXTURE_UNKNOWN;
}

function venuePhrases(text: string): string[] {
  const phrases: string[] = [];
  for (const match of text.matchAll(VENUE_PATTERN)) {
    const phrase = match[1]?.replace(/\s+/g, " ").trim();
    if (phrase && !phrases.some((item) => fold(item) === fold(phrase))) {
      phrases.push(phrase);
    }
  }
  return phrases;
}

function sharedVenue(answer: string, source: string): string {
  const wanted = new Set(venuePhrases(answer).map((phrase) => fold(phrase)));
  return (
    venuePhrases(source).find((phrase) => wanted.has(fold(phrase))) ??
    FIXTURE_UNKNOWN
  );
}

function nearestDate(index: number, dates: FoundDate[]): FoundDate | null {
  let best: FoundDate | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const date of dates) {
    const gap = Math.abs(date.index - index);
    if (gap < distance) {
      best = date;
      distance = gap;
    }
  }
  return best;
}

export function fixtureRows(fields: {
  team: string;
  opponent: string;
  date: string;
  time: string;
  competition: string;
  venue: string;
  source: string;
}): string[][] {
  const match =
    fields.team === FIXTURE_UNKNOWN
      ? `${FIXTURE_UNKNOWN} vs ${fields.opponent}`
      : `${fields.team} vs ${fields.opponent}`;
  return [
    ["Match", match],
    ["Date", fields.date || FIXTURE_UNKNOWN],
    ["Time", fields.time || FIXTURE_UNKNOWN],
    ["Competition", fields.competition || FIXTURE_UNKNOWN],
    ["Venue", fields.venue || FIXTURE_UNKNOWN],
    ["Source", fields.source || FIXTURE_UNKNOWN],
  ];
}

function confirmingHit(
  hits: SearchHit[],
  matchup: Matchup,
  iso: string
): SearchHit | null {
  for (const hit of hits) {
    const blob = `${hit.title}\n${hit.snippet}`;
    const folded = fold(blob);
    if (!folded.includes(fold(matchup.opponent))) {
      continue;
    }
    if (
      matchup.team !== FIXTURE_UNKNOWN &&
      !folded.includes(fold(matchup.team))
    ) {
      continue;
    }
    if (!findDates(blob).some((date) => date.iso === iso)) {
      continue;
    }
    return hit;
  }
  return null;
}

export function extractFixture(
  answer: string,
  hits: SearchHit[]
): string[][] | null {
  const prose = answer.replace(/```[\s\S]*?```/g, " ");
  const dates = findDates(prose);
  if (dates.length === 0) {
    return null;
  }
  for (const matchup of findMatchups(prose)) {
    const date = nearestDate(matchup.index, dates);
    if (!date) {
      continue;
    }
    const hit = confirmingHit(hits, matchup, date.iso);
    if (!hit) {
      continue;
    }
    const sourceText = `${hit.title}\n${hit.snippet}`;
    const cited =
      findDates(sourceText).find((item) => item.iso === date.iso) ?? date;
    return fixtureRows({
      team: matchup.team,
      opponent: matchup.opponent,
      date: cited.display,
      time: sharedClock(prose, sourceText),
      competition: sharedCompetition(prose, sourceText),
      venue: sharedVenue(prose, sourceText),
      source: hit.url,
    });
  }
  return null;
}

export function fixtureFromStructured(input: {
  team?: string;
  opponent?: string;
  when?: string;
  time?: string;
  competition?: string;
  venue?: string;
  source?: string;
}): string[][] | null {
  const opponent = bareName(input.opponent ?? "");
  if (!isClubName(opponent)) {
    return null;
  }
  const parsed = findDates(input.when ?? "");
  const date = parsed[0];
  if (!date) {
    return null;
  }
  const explicit = findTimes(input.time ?? "", []);
  const implied = findTimes(input.when ?? "", parsed);
  const team = bareName(input.team ?? "");
  return fixtureRows({
    team: isClubName(team) ? team : FIXTURE_UNKNOWN,
    opponent,
    date: date.display,
    time: explicit[0] ?? implied[0] ?? FIXTURE_UNKNOWN,
    competition: input.competition?.trim() || FIXTURE_UNKNOWN,
    venue: input.venue?.trim() || FIXTURE_UNKNOWN,
    source: input.source?.trim() || FIXTURE_UNKNOWN,
  });
}
