import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import type {
  CanonicalMemoryCategory,
  JournalEntry,
  MemorySource,
  ProfileFact,
} from "@/lib/memory/store";

export const IMPORT_MEMORY_SOURCES = [
  "chatgpt",
  "claude",
  "gemini",
  "grok_bot",
  "pasted",
] as const;

export type ImportMemorySource = (typeof IMPORT_MEMORY_SOURCES)[number];

export const ATOMIC_MEMORY_SOURCES = [
  "chatgpt",
  "claude",
  "gemini",
  "grok_bot",
  "pasted",
  "chat",
  "voice",
] as const;

export type AtomicMemorySource = (typeof ATOMIC_MEMORY_SOURCES)[number];

export const ORDERED_MEMORY_CATEGORIES: readonly CanonicalMemoryCategory[] = [
  "rules",
  "preferences",
  "about_me",
  "family",
  "work",
  "projects",
] as const;

export const MEMORY_CATEGORY_LABELS: Record<
  "en" | "tr",
  Record<CanonicalMemoryCategory, string>
> = {
  en: {
    rules: "Rules",
    preferences: "Preferences",
    about_me: "About me",
    family: "Family",
    work: "Work",
    projects: "Projects",
  },
  tr: {
    rules: "Kurallar",
    preferences: "Tercihler",
    about_me: "Hakkımda",
    family: "Aile",
    work: "İş",
    projects: "Projeler",
  },
};

export type SensitiveMemoryReason =
  | "password"
  | "card_number"
  | "address"
  | "korn_ferry_data";

export type SkippedSensitiveLine = {
  id: string;
  preview: string;
  reason: SensitiveMemoryReason;
};

export type ParsedMemoryCandidate = {
  id: string;
  key: string;
  value: string;
  category: CanonicalMemoryCategory;
  pinned: boolean;
};

export type MemoryImportPreviewItem = ParsedMemoryCandidate & {
  isDuplicate: boolean;
  duplicateReason?: "existing" | "paste_repeat";
  checked: boolean;
};

export type MemoryImportPreviewResult = {
  items: MemoryImportPreviewItem[];
  skippedSensitive: SkippedSensitiveLine[];
};

