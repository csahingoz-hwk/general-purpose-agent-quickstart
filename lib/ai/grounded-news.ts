import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import { HYDROGEN } from "./routing/catalog";
import {
  getVertexProjectId,
  getVertexWifAccessToken,
  isVertexWifConfigured,
} from "./vertex-auth";

const SYNTHETIC_FIXTURE_HINT_RE =
  /\b(?:fictional|synthetic|mock\s+data|demo\s+inbox|lorem\s+ipsum)\b|(?<![\p{L}])(?:hayal[iî]|kurgusal|örnek\s+şablon)(?![\p{L}])/iu;

const NEWS_FILENAME_RE =
  /(?:^|[/_.-])(?:news|haber\p{L}*|headlines?|manset\p{L}*|manşet\p{L}*|digest|briefing|bulten|bülten)(?:[/_.-]|$)/iu;

const NEWS_TITLE_OR_QUERY_RE =
  /\b(?:(?:latest|breaking|recent|today'?s|daily|weekly|current|top|world|global|tech|technology|ai|artificial\s+intelligence|market|finance|crypto|science|sports)\s+(?:news|headlines|developments|updates|stories)|news\s+(?:page|digest|summary|briefing|report|html|site|portal|roundup|feed|cards?)|daily\s+(?:digest|briefing)|top\s+(?:headlines|stories))\b|(?<![\p{L}])(?:(?:son|güncel|bugünkü|haftalık|yapay\s+zeka|teknoloji|dünya|ekonomi|spor|bilim)\s+(?:haber\p{L}*|gelişme\p{L}*|manşet\p{L}*)|haber\s+(?:sayfa\p{L}*|özet\p{L}*|bülten\p{L}*|rapor\p{L}*|sitesi|html)|günün\s+(?:haber\p{L}*|özet\p{L}*|manşet\p{L}*))(?![\p{L}])/iu;

const NON_ARTICLE_ASSET_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.tailwindcss.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "www.w3.org",
  "w3.org",
  "schema.org",
  "lucide.dev",
]);

const PLACEHOLDER_HOST_RE =
  /^(?:www\.)?(?:example\.(?:com|org|net)|placeholder\.(?:com|dev)|localhost|127\.0\.0\.1|0\.0\.0\.0|news\.example|source\.example)$/i;

const PLACEHOLDER_TEXT_RE =
  /\blorem\s+ipsum\b|\bdolor\s+sit\s+amet\b|\[insert\s+(?:url|link|source|date)\]|https?:\/\/(?:www\.)?example\.(?:com|org|net)/i;

const EXPLICIT_DATE_RE =
  /\b202[4-9]-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:[12]?\d|3[01])(?:,?\s+202[4-9])?\b|\b(?:[12]?\d|3[01])\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+202[4-9])?\b|\b(?:[12]?\d|3[01])\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)\.?(?:\s+202[4-9])?\b|\b(?:0?[1-9]|[12]\d|3[01])[./](?:0?[1-9]|1[0-2])[./]202[4-9]\b/gu;

