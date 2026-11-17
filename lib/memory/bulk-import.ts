import type {
  JournalEntry,
  MemoryCategory,
  ProfileFact,
} from "@/lib/memory/store";

export type ParsedMemoryCandidate = {
  id: string;
  key: string;
  value: string;
  category: MemoryCategory;
};

export type MemoryImportPreviewItem = ParsedMemoryCandidate & {
  isDuplicate: boolean;
  duplicateReason?: "existing" | "paste_repeat";
  checked: boolean;
};

const BULLET_PREFIX_RE =
  /^\s*(?:[-*•◦▪‣⁃–—➤→]+|\[\s*[xX ]?\s*\]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/u;

const HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const DIVIDER_RE = /^\s*(?:[-*_]\s*){3,}$/;

export function normalizeMemoryComparisonText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(BULLET_PREFIX_RE, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1aHex(input: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Generates a deterministic, collision-safe key for a memory fact.
 * - Identical normalized facts produce the exact same key (idempotent upsert).
 * - Distinct facts sharing the first 50 characters still get distinct keys.
 */
export function deriveFactKey(value: string): string {
  const normalized = normalizeMemoryComparisonText(value);
  const asciiPrefix = normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  const hash = fnv1aHex(normalized || value.trim());
  return asciiPrefix ? `${asciiPrefix}_${hash}` : `fact_${hash}`;
}

function parseHeadingCategory(heading: string): MemoryCategory | null {
  const h = heading.toLowerCase();
  if (/identity|personal|about me|family|kimlik|kişisel|aile/.test(h)) {
    return "identity";
  }
  if (/prefer|style|tone|format|tercih|üslup|tarz/.test(h)) {
    return "preference";
  }
  if (/finance|money|tax|budget|finans|bütçe|vergi|maaş/.test(h)) {
    return "finance";
  }
  if (/project|code|tech|app|proje|kod|uygulama/.test(h)) {
    return "project";
  }
  if (/work|role|career|iş|kariyer|görev/.test(h)) {
    return "work";
  }
  return null;
}

export function inferMemoryCategory(
  value: string,
  headingHint?: MemoryCategory | null
): MemoryCategory {
  if (headingHint) {
    return headingHint;
  }
  const text = value.toLowerCase();
  if (
    /\b(prefer|always|never|concise|brief|tone|format|bullet|dark mode|light mode|language|english|turkish)\b|tercih|her zaman|asla|kısa|özet|üslup|dil|türkçe|ingilizce/u.test(
      text
    )
  ) {
    return "preference";
  }
  if (
    /\b(my name|i live|based in|home|timezone|time zone|daughter|son|wife|husband|partner|birthday|passport|citizen|allergic|coffee)\b|adım|yaşıyorum|evim|saat dilimi|kızım|oğlum|eşim|doğum|kahve|alerji/u.test(
      text
    )
  ) {
    return "identity";
  }
  if (
    /\b(gbp|usd|eur|try|budget|tax|hmrc|isa|salary|invoice|currency|bank|mortgage|dividend)\b|£|\$|bütçe|vergi|kur|para birimi|fatura|banka|yatırım/u.test(
      text
    )
  ) {
    return "finance";
  }
  if (
    /\b(repo|github|vercel|nextjs|next\.js|typescript|tailscale|mac mini|vm|gcp|vertex|deploy|branch|cursor|copilot)\b|proje|sunucu|uygulama/u.test(
      text
    )
  ) {
    return "project";
  }
  if (
    /\b(office|meeting|colleague|manager|team)\b|toplantı|ekip|ofis/u.test(text)
  ) {
    return "work";
  }
  return "general";
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (trimmed.length <= 220) {
    return [trimmed];
  }
  const parts = trimmed
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (parts.length <= 1 || parts.some((p) => p.length < 12)) {
    return [trimmed];
  }
  return parts;
}

/**
 * Splits a pasted list (bullets, numbered items, plain lines, or paragraphs)
 * into clean individual memory facts.
 */
export function splitPastedMemoryList(
  raw: string,
  maxItems = 250
): ParsedMemoryCandidate[] {
  const lines = raw.split(/\r?\n/);
  const results: ParsedMemoryCandidate[] = [];
  let activeHeadingCategory: MemoryCategory | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || DIVIDER_RE.test(trimmed)) {
      continue;
    }
    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch?.[1]) {
      activeHeadingCategory = parseHeadingCategory(headingMatch[1]);
      continue;
    }

    const hadBullet = BULLET_PREFIX_RE.test(trimmed);
    const cleaned = trimmed.replace(BULLET_PREFIX_RE, "").trim();
    if (cleaned.length < 2) {
      continue;
    }

    const segments = hadBullet
      ? [cleaned]
      : splitParagraphIntoSentences(cleaned);

    for (const seg of segments) {
      const value = seg.slice(0, 1500).trim();
      if (value.length < 2) {
        continue;
      }
      const key = deriveFactKey(value);
      const category = inferMemoryCategory(value, activeHeadingCategory);
      results.push({
        id: `${key}_${results.length}`,
        key,
        value,
        category,
      });
      if (results.length >= maxItems) {
        return results;
      }
    }
  }

  return results;
}

/**
 * Splits pasted text into individual facts and marks duplicates against both
 * existing saved memories and earlier lines within the same paste.
 */