const BULLET_PREFIX_RE =
  /^\s*(?:[-*•◦▪‣⁃–—➤→]+|\[\s*[xX ]?\s*\]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/u;

const HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const DIVIDER_RE = /^\s*(?:[-*_]\s*){3,}$/;

export function normalizeMemoryCategory(
  raw?: string | null
): CanonicalMemoryCategory {
  const c = (raw ?? "").trim().toLowerCase();
  if (c === "rules" || c === "rule") {
    return "rules";
  }
  if (c === "preferences" || c === "preference") {
    return "preferences";
  }
  if (c === "family") {
    return "family";
  }
  if (c === "work") {
    return "work";
  }
  if (c === "projects" || c === "project") {
    return "projects";
  }
  return "about_me";
}

export function defaultPinnedForCategory(
  category: CanonicalMemoryCategory
): boolean {
  return category === "rules" || category === "preferences";
}

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

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Detects passwords/secrets, payment card numbers, or physical street/postal
 * addresses so they are NEVER stored in assistant memory.
 * Ordinary city/country/timezone facts (e.g. "I live in London") pass cleanly.
 */
export function detectSensitiveMemoryContent(
  raw: string
): SensitiveMemoryReason | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  // 1. Passwords, PINs, recovery phrases, or raw API secret tokens
  if (
    /\b(?:my\s+)?(?:password|passcode|passphrase|pin\s*(?:code|number)|secret\s*key|api\s*key|private\s*key|recovery\s*(?:code|phrase)|seed\s*phrase)\b\s*(?:is|are|=|:|-|->|\bfor\b)/iu.test(
      text
    ) ||
    /(?<![\p{L}])(?:password|passcode|şifre\p{L}*|parola\p{L}*)\s*(?:is|=|:)\s*\S+/iu.test(
      text
    ) ||
    /(?<![\p{L}])(?:şifrem|parolam|pin\s*kodum)(?![\p{L}])/iu.test(text) ||
    /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{25,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/.test(
      text
    )
  ) {
    return "password";
  }

  // 2. Payment card numbers (13–19 digits with Luhn or card context) or CVV/CVC
  if (/\b(?:cvv|cvc)\s*[:=]?\s*\d{3,4}\b/i.test(text)) {
    return "card_number";
  }
  const candidateCardMatches = text.match(/(?:\d[ -]?){13,19}/g) ?? [];
  for (const candidate of candidateCardMatches) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19) {
      const hasCardKeyword =
        /\b(?:card|visa|mastercard|amex|debit|credit|pan|kart|kredi)\b/iu.test(
          text
        );
      if (passesLuhn(digits) || hasCardKeyword) {
        return "card_number";
      }
    }
  }

  // 3. Physical street / home / postal addresses (excluding general city/timezone)
  // UK postcode (e.g. SW1A 1AA, EC2M 7PP, NW1 6XE)
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/i.test(text)) {
    return "address";
  }
  // Explicit address declaration
  if (
    /\b(?:my\s+(?:home\s+|street\s+|billing\s+|shipping\s+|postal\s+)?address\s*(?:is|:)|(?:home|street|delivery|billing|postal)\s+address\s*:|ev\s+adres\p{L}*|açık\s+adres\p{L}*)/iu.test(
      text
    )
  ) {
    return "address";
  }
  // Street number + street name + suffix (EN) or Flat/Apt + number
  if (
    /\b\d{1,5}[A-Za-z]?\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Close|Drive|Dr\.?|Boulevard|Blvd\.?|Court|Ct\.?|Terrace|Crescent)\b/u.test(
      text
    ) ||
    /\b(?:Flat|Apt\.?|Apartment|Unit)\s+\d+[A-Za-z]?\s*,/i.test(text) ||
    /\b(?:mahallesi|mah\.|sokağı|sokak|sok\.|caddesi|cadde|cad\.)\b.*\b(?:no\s*[:.]?\s*\d+|daire\s*[:.]?\s*\d+)/iu.test(
      text
    )
  ) {
    return "address";
  }

  return null;
}

export function maskSensitivePreview(raw: string): string {
  const cleaned = raw.trim().replace(BULLET_PREFIX_RE, "");
  const maskedSecrets = cleaned
    .replace(
      /((?:password|passcode|passphrase|pin(?:\s*(?:code|number))?|secret\s*key|api\s*key|private\s*key|şifre\p{L}*|parola\p{L}*)\s*(?:is|are|=|:|-|->)\s*)\S+/giu,
      "$1••••••••"
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
      "••••••••"
    )
    .replace(/(?:\d[ -]?){6,}/g, "•••• ");
  return maskedSecrets.length > 64
    ? `${maskedSecrets.slice(0, 61)}…`
    : maskedSecrets;
}

const FORBIDDEN_KF_DATA_TOKENS_RE =
  /(?<![\p{L}])(?:hay[\s_-]*group|sa90|eosb|gl[\s_-]*\d+|239300|sox|sap\b|gaap|ifrs|accrual\p{L}*|trial\s+balance|reconcil\p{L}*|ledger|journal|invoice\p{L}*|billing|revenue\p{L}*|margin\p{L}*|ebitda|profit|loss|budget|forecast|variance|payroll|headcount|salary|bonus|compensation|fee\b|fees\b|contract\p{L}*|client\p{L}*|engagement\p{L}*|proposal|pitch|deck|spreadsheet|workbook|xlsx|pdf|confidential|secret|internal\s+only|audit\p{L}*|close\b|closing|month[- ]end|quarter[- ]end|year[- ]end|q[1-4]\b|fy\d{2,4}|provision\p{L}*|receivable\p{L}*|payable\p{L}*|tax\b|vat\b|zakat|wht\b|intercompany|ic\s+revenue|mizan\p{L}*|tahakkuk\p{L}*|mutabakat\p{L}*|fatura\p{L}*|gelir\p{L}*|bütçe\p{L}*|müşteri\p{L}*|sözleşme\p{L}*|denetim\p{L}*|kapanış\p{L}*|maaş\p{L}*|bordro\p{L}*)(?![\p{L}])|[$£€₺]|\b(?:usd|gbp|eur|sar|aed|qar|try)\s*\d|\b\d[\d,.]*\s*(?:m|mn|k|bn|million|thousand|usd|gbp|eur|sar|aed)\b/iu;

