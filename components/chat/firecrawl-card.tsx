"use client";

import { ExternalLinkIcon, FlameIcon, GlobeIcon } from "lucide-react";

export function FirecrawlCard({
  toolName,
  output,
  locale = "en",
}: {
  toolName: string;
  output: Record<string, unknown>;
  locale?: "en" | "tr";
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const status = String(output.status ?? "ok");
  const isTr = locale === "tr";

  if (status === "setup_required") {
    const setupHref =
      typeof output.setupHref === "string"
        ? output.setupHref
        : "/setup#setup-firecrawl";
    const externalKeyUrl =
      typeof output.externalKeyUrl === "string"
        ? output.externalKeyUrl
        : "https://www.firecrawl.dev/app/api-keys";

    return (
      <div
        className="flex w-[min(100%,460px)] flex-col items-start justify-between gap-3 rounded-2xl border border-[color:var(--hairline)] bg-card px-4 py-3.5 text-sm shadow-2xs"
        data-provider="firecrawl"
        data-testid="firecrawl-setup-card"
      >
        <div className="flex w-full min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1.5 size-2.5 shrink-0 rounded-full bg-amber-500"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {isTr
                ? "Firecrawl henüz bağlı değil"
                : "Firecrawl isn't connected yet"}
            </p>
            <p className="mt-0.5 break-words text-muted-foreground text-xs leading-relaxed">
              {isTr
                ? "Sunucu taraflı web arama, sayfa kazıma (scrape) ve site haritası için Vercel ortam değişkenlerine FIRECRAWL_API_KEY ekleyin."
                : "Add FIRECRAWL_API_KEY in your Vercel environment variables to enable server-side Firecrawl search, URL-to-Markdown scrape, and site mapping."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-5">
          <a
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
            data-testid="firecrawl-open-setup"
            href={`${basePath}${setupHref}`}
          >
            <span>
              {isTr ? "Kurulum listesini aç" : "Open Setup checklist"}
            </span>
          </a>
          <a
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs transition-colors hover:bg-muted"
            data-testid="firecrawl-create-key"
            href={externalKeyUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>
              {isTr ? "Firecrawl anahtarı oluştur" : "Create Firecrawl API key"}
            </span>
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
      </div>
    );
  }

  if (status !== "ok") {
    const errMessage =
      typeof output.message === "string"
        ? output.message
        : isTr
          ? "Firecrawl isteği tamamlanamadı."
          : "Firecrawl request could not finish.";
    return (
      <div
        className="w-[min(100%,460px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
        data-testid="firecrawl-error-card"
      >
        <p className="text-muted-foreground text-xs">{errMessage}</p>
      </div>
    );
  }

  const results = Array.isArray(output.results)
    ? (output.results as Array<{
        title?: string;
        url?: string;
        publishedDate?: string | null;
      }>)
    : Array.isArray(output.pages)
      ? (output.pages as Array<{
          title?: string;
          url?: string;
          publishedDate?: string | null;
        }>)
      : typeof output.url === "string" && toolName === "firecrawlScrape"
        ? [
            {
              title: String(output.title ?? output.url),
              url: String(output.url),
              publishedDate:
                typeof output.publishedDate === "string"
                  ? output.publishedDate
                  : null,
            },
          ]
        : [];
  const mappedLinks = Array.isArray(output.links)
    ? (output.links as string[])
    : [];

  return (
    <div
      className="w-[min(100%,460px)] space-y-2.5 rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
      data-testid="firecrawl-results-card"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <FlameIcon className="size-3.5 text-orange-500" />
          <span>
            {toolName === "firecrawlSearch"
              ? isTr
                ? "Firecrawl web araması"
                : "Firecrawl web search"
              : toolName === "firecrawlScrape"
                ? isTr
                  ? "Firecrawl sayfa okuma (Markdown)"
                  : "Firecrawl page scrape"
                : isTr
                  ? "Firecrawl site haritası / tarama"
                  : "Firecrawl site map / crawl"}
          </span>
        </div>
        {typeof output.fetchedAtIso === "string" ? (
          <span className="text-[11px] text-muted-foreground">
            {output.fetchedAtIso}
          </span>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul className="space-y-1.5">
          {results.slice(0, 6).map((item, idx) => (
            <li
              className="flex items-center justify-between gap-2 rounded-xl bg-muted/45 px-2.5 py-1.5 text-xs"
              key={`${item.url ?? idx}`}
            >
              <a
                className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium text-foreground hover:underline"
                href={item.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.title ?? item.url}</span>
              </a>
              {item.publishedDate ? (
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                  {item.publishedDate}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : mappedLinks.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {isTr
            ? `${mappedLinks.length} sayfa bağlantısı keşfedildi.`
            : `Discovered ${mappedLinks.length} site URLs.`}
        </p>
      ) : null}
    </div>
  );
}
