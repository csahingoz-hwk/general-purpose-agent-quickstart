import { tool } from "ai";
import { z } from "zod";
import {
  runFirecrawlCrawlOrMap,
  runFirecrawlScrape,
  runFirecrawlSearch,
} from "@/lib/connectors/firecrawl";

export function createFirecrawlTools(opts?: {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const firecrawlSearch = tool({
    description:
      "Search the live web with Firecrawl and return clean Markdown excerpts, publication dates, and source URLs. Use for open-ended discovery, current news, or comparing multiple sources before scraping specific URLs.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(240),
      limit: z.number().int().min(1).max(10).default(5).optional(),
      tbs: z
        .string()
        .trim()
        .max(40)
        .optional()
        .describe(
          "Optional recency filter such as 'qdr:d' (past day), 'qdr:w' (past week), or 'qdr:m' (past month)."
        ),
    }),
    execute: ({ query, limit, tbs }) =>
      runFirecrawlSearch({
        query,
        limit,
        tbs,
        apiKey: opts?.apiKey,
        fetchImpl: opts?.fetchImpl,
      }),
  });

  const firecrawlScrape = tool({
    description:
      "Scrape a single public web URL into clean Markdown with title and publication date via Firecrawl. Use when you already have a specific article, documentation, or pricing page URL.",
    inputSchema: z.object({
      url: z.string().trim().min(8).max(1024),
      onlyMainContent: z.boolean().default(true).optional(),
    }),
    execute: ({ url, onlyMainContent }) =>
      runFirecrawlScrape({
        url,
        onlyMainContent,
        apiKey: opts?.apiKey,
        fetchImpl: opts?.fetchImpl,
      }),
  });

  const firecrawlCrawlMap = tool({
    description:
      "Map a website's URLs ('map' mode, fast) or crawl up to 8 pages into clean Markdown ('crawl' mode) via Firecrawl. Prefer 'map' first to discover relevant subpages, then 'firecrawlScrape' on the best 1-3 URLs.",
    inputSchema: z.object({
      url: z.string().trim().min(8).max(1024),
      mode: z.enum(["map", "crawl"]).default("map").optional(),
      limit: z.number().int().min(1).max(30).default(15).optional(),
      search: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe("Optional topic filter for 'map' mode."),
    }),
    execute: ({ url, mode, limit, search }) =>
      runFirecrawlCrawlOrMap({
        url,
        mode,
        limit,
        search,
        apiKey: opts?.apiKey,
        fetchImpl: opts?.fetchImpl,
      }),
  });

  return {
    firecrawlSearch,
    firecrawlScrape,
    firecrawlCrawlMap,
  };
}
