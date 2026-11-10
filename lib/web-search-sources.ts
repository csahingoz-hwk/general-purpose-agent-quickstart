/**
 * Read-only view model for a stored AI Gateway DeepSeek Search output. The
 * output is untrusted web data: only plain text is extracted, lengths are
 * bounded, and only http(s) URLs may become links. Anything unexpected is
 * reported as "unknown" so the UI falls back to a bounded readable view.
 */
export type WebSearchSource = {
  title: string;
  /** Present only for a valid http/https URL. */
  url: string | null;
  hostname: string | null;
};

export type WebSearchView =
  | { kind: "results"; sources: WebSearchSource[] }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "unknown" };

export const MAX_SOURCES_SHOWN = 5;
const MAX_TITLE = 120;

export function safeHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function plain(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE)
    : "";
}

export function webSearchView(output: unknown): WebSearchView {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { kind: "unknown" };
  }
  const record = output as Record<string, unknown>;
  if (typeof record.error === "string") {
    return { kind: "error" };
  }
  if (!Array.isArray(record.results)) {
    return { kind: "unknown" };
  }
  const sources: WebSearchSource[] = [];
  for (const item of record.results) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const url = safeHttpUrl(entry.url);
    const hostname = url?.hostname.replace(/^www\./, "") ?? null;
    const title = plain(entry.title) || plain(entry.site_name) || hostname;
    if (!title) {
      continue;
    }
    sources.push({ title, url: url?.href ?? null, hostname });
    if (sources.length === MAX_SOURCES_SHOWN) {
      break;
    }
  }
  return sources.length > 0 ? { kind: "results", sources } : { kind: "empty" };
}

/** Bounded text for an output we cannot interpret (never rendered as HTML). */
export function boundedJson(value: unknown, max = 1500): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "";
  } catch {
    text = "";
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
