import { validateCloudBrowseUrl } from "@/lib/cloud-computer/client";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import {
  FIRECRAWL_KEY_CREATE_URL as UI_FIRECRAWL_KEY_CREATE_URL,
  VERCEL_ENV_VARS_URL as UI_VERCEL_ENV_VARS_URL,
} from "@/lib/ui-copy";

export const FIRECRAWL_API_BASE_URL = "https://api.firecrawl.dev/v1";
export const FIRECRAWL_KEY_CREATE_URL = UI_FIRECRAWL_KEY_CREATE_URL;
export const VERCEL_ENV_VARS_URL = UI_VERCEL_ENV_VARS_URL;
export const FIRECRAWL_SETUP_HREF = "/setup#setup-firecrawl";

export function getFirecrawlApiKey(override?: string | null): string | null {
  const key = (override ?? process.env.FIRECRAWL_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

export function isFirecrawlConfigured(override?: string | null): boolean {
  return Boolean(getFirecrawlApiKey(override));
}

export type FirecrawlNotConnectedResult = {
  status: "setup_required";
  connected: false;
  connectProvider: "firecrawl";
  setupHref: string;
  externalKeyUrl: string;
  vercelEnvVarsUrl: string;
  message: string;
  messageTr: string;
};

export function buildFirecrawlNotConnectedResult(): FirecrawlNotConnectedResult {
  return {
    status: "setup_required",
    connected: false,
    connectProvider: "firecrawl",
    setupHref: FIRECRAWL_SETUP_HREF,
    externalKeyUrl: FIRECRAWL_KEY_CREATE_URL,
    vercelEnvVarsUrl: VERCEL_ENV_VARS_URL,
    message: `Firecrawl is not connected because FIRECRAWL_API_KEY is not set in Vercel environment variables (there is no in-app API key input field). Connect in 2 steps: 1) Get a key at ${FIRECRAWL_KEY_CREATE_URL}. 2) Add FIRECRAWL_API_KEY at ${VERCEL_ENV_VARS_URL} and redeploy (also linked on ${FIRECRAWL_SETUP_HREF}).`,
    messageTr: `Firecrawl bağlı değil çünkü FIRECRAWL_API_KEY henüz Vercel ortam değişkenlerinde tanımlanmamış (uygulama içinde API anahtarı giriş alanı yoktur). 2 adımda bağlayın: 1) ${FIRECRAWL_KEY_CREATE_URL} üzerinden anahtar alın. 2) ${VERCEL_ENV_VARS_URL} sayfasında FIRECRAWL_API_KEY olarak ekleyip yeniden dağıtın (redeploy).`,
  };
}

function extractPublishedDateFromMetadata(
  metadata: Record<string, unknown> | undefined,
  markdown?: string
): string | null {
  if (metadata) {
    const candidateKeys = [
      "publishedTime",
      "ogPublishedTime",
      "article:published_time",
      "og:published_time",
      "datePublished",
      "dcDate",
      "modifiedTime",
      "article:modified_time",
    ];
    for (const key of candidateKeys) {
      const val = metadata[key];
      if (typeof val === "string" && val.trim()) {
        const isoMatch = val.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        return isoMatch ? isoMatch[1] : val.trim().slice(0, 32);
      }
    }
  }
  if (markdown) {
    const inlineIso = markdown.match(
      /\b(202[4-9]-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/
    );
    if (inlineIso?.[1]) {
      return inlineIso[1];
    }
  }
  return null;
}

export type FirecrawlSearchItem = {
  title: string;
  url: string;
  description: string;
  publishedDate: string | null;
  fencedMarkdown: string;
};

export type FirecrawlSearchResult =
  | FirecrawlNotConnectedResult
  | {
      status: "blocked_data_boundary" | "error";
      message: string;
    }
  | {
      status: "ok";
      query: string;
      fetchedAtIso: string;
      results: FirecrawlSearchItem[];
    };

export async function runFirecrawlSearch(opts: {
  query: string;
  limit?: number;
  tbs?: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<FirecrawlSearchResult> {
  const cleanQuery = opts.query.trim();
  if (!cleanQuery) {
    return { status: "error", message: "Search query cannot be empty." };
  }
  if (containsRestrictedWorkData(cleanQuery)) {
    return {
      status: "blocked_data_boundary",
      message:
        "Blocked: employer/Korn Ferry queries cannot be sent to external web search services.",
    };
  }

  const key = getFirecrawlApiKey(opts.apiKey);
  if (!key) {
    return buildFirecrawlNotConnectedResult();
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const limit = Math.min(10, Math.max(1, opts.limit ?? 5));
  const fetchedAtIso = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetchFn(`${FIRECRAWL_API_BASE_URL}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: cleanQuery,
        limit,
        ...(opts.tbs ? { tbs: opts.tbs } : {}),
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return {
        status: "error",
        message: `Firecrawl search returned HTTP ${res.status}.`,
      };
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: Array<{
        url?: string;
        title?: string;
        description?: string;
        markdown?: string;
        metadata?: Record<string, unknown>;
      }>;
    };

    const rawItems = Array.isArray(payload.data) ? payload.data : [];
    const results: FirecrawlSearchItem[] = [];
    for (const item of rawItems.slice(0, limit)) {
      const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
      if (!rawUrl) {
        continue;
      }
      let safeUrl: string;
      try {
        safeUrl = validateCloudBrowseUrl(rawUrl).toString();
      } catch {
        continue;
      }
      const md = typeof item.markdown === "string" ? item.markdown.trim() : "";
      const desc =
        typeof item.description === "string" ? item.description.trim() : "";
      const title =
        (typeof item.title === "string" && item.title.trim()) ||
        (typeof item.metadata?.title === "string" &&
          item.metadata.title.trim()) ||
        safeUrl;
      const publishedDate = extractPublishedDateFromMetadata(
        item.metadata,
        md || desc
      );
      const fenced = fenceUntrustedContent({
        text: md || desc,
        source: `firecrawl:search:${safeUrl}`,
        maxChars: 4000,
      });
      results.push({
        title,
        url: safeUrl,
        description: desc.slice(0, 400),
        publishedDate,
        fencedMarkdown: fenced.fencedText,
      });
    }

    return {
      status: "ok",
      query: cleanQuery,
      fetchedAtIso,
      results,
    };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error ? err.message : "Firecrawl search request failed.",
    };
  }
}

export type FirecrawlScrapeResult =
  | FirecrawlNotConnectedResult
  | {
      status: "blocked_data_boundary" | "error";
      url?: string;
      message: string;
    }
  | {
      status: "ok";
      url: string;
      title: string;
      publishedDate: string | null;
      fetchedAtIso: string;
      fencedMarkdown: string;
    };

export async function runFirecrawlScrape(opts: {
  url: string;
  onlyMainContent?: boolean;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<FirecrawlScrapeResult> {
  if (containsRestrictedWorkData(opts.url)) {
    return {
      status: "blocked_data_boundary",
      url: opts.url,
      message:
        "Blocked: employer/Korn Ferry URLs cannot be sent to external scraping services.",
    };
  }

  let safeUrl: URL;
  try {
    safeUrl = validateCloudBrowseUrl(opts.url);
  } catch (err) {
    return {
      status: "error",
      url: opts.url,
      message: err instanceof Error ? err.message : "Invalid or blocked URL.",
    };
  }

  const key = getFirecrawlApiKey(opts.apiKey);
  if (!key) {
    return buildFirecrawlNotConnectedResult();
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const fetchedAtIso = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetchFn(`${FIRECRAWL_API_BASE_URL}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: safeUrl.toString(),
        formats: ["markdown"],
        onlyMainContent: opts.onlyMainContent ?? true,
      }),
      signal: AbortSignal.timeout(18_000),
    });

    if (!res.ok) {
      return {
        status: "error",
        url: safeUrl.toString(),
        message: `Firecrawl scrape returned HTTP ${res.status}.`,
      };
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: Record<string, unknown>;
      };
    };

    const md = payload.data?.markdown?.trim() ?? "";
    const meta = payload.data?.metadata;
    const title =
      (typeof meta?.title === "string" && meta.title.trim()) ||
      safeUrl.hostname;
    const publishedDate = extractPublishedDateFromMetadata(meta, md);
    const fenced = fenceUntrustedContent({
      text: md,
      source: `firecrawl:scrape:${safeUrl.toString()}`,
      maxChars: 14_000,
    });

    return {
      status: "ok",
      url: safeUrl.toString(),
      title,
      publishedDate,
      fetchedAtIso,
      fencedMarkdown: fenced.fencedText,
    };
  } catch (err) {
    return {
      status: "error",
      url: safeUrl.toString(),
      message:
        err instanceof Error ? err.message : "Firecrawl scrape request failed.",
    };
  }
}

export type FirecrawlCrawlOrMapResult =
  | FirecrawlNotConnectedResult
  | {
      status: "blocked_data_boundary" | "error";
      url?: string;
      message: string;
    }
  | {
      status: "ok";
      mode: "map" | "crawl";
      url: string;
      fetchedAtIso: string;
      links?: string[];
      pages?: Array<{
        url: string;
        title: string;
        publishedDate: string | null;
        fencedMarkdown: string;
      }>;
    };

export async function runFirecrawlCrawlOrMap(opts: {
  url: string;
  mode?: "map" | "crawl";
  limit?: number;
  search?: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<FirecrawlCrawlOrMapResult> {
  if (containsRestrictedWorkData(`${opts.url}\n${opts.search ?? ""}`)) {
    return {
      status: "blocked_data_boundary",
      url: opts.url,
      message:
        "Blocked: employer/Korn Ferry URLs cannot be sent to external crawling services.",
    };
  }

  let safeUrl: URL;
  try {
    safeUrl = validateCloudBrowseUrl(opts.url);
  } catch (err) {
    return {
      status: "error",
      url: opts.url,
      message: err instanceof Error ? err.message : "Invalid or blocked URL.",
    };
  }

  const key = getFirecrawlApiKey(opts.apiKey);
  if (!key) {
    return buildFirecrawlNotConnectedResult();
  }

  const mode = opts.mode ?? "map";
  const fetchFn = opts.fetchImpl ?? fetch;
  const fetchedAtIso = new Date().toISOString().slice(0, 10);

  try {
    if (mode === "map") {
      const limit = Math.min(40, Math.max(1, opts.limit ?? 20));
      const res = await fetchFn(`${FIRECRAWL_API_BASE_URL}/map`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: safeUrl.toString(),
          limit,
          ...(opts.search?.trim() ? { search: opts.search.trim() } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          status: "error",
          url: safeUrl.toString(),
          message: `Firecrawl map returned HTTP ${res.status}.`,
        };
      }
      const payload = (await res.json()) as {
        links?: unknown[];
      };
      const links = (Array.isArray(payload.links) ? payload.links : [])
        .map((u) => {
          if (typeof u !== "string") {
            return null;
          }
          try {
            return validateCloudBrowseUrl(u).toString();
          } catch {
            return null;
          }
        })
        .filter((u): u is string => Boolean(u))
        .slice(0, limit);

      return {
        status: "ok",
        mode: "map",
        url: safeUrl.toString(),
        fetchedAtIso,
        links,
      };
    }

    // Bounded crawl (max 8 pages)
    const crawlLimit = Math.min(8, Math.max(1, opts.limit ?? 4));
    const startRes = await fetchFn(`${FIRECRAWL_API_BASE_URL}/crawl`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: safeUrl.toString(),
        limit: crawlLimit,
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!startRes.ok) {
      return {
        status: "error",
        url: safeUrl.toString(),
        message: `Firecrawl crawl returned HTTP ${startRes.status}.`,
      };
    }

    const started = (await startRes.json()) as {
      id?: string;
      status?: string;
      data?: Array<{
        markdown?: string;
        metadata?: Record<string, unknown>;
      }>;
    };

    let crawlDocs = Array.isArray(started.data) ? started.data : null;
    if (!crawlDocs && started.id) {
      const crawlId = encodeURIComponent(started.id);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const pollRes = await fetchFn(
          `${FIRECRAWL_API_BASE_URL}/crawl/${crawlId}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!pollRes.ok) {
          break;
        }
        const pollBody = (await pollRes.json()) as {
          status?: string;
          data?: Array<{
            markdown?: string;
            metadata?: Record<string, unknown>;
          }>;
        };
        if (
          pollBody.status === "completed" ||
          (Array.isArray(pollBody.data) && pollBody.data.length >= crawlLimit)
        ) {
          crawlDocs = pollBody.data ?? [];
          break;
        }
        crawlDocs = pollBody.data ?? [];
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    const pages = (crawlDocs ?? []).slice(0, crawlLimit).flatMap((doc) => {
      const meta = doc.metadata;
      const pageRawUrl =
        (typeof meta?.sourceURL === "string" && meta.sourceURL) ||
        (typeof meta?.url === "string" && meta.url) ||
        safeUrl.toString();
      let checkedUrl: string;
      try {
        checkedUrl = validateCloudBrowseUrl(pageRawUrl).toString();
      } catch {
        return [];
      }
      const md = doc.markdown?.trim() ?? "";
      const title =
        (typeof meta?.title === "string" && meta.title.trim()) || checkedUrl;
      const publishedDate = extractPublishedDateFromMetadata(meta, md);
      const fenced = fenceUntrustedContent({
        text: md,
        source: `firecrawl:crawl:${checkedUrl}`,
        maxChars: 5000,
      });
      return [
        {
          url: checkedUrl,
          title,
          publishedDate,
          fencedMarkdown: fenced.fencedText,
        },
      ];
    });

    return {
      status: "ok",
      mode: "crawl",
      url: safeUrl.toString(),
      fetchedAtIso,
      pages,
    };
  } catch (err) {
    return {
      status: "error",
      url: safeUrl.toString(),
      message:
        err instanceof Error ? err.message : "Firecrawl crawl/map failed.",
    };
  }
}