const ALLOWED_KF_ROLE_OR_REGION_RE =
  /(?<![\p{L}])(?:work\p{L}*|role\p{L}*|title|position|employ\p{L}*|lead\p{L}*|head\b|director\p{L}*|controller\p{L}*|vp\b|vice\s+president|manager\p{L}*|cfo|finance|regional|region\p{L}*|mena|emea|apac|latam|middle\s+east|north\s+africa|gcc|uae|dubai|abu\s+dhabi|saudi|ksa|riyadh|qatar|doha|kuwait|bahrain|oman|egypt|turkey|türkiye|istanbul|uk\b|london|çalış\p{L}*|görev\p{L}*|pozisyon\p{L}*|ünvan\p{L}*|unvan\p{L}*|direktör\p{L}*|kontrolör\p{L}*|finans\p{L}*|bölge\p{L}*|orta\s*doğu)(?![\p{L}])/iu;

const ANY_KF_MENTION_RE = /\bkorn[\s_-]*ferry\b/iu;

/**
 * Returns true ONLY when a Korn Ferry mention is strictly a short biographical
 * context line (job title / role / regions covered) with zero financial,
 * accounting, audit, SOX, EOSB, SA90, GL, SAP, client, or document content.
 */
export function isAllowedShortKornFerryContextFact(raw: string): boolean {
  const cleaned = raw.trim().replace(BULLET_PREFIX_RE, "").trim();
  if (
    !cleaned ||
    cleaned.length < 10 ||
    cleaned.length > 180 ||
    /[\r\n]/.test(cleaned)
  ) {
    return false;
  }
  if (!ANY_KF_MENTION_RE.test(cleaned)) {
    return false;
  }
  if (FORBIDDEN_KF_DATA_TOKENS_RE.test(cleaned)) {
    return false;
  }
  // Block multi-digit numbers (except 4-digit calendar years 2010..2035 for role tenure)
  const numericTokens = cleaned.match(/\d+/g) ?? [];
  for (const num of numericTokens) {
    const n = Number(num);
    if (!(num.length === 4 && n >= 2010 && n <= 2035)) {
      return false;
    }
  }
  return ALLOWED_KF_ROLE_OR_REGION_RE.test(cleaned);
}

export function maskKornFerryPreview(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(BULLET_PREFIX_RE, "")
    .replace(/\s+/g, " ")
    .replace(/(?:\d[.,]?)+/g, "••");
  return cleaned.length > 58 ? `${cleaned.slice(0, 55)}…` : cleaned;
}

export type KornFerryMemoryClassification =
  | { kind: "none" }
  | { kind: "short_context"; fact: string }
  | {
      kind: "partial_short_context";
      fact: string;
      skippedPreview: string;
    }
  | { kind: "blocked_kf_data"; skippedPreview: string };

/**
 * Classifies a statement for Korn Ferry / employer governance:
 * - Non-KF text -> `none`
 * - Short role/region context line -> `short_context`
 * - Compound line with a safe role/region clause + restricted KF details ->
 *   keeps ONLY the short role/region sentence and flags the stripped details
 * - Any KF accounting/SOX/EOSB/SA90/financial/document line -> `blocked_kf_data`
 */