function extractDocumentHeadingText(content: string): string {
  const titleMatch = content.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
  const h1Match = content.match(/<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i);
  const mdHeading = content.match(/^\s*#\s+([^\r\n]{1,200})/m);
  return [titleMatch?.[1], h1Match?.[1], mdHeading?.[1]]
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

export function isNewsPageOrBriefingTarget(opts: {
  path?: string | null;
  title?: string | null;
  userText?: string | null;
  content?: string | null;
}): boolean {
  const combinedHint = [opts.path, opts.title, opts.userText]
    .filter(Boolean)
    .join(" ");
  if (SYNTHETIC_FIXTURE_HINT_RE.test(combinedHint)) {
    return false;
  }
  if (opts.path && NEWS_FILENAME_RE.test(opts.path)) {
    return true;
  }
  if (opts.title && NEWS_TITLE_OR_QUERY_RE.test(opts.title)) {
    return true;
  }
  if (opts.userText && NEWS_TITLE_OR_QUERY_RE.test(opts.userText)) {
    return true;
  }
  if (opts.content) {
    const heading = extractDocumentHeadingText(opts.content);
    if (
      heading &&
      !SYNTHETIC_FIXTURE_HINT_RE.test(heading) &&
      NEWS_TITLE_OR_QUERY_RE.test(heading)
    ) {
      return true;
    }
  }
  return false;
}

export type GroundedNewsValidation = {
  valid: boolean;
  reason?:
    | "placeholder_or_invented_items"
    | "missing_source_links"
    | "missing_dates"
    | "unverified_source_urls";
  sourceLinks: string[];
  datesFound: string[];
};

function normalizeHost(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function extractExternalArticleLinks(content: string): {
  articleLinks: string[];
  hasPlaceholderUrl: boolean;
} {
  const candidates = new Set<string>();
  let hasPlaceholderUrl = PLACEHOLDER_TEXT_RE.test(content);

  const hrefRe = /\bhref\s*=\s*["']([^"'\s>]+)["']/gi;
  for (const m of content.matchAll(hrefRe)) {
    const raw = m[1]?.trim() ?? "";
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
      continue;
    }
    if (raw === "#" || raw.toLowerCase().startsWith("javascript:")) {
      continue;
    }
    candidates.add(raw);
  }

  const mdLinkRe = /\[[^\]]{1,240}\]\((https?:\/\/[^)\s"']+)\)/gi;
  for (const m of content.matchAll(mdLinkRe)) {
    if (m[1]) {
      candidates.add(m[1].trim());
    }
  }

  const articleLinks: string[] = [];
  for (const raw of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (PLACEHOLDER_HOST_RE.test(host)) {
      hasPlaceholderUrl = true;
      continue;
    }
    if (NON_ARTICLE_ASSET_HOSTS.has(host)) {
      continue;
    }
    if (
      /\.(?:css|js|woff2?|ttf|otf|ico)(?:$|\?)/i.test(parsed.pathname) &&
      !host.includes("vertexaisearch.cloud.google.com")
    ) {
      continue;
    }
    articleLinks.push(parsed.toString());
  }

  return { articleLinks, hasPlaceholderUrl };
}

/**
 * Validates that a generated news HTML/Markdown page contains real external
 * `https://` source links and explicit publication dates, never placeholder or
 * invented items. When `verifiedUrls` from live web search on the same turn are
 * supplied, also verifies cited links come from those search results.
 */
export function validateGroundedNewsPageContent(
  content: string,
  opts?: { verifiedUrls?: readonly string[] }
): GroundedNewsValidation {
  const { articleLinks, hasPlaceholderUrl } =
    extractExternalArticleLinks(content);
  const datesFound = [...new Set(content.match(EXPLICIT_DATE_RE) ?? [])];

  if (hasPlaceholderUrl) {
    return {
      valid: false,
      reason: "placeholder_or_invented_items",
      sourceLinks: articleLinks,
      datesFound,
    };
  }

  if (articleLinks.length === 0) {
    return {
      valid: false,
      reason: "missing_source_links",
      sourceLinks: [],
      datesFound,
    };
  }

  if (datesFound.length === 0) {
    return {
      valid: false,
      reason: "missing_dates",
      sourceLinks: articleLinks,
      datesFound: [],
    };
  }

  if (opts?.verifiedUrls && opts.verifiedUrls.length > 0) {
    const allowedExact = new Set(opts.verifiedUrls.map((u) => u.trim()));
    const allowedHosts = new Set(
      opts.verifiedUrls
        .map((u) => normalizeHost(u))
        .filter((h): h is string => Boolean(h))
    );
    const hasUnverified = articleLinks.some((link) => {
      if (allowedExact.has(link)) {
        return false;
      }
      const host = normalizeHost(link);
      if (!host) {
        return true;
      }
      if (host === "vertexaisearch.cloud.google.com") {
        return false;
      }
      return !allowedHosts.has(host);
    });
    if (hasUnverified) {
      return {
        valid: false,
        reason: "unverified_source_urls",
        sourceLinks: articleLinks,
        datesFound,
      };
    }
  }

  return {
    valid: true,
    sourceLinks: articleLinks,
    datesFound,
  };
}

export type GroundedNewsSource = {
  title: string;
  url: string;
};

export type GroundedNewsBriefingResult = {
  ok: boolean;
  query: string;
  fetchedAtIso: string;
  summaryText: string;
  sources: GroundedNewsSource[];
  promptContext: string;
};

/**
 * Executes a live Vertex Google Search (`{ googleSearch: {} }` on `gemini-4-hydrogen`)
 * to retrieve real, dated news items and verified source URLs before generating
 * a news page or news artifact.
 */
export async function fetchGroundedNewsBriefing(
  rawQuery: string,
  deps?: {
    fetcher?: typeof fetch;
    getAccessToken?: () => Promise<string>;
    projectId?: string;
    now?: Date;
  }
): Promise<GroundedNewsBriefingResult> {
  const query = rawQuery.trim().slice(0, 240);
  const nowIso = (deps?.now ?? new Date()).toISOString().slice(0, 10);
  const empty: GroundedNewsBriefingResult = {
    ok: false,
    query,
    fetchedAtIso: nowIso,
    summaryText: "",
    sources: [],
    promptContext: "",
  };

  if (!query || containsRestrictedWorkData(query)) {
    return empty;
  }

  const projectId = deps?.projectId ?? getVertexProjectId();
  if (!projectId && !deps?.getAccessToken) {
    return empty;
  }
  if (!deps?.getAccessToken && !isVertexWifConfigured()) {
    return empty;
  }

  try {
    const fetcher = deps?.fetcher ?? fetch;
    const accessToken = deps?.getAccessToken
      ? await deps.getAccessToken()
      : await getVertexWifAccessToken(fetcher);
    const effectiveProject = projectId ?? "vertex-project";
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(
      effectiveProject
    )}/locations/global/publishers/google/models/${encodeURIComponent(
      HYDROGEN
    )}:generateContent`;

    const res = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `Today is ${nowIso}. Search Google for real, recent news matching the user's topic. List 4 to 8 real news items ONLY from the search results. For every item include: exact headline, publication date (YYYY-MM-DD), publisher name, 1-2 sentence factual summary, and exact source URL. Never invent or guess any story, date, or URL.`,
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: query }],
          },
        ],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingLevel: "LOW" },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return empty;
    }

    const payload = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        groundingMetadata?: {
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
        };
      }>;
    };

    const cand = payload.candidates?.[0];
    const summaryText = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();

    const sources: GroundedNewsSource[] = [];
    const seen = new Set<string>();
    for (const chunk of cand?.groundingMetadata?.groundingChunks ?? []) {
      const uri = chunk.web?.uri?.trim();
      const title = chunk.web?.title?.trim();
      if (!uri || seen.has(uri)) {
        continue;
      }
      seen.add(uri);
      sources.push({ title: title || uri, url: uri });
      if (sources.length >= 10) {
        break;
      }
    }

    if (!summaryText && sources.length === 0) {
      return empty;
    }

    const sourceLines = sources.map(
      (s, idx) => `${idx + 1}. ${s.title} — ${s.url}`
    );
    const rawPack = [
      `Verified Google Search date: ${nowIso}`,
      summaryText ? `Grounded findings:\n${summaryText}` : "",
      sourceLines.length > 0
        ? `Verified source links (use ONLY these real URLs as clickable source links):\n${sourceLines.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const fenced = fenceUntrustedContent({
      text: rawPack,
      source: "grounded_web_search",
      maxChars: 12_000,
    });

    return {
      ok: sources.length > 0,
      query,
      fetchedAtIso: nowIso,
      summaryText,
      sources,
      promptContext: fenced.fencedText,
    };
  } catch {
    return empty;
  }
}

export const GROUNDED_NEWS_PAGE_RULES = `## News Pages & Current-Events Briefings (Strict Grounding Rule)
- Whenever you build a "news" page, digest, headlines HTML/Markdown file (e.g. \`ai_news.html\`), or current-events artifact, you MUST use ONLY real web search results (\`webSearch\`) — NEVER invent, extrapolate, or use placeholder headlines, dates, summaries, or URLs.
- Every news item on the page MUST display: (1) its real publication date (e.g. \`2026-11-18\` or localized date from the source), and (2) a clickable \`https://\` link to the real source article (\`<a href="https://..." target="_blank" rel="noopener noreferrer">Source</a>\` in HTML or \`[Publisher](https://...)\` in Markdown).
- If live web search returns fewer items or no results, include only the verified items found (or state clearly that live search returned no verified items) — never pad a news page with made-up stories or \`example.com\` / \`#\` links.
- After writing any file (HTML, Markdown, TXT, JSON, CSV, PDF, PNG, ZIP, etc.) on the Cloud Computer, call \`cloudExportFileToChat\` so the chat card includes both sandboxed preview/open and Download.`;
