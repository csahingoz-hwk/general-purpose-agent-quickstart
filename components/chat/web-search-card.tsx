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

const copy = getCopy();

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
  const loading = state === "input-streaming" || state === "input-available";
  const view: WebSearchView | null =
    state === "output-available" ? webSearchView(output) : null;
  const failed = state === "output-error" || view?.kind === "error";
  const sources = view?.kind === "results" ? view.sources : [];
  const marks = sources.flatMap((source) =>
    source.hostname ? [source.hostname] : []
  );

  return (
    <div
      className="w-[min(100%,450px)] rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm"
      data-testid="web-search-card"
    >
      {sources.length > 0 ? (
        <button
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-2 text-left"
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
      ) : (
        <div className="flex min-h-11 items-center gap-2 text-muted-foreground">
          <GlobeIcon aria-hidden="true" className="size-4 shrink-0" />
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