export function classifyKornFerryMemoryFact(
  raw: string
): KornFerryMemoryClassification {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: "none" };
  }
  const hasKfOrRestricted =
    containsRestrictedWorkData(trimmed) || ANY_KF_MENTION_RE.test(trimmed);
  if (!hasKfOrRestricted) {
    return { kind: "none" };
  }

  if (isAllowedShortKornFerryContextFact(trimmed)) {
    return {
      kind: "short_context",
      fact: toSelfContainedSentence(trimmed),
    };
  }

  // Check if a compound statement has a clean short role/region clause before
  // restricted KF details (e.g. separated by `;`, `—`, ` - `, or `. `)
  const clauses = trimmed
    .split(/(?:\s+[—–-]\s+|;\s*|\.\s+|\r?\n)/u)
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    const safeClause = clauses.find((c) =>
      isAllowedShortKornFerryContextFact(c)
    );
    if (safeClause) {
      const rest = clauses.filter((c) => c !== safeClause).join("; ");
      return {
        kind: "partial_short_context",
        fact: toSelfContainedSentence(safeClause),
        skippedPreview: maskKornFerryPreview(rest || trimmed),
      };
    }
  }

  return {
    kind: "blocked_kf_data",
    skippedPreview: maskKornFerryPreview(trimmed),
  };
}

/**
 * Validates whether a candidate durable `ProfileFact` must be blocked from
 * storage (passwords, card numbers, street addresses, or restricted KF data
 * beyond short job-title/region context lines).
 */
export function detectDisallowedProfileFactReason(
  raw: string
): SensitiveMemoryReason | null {
  const personalSecret = detectSensitiveMemoryContent(raw);
  if (personalSecret) {
    return personalSecret;
  }
  const kf = classifyKornFerryMemoryFact(raw);
  if (kf.kind === "blocked_kf_data" || kf.kind === "partial_short_context") {
    return "korn_ferry_data";
  }
  return null;
}

/**
 * Ensures each extracted fact reads as one clean, self-contained sentence.
 */
