"use client";

import { GlobeIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { getCopy } from "@/lib/ui-copy";
import {
  boundedJson,
  type WebSearchView,
  webSearchView,
} from "@/lib/web-search-sources";

function sourceCount(count: number, locale: "en" | "tr"): string {
  if (locale === "tr") {
    return count === 1 ? "1 kaynak" : `${count} kaynak`;
  }
  return count === 1 ? "1 source" : `${count} sources`;
}

type WebSearchPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | string;

/** Compact "Searched the web" row for the provider-executed webSearch tool. */
function SourceMark({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  return (
    <Image
      alt=""
      className="size-4 rounded-sm"
      height={16}
      onError={() => setFailed(true)}
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      unoptimized
      width={16}
    />
  );
}

export function WebSearchCard({
  state,
  output,
  locale = "en",
}: {
  state: WebSearchPartState;
  output: unknown;
  locale?: "en" | "tr";
}) {
  const [open, setOpen] = useState(false);
  if (
    output &&
    typeof output === "object" &&
    "skippedForSynthesis" in output &&
    (output as { skippedForSynthesis?: boolean }).skippedForSynthesis === true
  ) {
    return null;
  }
  const copy = getCopy(locale);
  const loading = state === "input-streaming" || state === "input-available";
  const view: WebSearchView | null =
    state === "output-available" ? webSearchView(output) : null;
  const failed = state === "output-error" || view?.kind === "error";
  const sources = view?.kind === "results" ? view.sources : [];
  const marks = Array.from(
    new Set(
      sources.flatMap((source) => (source.hostname ? [source.hostname] : []))
    )
  ).slice(0, 4);

  return (
    <div
      className="w-[min(100%,450px)] max-w-full overflow-hidden rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm"
      data-testid="web-search-card"
    >
      {sources.length > 0 ? (
        <>
          <button
            aria-expanded={open}
            className="flex min-h-10 w-full items-center gap-2 text-left"
            data-testid="web-search-toggle"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <GlobeIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="font-medium text-foreground">
              {sourceCount(sources.length, locale)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              {marks.map((host) => (
                <SourceMark host={host} key={host} />
              ))}
            </span>
          </button>
          {!open && (
            <div
              className="mt-1.5 flex max-w-full snap-x gap-2 overflow-x-auto pb-1"
              data-testid="web-search-source-cards"
            >
              {sources.map((source, index) => {
                const cardBody = (
                  <>
                    <div className="flex items-center gap-1.5">
                      {source.hostname && <SourceMark host={source.hostname} />}
                      <span className="truncate font-medium text-[11px] text-muted-foreground">
                        {source.hostname ?? copy.searchSources}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 font-medium text-[12.5px] text-foreground leading-snug">
                      {source.title}
                    </p>
                  </>
                );
                const key = `${source.url ?? source.title}-${index}`;
                return source.url ? (
                  <a
                    className="w-40 shrink-0 snap-start rounded-lg border border-border/70 bg-background/85 p-2 transition-colors hover:bg-background"
                    href={source.url}
                    key={key}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {cardBody}
                  </a>
                ) : (
                  <div
                    className="w-40 shrink-0 snap-start rounded-lg border border-border/70 bg-background/85 p-2"
                    key={key}
                  >
                    {cardBody}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-11 items-center gap-2 text-muted-foreground">
          <GlobeIcon
            aria-hidden="true"
            className={`size-4 shrink-0 ${loading ? "animate-spin" : ""}`}
          />
          <span className="font-medium text-foreground">
            {loading ? copy.searchingWeb : copy.searchedWeb}
          </span>
        </div>
      )}
      {failed && (
        <p className="mt-1 text-muted-foreground" role="alert">
          {copy.searchFailed}
        </p>
      )}
      {view?.kind === "empty" && (
        <p className="mt-1 text-muted-foreground">{copy.searchNoResults}</p>
      )}
      {open && view?.kind === "results" && (
        <ul
          aria-label={copy.searchSources}
          className="mt-1.5 flex flex-col gap-1.5"
        >
          {view.sources.map((source, index) => (
            <li
              className="min-w-0"
              key={`${source.url ?? source.title}-${index}`}
            >
              {source.url ? (
                <a
                  className="block truncate text-foreground underline underline-offset-2"
                  href={source.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {source.title}
                </a>
              ) : (
                <span className="block truncate text-foreground">
                  {source.title}
                </span>
              )}
              {source.hostname && (
                <span className="block truncate text-muted-foreground text-xs">
                  {source.hostname}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {view?.kind === "unknown" && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
          {boundedJson(output)}
        </pre>
      )}
    </div>
  );
}
