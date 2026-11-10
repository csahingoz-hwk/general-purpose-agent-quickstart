"use client";

import { useEffect, useState } from "react";
import {
  type FixtureMatch,
  type FixturePayload,
  labelKickoff,
} from "@/lib/fixtures";
import { Crest } from "./fixture-crest";

const copy = {
  en: {
    noUpcoming: "No upcoming fixture",
    comingUp: "Next fixtures",
    last: "Last result",
    details: "Open details",
    close: "Close",
    versus: "versus",
  },
  tr: {
    noUpcoming: "Yaklaşan maç yok",
    comingUp: "Sıradaki maçlar",
    last: "Son sonuç",
    details: "Ayrıntıları aç",
    close: "Kapat",
    versus: "karşı",
  },
} as const;

function scoreLine(match: FixtureMatch): string | null {
  if (match.homeScore === null || match.awayScore === null) {
    return null;
  }
  return `${match.homeScore}–${match.awayScore}`;
}

function FixtureBody({
  payload,
  locale,
}: {
  payload: FixturePayload;
  locale: "en" | "tr";
}) {
  const text = copy[locale];
  const next = payload.upcoming[0];
  const label = next
    ? labelKickoff(next.kickoffUtc, payload.now, locale)
    : null;
  return (
    <div className="space-y-3">
      {next && label ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Crest name={next.home.name} src={next.home.badge} />
            <p className="text-center font-semibold text-[15px] text-[var(--bot-accent)] leading-tight">
              {text.versus}
            </p>
            <Crest name={next.away.name} src={next.away.badge} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-[13px] leading-tight">
            <p className="font-medium">{next.home.name}</p>
            <p className="font-medium">{next.away.name}</p>
          </div>
          {next.competition && (
            <p className="text-[13px] text-muted-foreground">
              {next.competition}
            </p>
          )}
          <p className="font-medium text-[15px] text-[var(--bot-accent)] leading-snug">
            {label.relative}
          </p>
          <p className="text-[15px] leading-snug">
            {label.fullDate} · {label.clock}
          </p>
          {next.venue && (
            <p className="text-[13px] text-muted-foreground">{next.venue}</p>
          )}
        </div>
      ) : (
        <p className="font-medium text-[15px]">{text.noUpcoming}</p>
      )}
      {payload.upcoming.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium text-[13px] text-muted-foreground">
            {text.comingUp}
          </h3>
          <div className="space-y-1">
            {payload.upcoming.map((match) => (
              <CompactRow
                key={match.id}
                locale={locale}
                match={match}
                now={payload.now}
              />
            ))}
          </div>
        </div>
      )}
      {payload.last && (
        <div className="space-y-1">
          <h3 className="font-medium text-[13px] text-muted-foreground">
            {text.last}
          </h3>
          <CompactRow
            locale={locale}
            match={payload.last}
            now={payload.now}
            score={scoreLine(payload.last)}
          />
        </div>
      )}
    </div>
  );
}

function CompactRow({
  match,
  now,
  locale,
  score,
}: {
  match: FixtureMatch;
  now: string;
  locale: "en" | "tr";
  score?: string | null;
}) {
  const label = labelKickoff(match.kickoffUtc, now, locale);
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 text-[13px] leading-tight">
      <span className="min-w-0 truncate">
        {label?.shortDate} · {match.home.name} – {match.away.name}
      </span>
      {score ? <span className="shrink-0 tabular-nums">{score}</span> : null}
    </div>
  );
}

export function FixtureCard({
  payload,
  locale,
}: {
  payload: FixturePayload;
  locale: "en" | "tr";
}) {
  const [details, setDetails] = useState(false);
  const text = copy[locale];
  useEffect(() => {
    if (!details) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetails(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [details]);
  const title = payload.upcoming[0]
    ? `${payload.upcoming[0].home.name} ${text.versus} ${payload.upcoming[0].away.name}`
    : payload.team.name;
  return (
    <section
      aria-label={title}
      className="h-fit w-full max-w-[40rem] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 text-foreground shadow-[var(--shadow-card)]"
      data-testid="fixture-card"
    >
      <FixtureBody locale={locale} payload={payload} />
      <button
        className="mt-3 min-h-11 rounded-full border border-[color:var(--hairline)] px-4 text-sm"
        data-testid="fixture-open-details"
        onClick={() => setDetails(true)}
        type="button"
      >
        {text.details}
      </button>
      {details && (
        <div
          aria-label={title}
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
          data-testid="fixture-details"
          role="dialog"
        >
          <button
            className="mb-4 min-h-11 rounded-full border border-[color:var(--hairline)] px-4 text-sm"
            onClick={() => setDetails(false)}
            type="button"
          >
            {text.close}
          </button>
          <div className="mx-auto max-w-[40rem] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4">
            <FixtureBody locale={locale} payload={payload} />
          </div>
        </div>
      )}
    </section>
  );
}