export function toSelfContainedSentence(raw: string): string {
  const cleaned = raw.replace(BULLET_PREFIX_RE, "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const firstChar = cleaned[0] ?? "";
  const capitalized =
    firstChar === firstChar.toLowerCase() &&
    firstChar !== firstChar.toUpperCase()
      ? `${firstChar.toUpperCase()}${cleaned.slice(1)}`
      : cleaned;
  if (/[.!?…]$/.test(capitalized)) {
    return capitalized;
  }
  return `${capitalized}.`;
}

function parseHeadingCategory(heading: string): CanonicalMemoryCategory | null {
  const h = heading.toLowerCase();
  if (/rule|policy|never|always|guardrail|kural|ilke|yasak/.test(h)) {
    return "rules";
  }
  if (/prefer|style|tone|format|tercih|üslup|tarz/.test(h)) {
    return "preferences";
  }
  if (/family|kids|children|wife|husband|daughter|son|aile|çocuk|eş/.test(h)) {
    return "family";
  }
  if (/work|role|career|office|job|iş|kariyer|görev|şirket/.test(h)) {
    return "work";
  }
  if (/project|code|tech|app|repo|proje|kod|uygulama/.test(h)) {
    return "projects";
  }
  if (/about|identity|personal|me|hakkımda|kimlik|kişisel/.test(h)) {
    return "about_me";
  }
  return null;
}

export function inferMemoryCategory(
  value: string,
  headingHint?: CanonicalMemoryCategory | null
): CanonicalMemoryCategory {
  if (headingHint) {
    return headingHint;
  }
  const text = value.toLowerCase();
  if (
    /\b(never|must not|do not|don't ever|strictly|standing rule|rule:|always ask before|only on request)\b|asla|kesinlikle|kural:|onay almadan|ücretli model/u.test(
      text
    )
  ) {
    return "rules";
  }
  if (
    /\b(daughter|son|wife|husband|partner|spouse|child|children|kids|mother|father|sister|brother|family|gcse)\b|kızım\p{L}*|oğlum\p{L}*|eşim\p{L}*|annem|babam|kardeşim|aile\p{L}*/u.test(
      text
    )
  ) {
    return "family";
  }
  if (
    /\b(repo|github|vercel|nextjs|next\.js|typescript|tailscale|mac mini|cloud vm|gcp|vertex|deploy|branch|streamvault|tizen|project)\b|proje\p{L}*|uygulama\p{L}*|sunucu\p{L}*/u.test(
      text
    )
  ) {
    return "projects";
  }
  if (
    /\b(prefer|concise|brief|tone|format|bullet|dark mode|light mode|aisle seat|window seat|coffee|tea|sugar)\b|tercih|kısa ve net|özet|üslup|tarz|kahve\p{L}*|çay\p{L}*|şekersiz/u.test(
      text
    )
  ) {
    return "preferences";
  }
  if (
    /\b(finance controller|colleague|stakeholder|board|audit|month-end|quarter-end|workplace|career|role|office|salary|reporting currency)\b|iş\b|ofis|toplantı|ekip|denetim|kapanış/u.test(
      text
    )
  ) {
    return "work";
  }
  return "about_me";
}

function splitIntoSentences(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length <= 140) {
    return [trimmed];
  }
  const parts = trimmed
    .split(/(?<=[.!?])\s+(?=[\p{Lu}])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (parts.length <= 1 || parts.some((p) => p.length < 10)) {
    return [trimmed];
  }
  return parts;
}

/**
 * Splits a pasted list (bullets, numbered lines, plain lines, or paragraphs)
 * into clean single-sentence facts while skipping & flagging sensitive lines.
 */
export function parsePastedMemoryInput(
  raw: string,
  maxItems = 250
): {
  candidates: ParsedMemoryCandidate[];
  skippedSensitive: SkippedSensitiveLine[];
} {
  const lines = raw.split(/\r?\n/);
  const candidates: ParsedMemoryCandidate[] = [];
  const skippedSensitive: SkippedSensitiveLine[] = [];
  let activeHeadingCategory: CanonicalMemoryCategory | null = null;

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

    const cleaned = trimmed.replace(BULLET_PREFIX_RE, "").trim();
    if (cleaned.length < 2) {
      continue;
    }

    const segments = splitIntoSentences(cleaned);
    for (const seg of segments) {
      const sensitive = detectSensitiveMemoryContent(seg);
      if (sensitive) {
        skippedSensitive.push({
          id: `sens_${skippedSensitive.length}`,
          preview: maskSensitivePreview(seg),
          reason: sensitive,
        });
        continue;
      }

      const kfClass = classifyKornFerryMemoryFact(seg);
      if (kfClass.kind === "blocked_kf_data") {
        skippedSensitive.push({
          id: `sens_${skippedSensitive.length}`,
          preview: kfClass.skippedPreview,
          reason: "korn_ferry_data",
        });
        continue;
      }
      if (kfClass.kind === "partial_short_context") {
        skippedSensitive.push({
          id: `sens_${skippedSensitive.length}`,
          preview: kfClass.skippedPreview,
          reason: "korn_ferry_data",
        });
      }

      const sentence = (
        kfClass.kind === "short_context" ||
        kfClass.kind === "partial_short_context"
          ? kfClass.fact
          : toSelfContainedSentence(seg)
      ).slice(0, 1500);
      if (sentence.length < 3) {
        continue;
      }
      const key = deriveFactKey(sentence);
      const category =
        kfClass.kind === "short_context" ||
        kfClass.kind === "partial_short_context"
          ? "work"
          : inferMemoryCategory(sentence, activeHeadingCategory);
      candidates.push({
        id: `${key}_${candidates.length}`,
        key,
        value: sentence,
        category,
        pinned: defaultPinnedForCategory(category),
      });
      if (candidates.length >= maxItems) {
        return { candidates, skippedSensitive };
      }
    }
  }

  return { candidates, skippedSensitive };
}