export function prepareMemoryImportPreview(
  raw: string,
  existingFacts: readonly Pick<ProfileFact, "key" | "value">[]
): MemoryImportPreviewItem[] {
  const existingKeys = new Set(existingFacts.map((f) => f.key.toLowerCase()));
  const existingNormalized = new Set(
    existingFacts
      .map((f) => normalizeMemoryComparisonText(f.value))
      .filter(Boolean)
  );

  const seenInPaste = new Set<string>();
  const parsed = splitPastedMemoryList(raw);

  return parsed.map((item) => {
    const norm = normalizeMemoryComparisonText(item.value);
    const inExisting =
      existingKeys.has(item.key.toLowerCase()) ||
      (norm.length > 0 && existingNormalized.has(norm));
    const inPaste = norm.length > 0 && seenInPaste.has(norm);
    if (norm.length > 0) {
      seenInPaste.add(norm);
    }
    const isDuplicate = inExisting || inPaste;
    return {
      ...item,
      isDuplicate,
      duplicateReason: inExisting
        ? "existing"
        : inPaste
          ? "paste_repeat"
          : undefined,
      checked: !isDuplicate,
    };
  });
}

const EXPLICIT_REMEMBER_PATTERNS: readonly RegExp[] = [
  /^\s*(?:please\s+)?remember\s+this\s*[:\-–—]\s*(.+)$/isu,
  /^\s*(?:please\s+)?remember\s*[:\-–—]\s*(.+)$/isu,
  /^\s*(?:please\s+)?save\s+(?:this\s+)?to\s+(?:my\s+)?memory\s*[:\-–—]?\s*(.+)$/isu,
  /^\s*(?:please\s+)?keep\s+in\s+mind\s*[:\-–—]\s*(.+)$/isu,
  /^\s*(?:lütfen\s+)?bunu\s+hatırla\s*[:\-–—]?\s*(.+)$/isu,
  /^\s*(?:lütfen\s+)?hatırla\s*[:\-–—]\s*(.+)$/isu,
  /^\s*(?:lütfen\s+)?unutma\s*[:\-–—]\s*(.+)$/isu,
  /^\s*(?:lütfen\s+)?aklında\s+tut\s*[:\-–—]\s*(.+)$/isu,
  /^\s*(?:lütfen\s+)?(?:belleğe|belleğime|hafızaya|hafızama)\s+kaydet\s*[:\-–—]\s*(.+)$/isu,
];

/**
 * Extracts an explicit single-turn `"remember this: …"` / `"bunu hatırla: …"`
 * directive from chat or voice transcripts. Questions are ignored.
 */
export function extractExplicitRememberFact(text: string): {
  key: string;
  value: string;
  category: MemoryCategory;
} | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.endsWith("?")) {
    return null;
  }
  for (const pattern of EXPLICIT_REMEMBER_PATTERNS) {
    const match = trimmed.match(pattern);
    const captured = match?.[1]
      ?.trim()
      .replace(/^["“”']+|["“”']+$/g, "")
      .trim();
    if (captured && captured.length >= 2 && captured.length <= 1500) {
      return {
        key: deriveFactKey(captured),
        value: captured,
        category: inferMemoryCategory(captured),
      };
    }
  }
  return null;
}

/**
 * Ranks owner profile facts for prompt injection: facts sharing keywords with
 * the active user turn come first, followed by newest facts, up to `maxFacts`
 * and `maxChars` so 50+ saved memories are available in every chat and voice session.
 */
export function selectRelevantFactsForPrompt(
  facts: readonly ProfileFact[],
  queryText = "",
  maxFacts = 80,
  maxChars = 6000
): ProfileFact[] {
  if (facts.length === 0) {
    return [];
  }
  const queryWords = new Set(
    normalizeMemoryComparisonText(queryText)
      .split(" ")
      .filter((w) => w.length >= 3)
  );

  const scored = facts.map((fact, idx) => {
    let score = 0;
    if (queryWords.size > 0) {
      const words = normalizeMemoryComparisonText(
        `${fact.key} ${fact.value}`
      ).split(" ");
      for (const w of words) {
        if (queryWords.has(w)) {
          score += 1;
        }
      }
    }
    return { fact, score, idx };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

  const chosen: ProfileFact[] = [];
  let usedChars = 0;
  for (const { fact } of scored) {
    if (chosen.length >= maxFacts) {
      break;
    }
    const lineCost = fact.value.length + fact.category.length + 8;
    if (usedChars + lineCost > maxChars && chosen.length > 0) {
      break;
    }
    chosen.push(fact);
    usedChars += lineCost;
  }
  return chosen;
}

export function buildMemoriesExportMarkdown(
  facts: readonly ProfileFact[],
  journalEntries: readonly JournalEntry[] = []
): string {
  const lines: string[] = [
    "# Personal Assistant Memory Export",
    `Exported: ${new Date().toISOString()}`,
    "",
  ];

  if (facts.length > 0) {
    lines.push(`## Saved Memories (${facts.length})`, "");
    const byCategory = new Map<string, ProfileFact[]>();
    for (const fact of facts) {
      const list = byCategory.get(fact.category) ?? [];
      list.push(fact);
      byCategory.set(fact.category, list);
    }
    for (const [cat, items] of byCategory.entries()) {
      lines.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
      for (const item of items) {
        lines.push(`- ${item.value}`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Saved Memories (0)", "", "_No saved memories yet._", "");
  }

  if (journalEntries.length > 0) {
    lines.push(`## Journal Notes (${journalEntries.length})`, "");
    for (const entry of journalEntries) {
      const tagStr =
        entry.tags.length > 0
          ? ` (${entry.tags.map((t) => `#${t}`).join(" ")})`
          : "";
      lines.push(`### ${entry.title}${tagStr}`);
      lines.push(entry.body, "");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
