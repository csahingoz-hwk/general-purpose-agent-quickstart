import { tool } from "ai";
import { z } from "zod";
import {
  type FirecrawlNotConnectedResult,
  runFirecrawlCrawlOrMap,
  runFirecrawlScrape,
  runFirecrawlSearch,
} from "@/lib/connectors/firecrawl";

function formatFirecrawlModelOutput<T extends { status: string }>(output: T) {
  if (output.status === "setup_required") {
    const setupOut = output as unknown as FirecrawlNotConnectedResult;
    return {
      type: "json" as const,
      value: {
        status: "setup_required",
        connected: false,
        connectProvider: "firecrawl",
        setupHref: setupOut.setupHref,
        externalKeyUrl: setupOut.externalKeyUrl,
        messageEn: setupOut.message,
        messageTr: setupOut.messageTr,
        replyInstruction:
          "Firecrawl is not connected because FIRECRAWL_API_KEY is not configured yet. Reply clearly in the user's language in 1-2 plain sentences: in Turkish start with 'Firecrawl bağlı değil', explain simply that FIRECRAWL_API_KEY henüz eklenmemiş, and point to the Setup page Connect step (/setup#setup-firecrawl); in English say 'Firecrawl is not connected', explain why in plain words, and point to Setup -> Connect (/setup#setup-firecrawl).",
      },
    };
  }
  return {
    type: "json" as const,
    value: output,
  };
}

export function createFirecrawlTools(opts?: {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const firecrawlSearch = tool({
    description:
      "Search the live web with Firecrawl and return clean Markdown excerpts, publication dates, and source URLs. Use for open-ended discovery, current news, or comparing multiple sources before scraping specific URLs.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(240),
      limit: z.number().int().min(1).max(10).optional(),
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
        limit: limit ?? 5,
        tbs,
        apiKey: opts?.apiKey,
        fetchImpl: opts?.fetchImpl,
      }),
    toModelOutput: ({ output }) => formatFirecrawlModelOutput(output),
  });

  const firecrawlScrape = tool({
    description:
      "Scrape a single public web URL into clean Markdown with title and publication date via Firecrawl. Use when you already have a specific article, documentation, or pricing page URL.",
    inputSchema: z.object({
      url: z.string().trim().min(8).max(1024),
      onlyMainContent: z.boolean().optional(),
    }),
    execute: ({ url, onlyMainContent }) =>
      runFirecrawlScrape({
        url,
        onlyMainContent: onlyMainContent ?? true,
        apiKey: opts?.apiKey,
        fetchImpl: opts?.fetchImpl,
      }),
    toModelOutput: ({ output }) => formatFirecrawlModelOutput(output),
  });

  const firecrawlCrawlMap = tool({
    description:
      "Map a website's URLs ('map' mode, fast) or crawl up to 8 pages into clean Markdown ('crawl' mode) via Firecrawl. Prefer 'map' first to discover relevant subpages, then 'firecrawlScrape' on the best 1-3 URLs.",
    inputSchema: z.object({
      url: z.string().trim().min(8).max(1024),
      mode: z.enum(["map", "crawl"]).optional(),
      limit: z.number().int().min(1).max(30).optional(),
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
        mode: mode ?? "map",
        limit: limit ?? 15,
        search,
        apiKey: opts?.apiKey,
        fetchImpl: opts?.fetchImpl,
      }),
    toModelOutput: ({ output }) => formatFirecrawlModelOutput(output),
  });

  return {
    firecrawlSearch,
    firecrawlScrape,
    firecrawlCrawlMap,
  };
}
