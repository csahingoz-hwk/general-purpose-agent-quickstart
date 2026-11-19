import {
  isFirecrawlConfigured,
  runFirecrawlSearch,
} from "@/lib/connectors/firecrawl";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";

export type PublicWebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  site_name?: string;
};

const TR_CONVERSATIONAL_STOPWORDS = new Set<string>([
  "bana",
  "benim",
  "ben",
  "lütfen",
  "lutfen",
  "hakkında",
  "hakkinda",
  "ilgili",
  "konusunda",
  "kısa",
  "kisa",
  "uzun",
  "detaylı",
  "detayli",
  "kaynaklı",
  "kaynakli",
  "kaynakçalı",
  "kaynaklarla",
  "bir",
  "bu",
  "şu",
  "su",
  "o",
  "ve",
  "ile",
  "veya",
  "ya",
  "da",
  "de",
  "için",
  "icin",
  "göre",
  "gore",
  "verir",
  "verebilir",
  "ver",
  "misin",
  "mısın",
  "misiniz",
  "mısınız",
  "musun",
  "müsün",
  "anlatır",
  "anlatir",
  "anlat",
  "söyler",
  "soyler",
  "söyle",
  "yazar",
  "yaz",
  "yap",
  "yapar",
  "hazırla",
  "hazirla",
  "getir",
  "göster",
  "goster",
  "bul",
  "ara",
  "analiz",
  "analizi",
  "özet",
  "ozet",
  "özetle",
  "rapor",
  "raporu",
  "nedir",
  "neler",
  "nelerdir",
  "nasıl",
  "nasil",
  "var",
  "mı",
  "mi",
  "mu",
  "mü",
  "bugünün",
  "bugunun",
  "bugünkü",
  "bugunku",
  "günün",
  "gunun",
  "öne",
  "one",
  "çıkan",
  "cikan",
  "önemli",
  "onemli",
  "son",
  "güncel",
  "guncel",
  "dünyası",
  "dunyasi",
  "dünyasından",
  "dunyasindan",
  "dünya",
  "dunya",
]);

const EN_CONVERSATIONAL_STOPWORDS = new Set<string>([
  "can",
  "could",
  "would",
  "you",
  "please",
  "give",
  "me",
  "tell",
  "show",
  "find",
  "write",
  "make",
  "create",
  "short",
  "brief",
  "quick",
  "sourced",
  "cited",
  "with",
  "sources",
  "citations",
  "analysis",
  "summary",
  "overview",
  "about",
  "around",
  "regarding",
  "today",
  "todays",
  "today's",
  "top",
  "main",
  "major",
  "latest",
  "current",
  "breaking",
  "what",
  "are",
  "is",
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "for",
  "to",
  "from",
  "world",
]);

