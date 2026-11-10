"use client";

import { GlobeIcon } from "lucide-react";
import { getCopy } from "@/lib/ui-copy";
import {
  boundedJson,
  type WebSearchView,
  webSearchView,
} from "@/lib/web-search-sources";

const copy = getCopy();

type WebSearchPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | string;

/** Compact "Searched the web" row for the provider-executed webSearch tool. */
export function WebSearchCard({
  state,
  output,
}: {
  state: WebSearchPartState;
  output: unknown;
}) {
  const loading = state === "input-streaming" || state === "input-available";
  const view: WebSearchView | null =
    state === "output-available" ? webSearchView(output) : null;
  const failed = state === "output-error" || view?.kind === "error";

  return (
    <div
      className="w-[min(100%,450px)] rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm"
      data-testid="web-search-card"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <GlobeIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="font-medium text-foreground">
          {loading ? copy.searchingWeb : copy.searchedWeb}
        </span>
      </div>
      {failed && (
        <p className="mt-1 text-muted-foreground" role="alert">
          {copy.searchFailed}
        </p>
      )}
      {view?.kind === "empty" && (
        <p className="mt-1 text-muted-foreground">{copy.searchNoResults}</p>
      )}
      {view?.kind === "results" && (
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