export function splitPastedMemoryList(
  raw: string,
  maxItems = 250
): ParsedMemoryCandidate[] {
  return parsePastedMemoryInput(raw, maxItems).candidates;
}

/**
 * Splits pasted text into self-contained facts, strips sensitive lines with
 * warnings, and marks duplicates against existing saved memories.
 */
export function prepareMemoryImportPreview(
  raw: string,
  existingFacts: readonly Pick<ProfileFact, "key" | "value">[]
): MemoryImportPreviewResult {
  const existingKeys = new Set(existingFacts.map((f) => f.key.toLowerCase()));
  const existingNormalized = new Set(
    existingFacts
      .map((f) => normalizeMemoryComparisonText(f.value))
      .filter(Boolean)
  );

  const seenInPaste = new Set<string>();
  const { candidates, skippedSensitive } = parsePastedMemoryInput(raw);

  const items = candidates.map((item) => {
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
        ? ("existing" as const)
        : inPaste
          ? ("paste_repeat" as const)
          : undefined,
      checked: !isDuplicate,
    };
  });

  return { items, skippedSensitive };
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

export type ExplicitRememberParseResult =
  | {
      kind: "ok";
      key: string;
      value: string;
      category: CanonicalMemoryCategory;
      pinned: boolean;
    }
  | {
      kind: "sensitive_blocked";
      reason: SensitiveMemoryReason;
    }
  | null;

/**
 * Extracts an explicit single-turn `"remember this: …"` / `"bunu hatırla: …"`
 * directive from chat or voice transcripts, blocking passwords/cards/addresses.
 */
export function extractExplicitRememberFact(
  text: string
): ExplicitRememberParseResult {
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
      const sensitive = detectSensitiveMemoryContent(captured);
      if (sensitive) {
        return { kind: "sensitive_blocked", reason: sensitive };
      }
      const kfClass = classifyKornFerryMemoryFact(captured);
      if (kfClass.kind === "blocked_kf_data") {
        return { kind: "sensitive_blocked", reason: "korn_ferry_data" };
      }
      const sentence =
        kfClass.kind === "short_context" ||
        kfClass.kind === "partial_short_context"
          ? kfClass.fact
          : toSelfContainedSentence(captured);
      const category =
        kfClass.kind === "short_context" ||
        kfClass.kind === "partial_short_context"
          ? "work"
          : inferMemoryCategory(sentence);
      return {
        kind: "ok",
        key: deriveFactKey(sentence),
        value: sentence,
        category,
        pinned: defaultPinnedForCategory(category),
      };
    }
  }
  return null;
}

const CATEGORY_QUERY_HINTS: Record<CanonicalMemoryCategory, RegExp> = {
  rules: /\b(rule|rules|policy|allowed|never|always)\b|kural|ilke/iu,
  preferences:
    /\b(prefer|preference|style|format|like|coffee|flight|seat)\b|tercih|üslup|tarz/iu,
  about_me:
    /\b(who am i|about me|where do i live|my city|timezone|remember about me)\b|hakkımda|nerede yaşıyorum|kimim/iu,
  family:
    /\b(family|daughter|son|wife|husband|partner|kids|children|ece)\b|aile|kızım|oğlum|eşim/iu,
  work: /\b(work|job|role|office|team|audit|close)\b|işim|görevim|ofis/iu,
  projects:
    /\b(project|projects|repo|app|deploy|tailscale|mac mini|vm|streamvault)\b|proje|uygulama|sunucu/iu,
};

/**
 * Selects facts for a session prompt:
 * 1. ALL `pinned === true` facts are ALWAYS included.
 * 2. `pinned === false` ("Searchable") facts are pulled in when relevant to
 *    `queryText` (keyword overlap or category intent; or when queryText is empty
 *    such as Live Voice session startup, top recent searchable facts up to budget).
 */