function normalizeTurkishToken(token: string): string {
  const lower = token.toLocaleLowerCase("tr");
  if (/^haber(?:ler(?:i|inden|ini|ine|in)?)?$/u.test(lower)) {
    return "haberleri";
  }
  if (/^enflasyon(?:u|un|da|dan|a|la)?$/u.test(lower)) {
    return "enflasyon";
  }
  if (/^ekonomi(?:si|sinin|sinde|ye|yi)?$/u.test(lower)) {
    return "ekonomi";
  }
  if (/^faiz(?:i|in|leri|lerinin|ler|oran\p{L}*)?$/u.test(lower)) {
    return "faiz";
  }
  if (/^(?:202\d)['’](?:da|de|ta|te|nin|nın|ten|tan|ye|ya)$/u.test(lower)) {
    return lower.slice(0, 4);
  }
  return token;
}

/**
 * Turns a conversational user prompt (e.g. "Bana bugünün öne çıkan AI dünyası
 * haberlerinden verir misin?") into 1-3 focused search queries suitable for
 * Google News RSS, Firecrawl, or DuckDuckGo.
 */
export function extractFocusedSearchQueries(rawPrompt: string): string[] {
  const cleaned = rawPrompt
    .normalize("NFC")
    .replace(/[?!.,;:()[\]{}"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return [];
  }

  const rawTokens = cleaned.split(" ").filter(Boolean);
  const isTurkish =
    /[çğıöşüÇĞİÖŞÜ]/.test(cleaned) ||
    /\b(?:haber\p{L}*|türkiye|enflasyon|yapay\s+zeka|bugün|güncel|merkez\s+bankası|faiz|dolar|analiz)\b/iu.test(
      cleaned
    );

  const kept: string[] = [];
  const seenLower = new Set<string>();
  for (const rawTok of rawTokens) {
    const normalized = normalizeTurkishToken(rawTok).replace(
      /['’](?:da|de|ta|te|nin|nın|nun|nün|in|ın|un|ün|ye|ya|yi|yı|yu|yü|ten|tan|den|dan)$/iu,
      ""
    );
    const low = normalized.toLocaleLowerCase("tr");
    if (
      !normalized ||
      low.length < 2 ||
      TR_CONVERSATIONAL_STOPWORDS.has(low) ||
      EN_CONVERSATIONAL_STOPWORDS.has(low)
    ) {
      continue;
    }
    if (seenLower.has(low)) {
      continue;
    }
    seenLower.add(low);
    kept.push(normalized);
    if (kept.length >= 5) {
      break;
    }
  }

  const queries: string[] = [];
  const pushUnique = (q: string) => {
    const trimmed = q.replace(/\s+/g, " ").trim().slice(0, 140);
    if (
      trimmed &&
      !queries.some(
        (existing) => existing.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      queries.push(trimmed);
    }
  };

  if (kept.length > 0) {
    pushUnique(kept.join(" "));
  }

  // If a Turkish news prompt mentions "AI", also prepare "yapay zeka haberleri"
  // and English "AI news" fallbacks so RSS always returns rich, fresh coverage.
  const hasAiTerm = kept.some((t) => /^(?:ai|yapay|zeka)$/iu.test(t));
  const hasNewsTerm =
    /\b(?:news|headlines|haber\p{L}*|gündem)\b/iu.test(cleaned) ||
    kept.some((t) => /^(?:news|haberleri)$/iu.test(t));

  if (hasAiTerm && hasNewsTerm) {
    if (isTurkish) {
      pushUnique("yapay zeka haberleri");
    }
    pushUnique("AI news");
  } else if (kept.length > 3) {
    pushUnique(kept.slice(0, 3).join(" "));
  }

  // Only fall back to the raw prompt if it is already short (<= 5 words) or no keywords survived
  if (queries.length === 0 || rawTokens.length <= 5) {
    pushUnique(cleaned);
  }

  return queries.slice(0, 3);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIsoDateFromRss(raw?: string): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchGoogleNewsRss(
  query: string,
  locale: "tr" | "en",
  fetchFn: typeof fetch
): Promise<PublicWebSearchHit[]> {
  const hl = locale === "tr" ? "tr" : "en-US";
  const gl = locale === "tr" ? "TR" : "US";
  const ceid = locale === "tr" ? "TR:tr" : "US:en";
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetchFn(rssUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PersonalAssistant/1.0)",
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) {
    return [];
  }
  const xml = await res.text();
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  const hits: PublicWebSearchHit[] = [];
  const seenUrls = new Set<string>();
  for (const match of itemMatches) {
    const block = match[1] ?? "";
    const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const linkRaw = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "";
    const pubRaw = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "";
    const sourceRaw =
      block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "";
    const sourceUrlRaw =
      block.match(/<source[^>]*\burl=["']([^"']+)["'][^>]*>/i)?.[1] ?? "";
    const title = decodeXmlEntities(titleRaw);
    const url = decodeXmlEntities(linkRaw);
    const sourceName = decodeXmlEntities(sourceRaw);
    const publishedDate = parseIsoDateFromRss(decodeXmlEntities(pubRaw));
    if (!title || !url || !isValidHttpUrl(url) || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    let siteDomain: string | undefined;
    if (sourceUrlRaw && isValidHttpUrl(sourceUrlRaw)) {
      try {
        siteDomain = new URL(sourceUrlRaw).hostname.replace(/^www\./, "");
      } catch {
        /* ignore malformed source url */
      }
    }
    const snippetParts = [
      publishedDate,
      sourceName ? `${sourceName}: ${title}` : title,
    ].filter(Boolean);
    hits.push({
      title,
      url,
      snippet: snippetParts.join(" · "),
      ...(publishedDate ? { publishedDate } : {}),
      ...(siteDomain
        ? { site_name: siteDomain }
        : sourceName
          ? { site_name: sourceName }
          : {}),
    });
    if (hits.length >= 6) {
      break;
    }
  }
  return hits;
}

/**
 * Executes a bounded, read-only public web search (strictly guarded against
 * employer/Korn Ferry queries):
 * 1) Firecrawl `/search` when `FIRECRAWL_API_KEY` is configured and live
 * 2) Google News RSS using focused extracted queries (TR + EN fallback)
 * 3) DuckDuckGo Instant Answer JSON fallback
 */
export async function runPublicWebSearch(
  rawQuery: string,
  opts?: { fetchImpl?: typeof fetch; useLiveFirecrawl?: boolean }
): Promise<PublicWebSearchHit[]> {
  const cleanQuery = rawQuery.trim().slice(0, 260);
  if (!cleanQuery || containsRestrictedWorkData(cleanQuery)) {
    return [];
  }

  const fetchFn = opts?.fetchImpl ?? fetch;
  const focusedQueries = extractFocusedSearchQueries(cleanQuery);
  const primaryQuery = focusedQueries[0] ?? cleanQuery;

  // 1. Firecrawl search when configured
  if (opts?.useLiveFirecrawl !== false && isFirecrawlConfigured()) {
    try {
      const fc = await runFirecrawlSearch({
        query: primaryQuery,
        limit: 5,
        fetchImpl: fetchFn,
      });
      if (fc.status === "ok" && fc.results.length > 0) {
        return fc.results.map((item) => ({
          title: item.title,
          url: item.url,
          snippet: item.description || item.title,
          ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
        }));
      }
    } catch {
      /* fall through to RSS / DDG */
    }
  }

  const hits: PublicWebSearchHit[] = [];
  const seenUrls = new Set<string>();
  const appendUnique = (items: PublicWebSearchHit[]) => {
    for (const item of items) {
      if (seenUrls.has(item.url)) {
        continue;
      }
      seenUrls.add(item.url);
      hits.push(item);
      if (hits.length >= 6) {
        break;
      }
    }
  };

  // 2. Google News RSS with focused queries (TR locale first for Turkish queries,
  //    plus EN fallback if needed)
  const isTurkish =
    /[çğıöşüÇĞİÖŞÜ]/.test(cleanQuery) ||
    /\b(?:türkiye|enflasyon|tüik|tcmb|faiz|haber\p{L}*|yapay\s+zeka|güncel)\b/iu.test(
      cleanQuery
    );

  for (const q of focusedQueries) {
    if (hits.length >= 5) {
      break;
    }
    const qIsTurkish =
      /[çğıöşüÇĞİÖŞÜ]/.test(q) ||
      /\b(?:türkiye|enflasyon|haber\p{L}*|yapay\s+zeka|faiz)\b/iu.test(q);
    const primaryLocale: "tr" | "en" = qIsTurkish
      ? "tr"
      : isTurkish && focusedQueries.indexOf(q) === 0
        ? "tr"
        : "en";
    try {
      const rssHits = await fetchGoogleNewsRss(q, primaryLocale, fetchFn);
      appendUnique(rssHits);
      if (hits.length === 0 && primaryLocale === "tr") {
        const enHits = await fetchGoogleNewsRss(q, "en", fetchFn);
        appendUnique(enHits);
      }
    } catch {
      /* keep fallback resilient */
    }
  }

  // 3. DuckDuckGo Instant Answer JSON fallback if RSS returned 0 hits
  if (hits.length === 0) {
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(primaryQuery)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetchFn(ddgUrl, {
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<{
            Text?: string;
            FirstURL?: string;
            Topics?: Array<{ Text?: string; FirstURL?: string }>;
          }>;
        };
        if (
          data.AbstractURL &&
          data.AbstractText &&
          isValidHttpUrl(data.AbstractURL)
        ) {
          appendUnique([
            {
              title: data.Heading || primaryQuery,
              url: data.AbstractURL,
              snippet: data.AbstractText.slice(0, 320),
            },
          ]);
        }
        const flatTopics = (data.RelatedTopics ?? []).flatMap((t) =>
          Array.isArray(t.Topics) ? t.Topics : [t]
        );
        for (const topic of flatTopics) {
          if (
            topic.FirstURL &&
            topic.Text &&
            isValidHttpUrl(topic.FirstURL) &&
            hits.length < 6
          ) {
            appendUnique([
              {
                title: topic.Text.split(" - ")[0]?.trim() || primaryQuery,
                url: topic.FirstURL,
                snippet: topic.Text.slice(0, 300),
              },
            ]);
          }
        }
      }
    } catch {
      /* keep fallback resilient */
    }
  }

  return hits.slice(0, 6);
}