export function selectRelevantFactsForPrompt(
  facts: readonly ProfileFact[],
  queryText = "",
  maxTotalFacts = 80,
  maxChars = 6000
): ProfileFact[] {
  if (facts.length === 0) {
    return [];
  }

  const chosen: ProfileFact[] = [];
  const chosenIds = new Set<string>();
  let usedChars = 0;

  const tryAdd = (fact: ProfileFact): boolean => {
    if (chosenIds.has(fact.id) || chosen.length >= maxTotalFacts) {
      return false;
    }
    const cost = fact.value.length + 12;
    if (usedChars + cost > maxChars && chosen.length > 0) {
      return false;
    }
    chosen.push(fact);
    chosenIds.add(fact.id);
    usedChars += cost;
    return true;
  };

  // 1. Always include pinned facts first (in category priority order)
  const categoryRank = (cat: CanonicalMemoryCategory) =>
    ORDERED_MEMORY_CATEGORIES.indexOf(normalizeMemoryCategory(cat));

  const pinnedFacts = facts
    .filter((f) => f.pinned)
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  for (const pf of pinnedFacts) {
    tryAdd(pf);
  }

  // 2. Pull in relevant searchable (`!pinned`) facts
  const searchable = facts.filter((f) => !f.pinned);
  if (searchable.length === 0) {
    return chosen;
  }

  const trimmedQuery = queryText.trim();
  const asksBroadPersonalRecall =
    !trimmedQuery ||
    /\b(what do you (?:know|remember)|about me|my profile|my memories)\b|hakkımda ne|belleğimde ne/iu.test(
      trimmedQuery
    );

  const queryWords = new Set(
    normalizeMemoryComparisonText(trimmedQuery)
      .split(" ")
      .filter((w) => w.length >= 3)
  );

  const scoredSearchable = searchable
    .map((fact, idx) => {
      let score = 0;
      if (queryWords.size > 0) {
        const factWords = normalizeMemoryComparisonText(
          `${fact.key} ${fact.value}`
        ).split(" ");
        for (const fw of factWords) {
          if (queryWords.has(fw)) {
            score += 2;
          }
        }
      }
      const normCat = normalizeMemoryCategory(fact.category);
      if (trimmedQuery && CATEGORY_QUERY_HINTS[normCat]?.test(trimmedQuery)) {
        score += 1;
      }
      if (asksBroadPersonalRecall) {
        score += 1;
      }
      return { fact, score, idx };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  for (const { fact } of scoredSearchable) {
    tryAdd(fact);
  }

  return chosen;
}

/**
 * Formats selected owner facts grouped by category with Rules and Preferences
 * strictly first, for injection into chat and voice session system prompts.
 */
export function buildGroupedMemoryPromptBlock(
  facts: readonly ProfileFact[],
  queryText = "",
  opts?: { maxFacts?: number; maxChars?: number }
): string {
  const selected = selectRelevantFactsForPrompt(
    facts,
    queryText,
    opts?.maxFacts ?? 80,
    opts?.maxChars ?? 6000
  );
  if (selected.length === 0) {
    return "";
  }

  const grouped = new Map<CanonicalMemoryCategory, ProfileFact[]>();
  for (const cat of ORDERED_MEMORY_CATEGORIES) {
    grouped.set(cat, []);
  }
  for (const fact of selected) {
    const cat = normalizeMemoryCategory(fact.category);
    grouped.get(cat)?.push(fact);
  }

  const sections: string[] = [
    "Owner durable memory (self-contained facts; Rules and Preferences take priority):",
  ];
  for (const cat of ORDERED_MEMORY_CATEGORIES) {
    const items = grouped.get(cat) ?? [];
    if (items.length === 0) {
      continue;
    }
    sections.push(`### ${MEMORY_CATEGORY_LABELS.en[cat]}`);
    for (const item of items) {
      sections.push(`- ${item.value}`);
    }
  }
  return sections.join("\n");
}

const SINGLE_SOURCE_LABELS: Record<
  "en" | "tr",
  Record<AtomicMemorySource, string>
> = {
  en: {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    grok_bot: "Grok Bot",
    pasted: "Pasted",
    chat: "Chat",
    voice: "Voice",
  },
  tr: {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    grok_bot: "Grok Bot",
    pasted: "Yapıştırıldı",
    chat: "Sohbet",
    voice: "Ses",
  },
};

function normalizeAtomicSource(raw: string): AtomicMemorySource | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "chatgpt" || s === "openai") {
    return "chatgpt";
  }
  if (s === "claude" || s === "anthropic") {
    return "claude";
  }
  if (s === "gemini" || s === "google") {
    return "gemini";
  }
  if (s === "grok_bot" || s === "grokbot" || s === "grok") {
    return "grok_bot";
  }
  if (s === "pasted" || s === "paste" || s === "other" || s === "imported") {
    return "pasted";
  }
  if (s === "voice") {
    return "voice";
  }
  if (s === "chat") {
    return "chat";
  }
  return null;
}

export function normalizeMemorySource(
  raw?: string | null,
  fallback: AtomicMemorySource = "chat"
): MemorySource {
  if (!raw?.trim()) {
    return fallback;
  }
  const parts = raw
    .split("+")
    .map((p) => normalizeAtomicSource(p))
    .filter((p): p is AtomicMemorySource => p !== null);
  const unique = [...new Set(parts)];
  if (unique.length === 0) {
    return fallback;
  }
  return unique.join("+").slice(0, 64);
}

export function joinMemorySources(
  sources: readonly string[],
  fallback: AtomicMemorySource = "pasted"
): MemorySource {
  const normalized = sources
    .flatMap((s) => s.split("+"))
    .map((s) => normalizeAtomicSource(s))
    .filter((s): s is AtomicMemorySource => s !== null);
  const unique = [...new Set(normalized)].sort(
    (a, b) =>
      ATOMIC_MEMORY_SOURCES.indexOf(a) - ATOMIC_MEMORY_SOURCES.indexOf(b)
  );
  if (unique.length === 0) {
    return fallback;
  }
  return unique.join("+").slice(0, 64);
}

export function inferImportSourceFromFileName(
  fileName: string
): ImportMemorySource {
  const lower = fileName.toLowerCase();
  if (lower.includes("chatgpt") || lower.includes("openai")) {
    return "chatgpt";
  }
  if (lower.includes("claude") || lower.includes("anthropic")) {
    return "claude";
  }
  if (lower.includes("gemini") || lower.includes("takeout")) {
    return "gemini";
  }
  if (lower.includes("grok")) {
    return "grok_bot";
  }
  return "pasted";
}

export function formatMemorySourceLabel(
  source: MemorySource,
  lang: "en" | "tr" = "en"
): string {
  const parts = String(source ?? "")
    .split("+")
    .map((p) => normalizeAtomicSource(p))
    .filter((p): p is AtomicMemorySource => p !== null);
  const unique = [...new Set(parts)];
  if (unique.length === 0) {
    return SINGLE_SOURCE_LABELS[lang].chat;
  }
  return unique.map((p) => SINGLE_SOURCE_LABELS[lang][p]).join(" + ");
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
    lines.push(`## Durable Facts (${facts.length})`, "");
    for (const cat of ORDERED_MEMORY_CATEGORIES) {
      const items = facts.filter(
        (f) => normalizeMemoryCategory(f.category) === cat
      );
      if (items.length === 0) {
        continue;
      }
      lines.push(`### ${MEMORY_CATEGORY_LABELS.en[cat]}`);
      for (const item of items) {
        const learnedDate = item.learnedAt.slice(0, 10);
        const mode = item.pinned ? "pinned" : "searchable";
        lines.push(
          `- ${item.value} _(source: ${item.source}, learned: ${learnedDate}, ${mode})_`
        );
      }
      lines.push("");
    }
  } else {
    lines.push("## Durable Facts (0)", "", "_No saved memories yet._", "");
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
