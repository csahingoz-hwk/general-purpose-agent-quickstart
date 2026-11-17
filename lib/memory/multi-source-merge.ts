import { z } from "zod";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  classifyKornFerryMemoryFact,
  defaultPinnedForCategory,
  deriveFactKey,
  detectDisallowedProfileFactReason,
  detectSensitiveMemoryContent,
  type ImportMemorySource,
  inferMemoryCategory,
  isAllowedShortKornFerryContextFact,
  joinMemorySources,
  maskSensitivePreview,
  normalizeMemoryCategory,
  normalizeMemoryComparisonText,
  normalizeMemorySource,
  type SkippedSensitiveLine,
  toSelfContainedSentence,
} from "@/lib/memory/bulk-import";
import type {
  CanonicalMemoryCategory,
  MemorySource,
  ProfileFact,
} from "@/lib/memory/store";

export type RawMemoryExportSource = {
  id?: string;
  source: ImportMemorySource;
  rawText: string;
  fileName?: string;
  exportedAt?: string;
};

export type MergedConflictOption = {
  fact: string;
  source: MemorySource;
  observedAt: string | null;
  isNewest: boolean;
};

export type MergedMemoryPreviewStatus =
  | "new"
  | "merged"
  | "conflict"
  | "already_saved";

export type MergedMemoryPreviewItem = {
  id: string;
  key: string;
  value: string;
  category: CanonicalMemoryCategory;
  pinned: boolean;
  source: MemorySource;
  sources: MemorySource[];
  learnedAt: string | null;
  status: MergedMemoryPreviewStatus;
  checked: boolean;
  conflictTopic?: string;
  conflictOptions?: MergedConflictOption[];
  selectedOptionIndex?: number;
  mergedOriginals?: string[];
  replaceFactId?: string;
};

export type MultiSourceMergeCounts = {
  newCount: number;
  mergedCount: number;
  conflictCount: number;
  skippedSensitiveCount: number;
  alreadySavedCount: number;
};

export type MultiSourceMergeResult = {
  items: MergedMemoryPreviewItem[];
  counts: MultiSourceMergeCounts;
  skippedSensitive: SkippedSensitiveLine[];
  modelUsed: "gemini-4-argon" | "gemini-4-hydrogen" | "local-deterministic";
};

type ExtractedCandidateStatement = {
  idx: number;
  source: ImportMemorySource;
  sourceOrder: number;
  observedAt: string | null;
  headingHint: CanonicalMemoryCategory | null;
  text: string;
};

const BULLET_PREFIX_RE =
  /^\s*(?:[-*•◦▪‣⁃–—➤→]+|\[\s*[xX ]?\s*\]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/u;
const HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const BOLD_HEADING_RE = /^\s*\*\*([^*]{2,48}?)\*\*\s*:?\s*$/;
const DIVIDER_RE = /^\s*(?:[-*_]\s*){3,}$/;
const GROK_EXPORT_META_RE =
  /\s*_\(\s*source:\s*([^,)]+?)(?:,\s*learned:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}))?(?:,\s*(pinned|searchable))?\s*\)_\s*$/iu;
const LEADING_DATE_PREFIX_RE =
  /^\s*(?:\[(\d{4}-\d{2}-\d{2})\]|\((\d{4}-\d{2}-\d{2})\)|(?:updated|added|saved|learned|tarih|eklendi|güncellendi)\s*[:\-–]?\s*(\d{4}-\d{2}-\d{2})\s*[:\-–]?|(\d{4}-\d{2}-\d{2})\s*[:\-–])\s*(.+)$/iu;
const INLINE_YEAR_RE = /\b(20[1-3]\d)\b/g;

function normalizeIsoDateOrNull(raw?: string | number | null): string | null {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  if (typeof raw === "number") {
    // Seconds vs milliseconds epoch
    const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const str = String(raw).trim();
  if (!str) {
    return null;
  }
  if (/^\d{10,13}$/.test(str)) {
    return normalizeIsoDateOrNull(Number(str));
  }
  const parsed = Date.parse(str);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function parseHeadingHint(heading: string): CanonicalMemoryCategory | null {
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

function splitParagraphIntoSentences(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length <= 150) {
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

type RawExtractedLine = {
  text: string;
  observedAt: string | null;
  headingHint: CanonicalMemoryCategory | null;
};

function extractFromJsonNode(
  node: unknown,
  fallbackDate: string | null,
  acc: RawExtractedLine[],
  headingHint: CanonicalMemoryCategory | null = null
): void {
  if (acc.length >= 400 || node === null || node === undefined) {
    return;
  }
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (trimmed.length >= 3) {
      acc.push({ text: trimmed, observedAt: fallbackDate, headingHint });
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      extractFromJsonNode(item, fallbackDate, acc, headingHint);
    }
    return;
  }
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    const itemDate =
      normalizeIsoDateOrNull(
        (record.updated_at ??
          record.updatedAt ??
          record.learnedAt ??
          record.learned_at ??
          record.created_at ??
          record.createdAt ??
          record.timestamp ??
          record.date) as string | number | undefined
      ) ?? fallbackDate;
    const catHint =
      typeof record.category === "string"
        ? normalizeMemoryCategory(record.category)
        : headingHint;

    const textField =
      record.memory ??
      record.fact ??
      record.value ??
      record.content ??
      record.text ??
      record.summary ??
      record.conversations_memory;

    if (typeof textField === "string" && textField.trim()) {
      // A JSON field like Claude's `conversations_memory` may itself be multi-line Markdown
      const nestedLines = extractRawLinesFromText(textField, itemDate);
      for (const nl of nestedLines) {
        acc.push({
          text: nl.text,
          observedAt: nl.observedAt ?? itemDate,
          headingHint: nl.headingHint ?? catHint,
        });
      }
      return;
    }

    for (const [k, v] of Object.entries(record)) {
      if (
        k === "id" ||
        k === "uuid" ||
        k === "user_id" ||
        k === "userId" ||
        k === "status"
      ) {
        continue;
      }
      const keyCategory = parseHeadingHint(k) ?? catHint;
      extractFromJsonNode(v, itemDate, acc, keyCategory);
    }
  }
}

function parseSimpleCsvLines(
  raw: string,
  fallbackDate: string | null
): RawExtractedLine[] | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return null;
  }
  const headerCols = (lines[0] ?? "")
    .split(",")
    .map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
  const textIdx = headerCols.findIndex((c) =>
    ["memory", "fact", "value", "content", "text", "bilgi", "not"].includes(c)
  );
  if (textIdx === -1 || headerCols.length < 2) {
    return null;
  }
  const dateIdx = headerCols.findIndex((c) =>
    [
      "date",
      "updated_at",
      "created_at",
      "learnedat",
      "learned_at",
      "tarih",
    ].includes(c)
  );
  const catIdx = headerCols.findIndex((c) =>
    ["category", "kategori", "type"].includes(c)
  );

  const out: RawExtractedLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i] ?? "";
    const cols =
      row
        .match(/("([^"]|"")*"|[^,]+)/g)
        ?.map((c) => c.trim().replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    const val = cols[textIdx]?.trim();
    if (!val || val.length < 3) {
      continue;
    }
    const rowDate =
      dateIdx !== -1 ? normalizeIsoDateOrNull(cols[dateIdx]) : null;
    const rowCat =
      catIdx !== -1 && cols[catIdx]
        ? normalizeMemoryCategory(cols[catIdx])
        : null;
    out.push({
      text: val,
      observedAt: rowDate ?? fallbackDate,
      headingHint: rowCat,
    });
  }
  return out.length > 0 ? out : null;
}

function extractRawLinesFromText(
  raw: string,
  fallbackDate: string | null
): RawExtractedLine[] {
  const trimmedWhole = raw.trim();
  if (!trimmedWhole) {
    return [];
  }

  // 1. JSON array / object export (ChatGPT / Claude / Gemini Takeout / custom)
  if (trimmedWhole.startsWith("{") || trimmedWhole.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmedWhole) as unknown;
      const jsonLines: RawExtractedLine[] = [];
      extractFromJsonNode(parsed, fallbackDate, jsonLines);
      if (jsonLines.length > 0) {
        return jsonLines;
      }
    } catch {
      // Fall through to plain-text / Markdown parsing
    }
  }

  // 2. CSV export with header row
  const csvResult = parseSimpleCsvLines(trimmedWhole, fallbackDate);
  if (csvResult) {
    return csvResult;
  }

  // 3. Markdown / Grok Bot / ChatGPT / Claude / Gemini bulleted or paragraph text
  const out: RawExtractedLine[] = [];
  let activeHeading: CanonicalMemoryCategory | null = null;
  let exportHeaderDate = fallbackDate;

  for (const rawLine of trimmedWhole.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || DIVIDER_RE.test(trimmed)) {
      continue;
    }
    // Skip boilerplate export header lines while capturing top-level `Exported: ...` date
    const exportedHeaderMatch = trimmed.match(
      /^(?:exported|date|updated|dışa aktarıldı)\s*:\s*(.+)$/iu
    );
    if (exportedHeaderMatch?.[1]) {
      const hdrIso = normalizeIsoDateOrNull(exportedHeaderMatch[1]);
      if (hdrIso) {
        exportHeaderDate = hdrIso;
        continue;
      }
    }
    if (
      /^#\s*personal assistant memory export$/i.test(trimmed) ||
      /^##\s*durable facts\s*\(\d+\)$/i.test(trimmed) ||
      /^_no saved memories yet\._$/i.test(trimmed)
    ) {
      continue;
    }

    const mdHeading = trimmed.match(HEADING_RE)?.[1];
    if (mdHeading) {
      activeHeading = parseHeadingHint(mdHeading);
      continue;
    }
    const boldHeading = trimmed.match(BOLD_HEADING_RE)?.[1];
    if (boldHeading) {
      activeHeading = parseHeadingHint(boldHeading);
      continue;
    }

    let cleaned = trimmed.replace(BULLET_PREFIX_RE, "").trim();
    let lineDate = exportHeaderDate;

    // Strip Grok Bot export suffix `_(source: ..., learned: YYYY-MM-DD, pinned)_`
    const grokMeta = cleaned.match(GROK_EXPORT_META_RE);
    if (grokMeta) {
      if (grokMeta[2]) {
        lineDate = normalizeIsoDateOrNull(grokMeta[2]) ?? lineDate;
      }
      cleaned = cleaned.replace(GROK_EXPORT_META_RE, "").trim();
    }

    // Strip leading date prefix `[2026-10-14] ...` or `2026-10-14: ...`
    const datePrefix = cleaned.match(LEADING_DATE_PREFIX_RE);
    if (datePrefix) {
      const capturedDate =
        datePrefix[1] ?? datePrefix[2] ?? datePrefix[3] ?? datePrefix[4];
      const restText = datePrefix[5]?.trim();
      if (capturedDate && restText) {
        lineDate = normalizeIsoDateOrNull(capturedDate) ?? lineDate;
        cleaned = restText;
      }
    }

    if (cleaned.length < 3) {
      continue;
    }

    for (const seg of splitParagraphIntoSentences(cleaned)) {
      if (seg.trim().length >= 3) {
        out.push({
          text: seg.trim(),
          observedAt: lineDate,
          headingHint: activeHeading,
        });
      }
    }
  }

  return out;
}

function recencyRankForCandidate(c: {
  observedAt: string | null;
  text: string;
  sourceOrder: number;
}): number {
  if (c.observedAt) {
    const ts = Date.parse(c.observedAt);
    if (!Number.isNaN(ts)) {
      return ts + c.sourceOrder;
    }
  }
  // Extract latest explicit calendar year inside text (e.g. 2026 > 2024)
  const years = [...c.text.matchAll(INLINE_YEAR_RE)].map((m) => Number(m[1]));
  if (years.length > 0) {
    const maxYear = Math.max(...years);
    return Date.UTC(maxYear, 6, 1) + c.sourceOrder;
  }
  // Fall back to source slot order (later slot = newer)
  return 1_000_000 + c.sourceOrder * 1000;
}

function extractKfRoleSignature(sentence: string): string {
  const lower = sentence.toLowerCase();
  const canonicalBuckets: readonly [string, readonly string[]][] = [
    ["cfo", ["cfo", "chief financial officer"]],
    ["vp", ["vice president", "vp", "başkan yardımcısı"]],
    ["senior_director", ["senior director", "kıdemli direktör"]],
    ["director", ["director", "direktör"]],
    ["controller", ["controller", "kontrolör"]],
    ["manager", ["manager", "müdür", "yönetici"]],
    ["head", ["head", "lead", "lider"]],
    ["analyst", ["analyst", "analist"]],
  ];
  for (const [bucket, aliases] of canonicalBuckets) {
    if (aliases.some((alias) => lower.includes(alias))) {
      return bucket;
    }
  }
  return "role";
}

/**
 * Merges short Korn Ferry job-title/region context lines 100% locally so ZERO
 * Korn Ferry text ever leaves for Vertex during multi-source merge.
 */
function mergeShortKornFerryCandidatesLocally(
  kfCandidates: readonly ExtractedCandidateStatement[],
  existingFacts: readonly ProfileFact[]
): MergedMemoryPreviewItem[] {
  if (kfCandidates.length === 0) {
    return [];
  }

  const existingKfFacts = existingFacts.filter((f) =>
    isAllowedShortKornFerryContextFact(f.value)
  );

  // Order newest first
  const ordered = [...kfCandidates].sort(
    (a, b) => recencyRankForCandidate(b) - recencyRankForCandidate(a)
  );

  // Check if distinct role levels conflict across sources (e.g. Manager vs Director/Controller)
  const distinctRoles = new Map<string, ExtractedCandidateStatement>();
  for (const cand of ordered) {
    const sig = extractKfRoleSignature(cand.text);
    if (!distinctRoles.has(sig)) {
      distinctRoles.set(sig, cand);
    }
  }

  const allSources = [
    ...new Set(ordered.map((c) => normalizeMemorySource(c.source, "pasted"))),
  ];
  const combinedSource = joinMemorySources(allSources, "pasted");
  const newest = ordered[0] as ExtractedCandidateStatement;
  const replaceExisting = existingKfFacts[0];

  if (distinctRoles.size >= 2) {
    const options: MergedConflictOption[] = [...distinctRoles.values()].map(
      (cand, idx) => ({
        fact: toSelfContainedSentence(cand.text),
        source: normalizeMemorySource(cand.source, "pasted"),
        observedAt: cand.observedAt,
        isNewest: idx === 0,
      })
    );
    const winningFact =
      options[0]?.fact ?? toSelfContainedSentence(newest.text);
    return [
      {
        id: `kf_conflict_${deriveFactKey(winningFact)}`,
        key: deriveFactKey(winningFact),
        value: winningFact,
        category: "work",
        pinned: false,
        source: options[0]?.source ?? combinedSource,
        sources: allSources,
        learnedAt: newest.observedAt,
        status: "conflict",
        checked: true,
        conflictTopic: "Work role / region context",
        conflictOptions: options,
        selectedOptionIndex: 0,
        mergedOriginals: ordered.map((c) => c.text),
        replaceFactId: replaceExisting?.id,
      },
    ];
  }

  // Pick richest allowed short context line (prefer English if mixed TR+EN and longest <= 180 chars)
  const englishCandidates = ordered.filter(
    (c) => !/[çğıöşüÇĞİÖŞÜ]|çalış|görev|bölge/u.test(c.text)
  );
  const bestPool = englishCandidates.length > 0 ? englishCandidates : ordered;
  const richest = [...bestPool].sort(
    (a, b) => b.text.length - a.text.length
  )[0] as ExtractedCandidateStatement;
  const normalizedSentence = toSelfContainedSentence(richest.text);
  const normText = normalizeMemoryComparisonText(normalizedSentence);

  const exactExisting = existingKfFacts.find(
    (f) => normalizeMemoryComparisonText(f.value) === normText
  );
  if (exactExisting && ordered.length === 1) {
    return [
      {
        id: `kf_saved_${exactExisting.id}`,
        key: exactExisting.key,
        value: exactExisting.value,
        category: "work",
        pinned: exactExisting.pinned,
        source: combinedSource,
        sources: allSources,
        learnedAt: newest.observedAt ?? exactExisting.learnedAt,
        status: "already_saved",
        checked: false,
        replaceFactId: exactExisting.id,
      },
    ];
  }

  const isMerged = ordered.length >= 2 || Boolean(replaceExisting);
  return [
    {
      id: `kf_${deriveFactKey(normalizedSentence)}`,
      key: deriveFactKey(normalizedSentence),
      value: normalizedSentence,
      category: "work",
      pinned: false,
      source: combinedSource,
      sources: allSources,
      learnedAt: newest.observedAt,
      status: isMerged ? "merged" : "new",
      checked: true,
      mergedOriginals: isMerged ? ordered.map((c) => c.text) : undefined,
      replaceFactId: replaceExisting?.id,
    },
  ];
}

const vertexMergedItemSchema = z.object({
  status: z.enum(["new", "merged", "conflict", "already_saved"]),
  fact: z.string().min(2).max(1500),
  category: z.enum([
    "rules",
    "preferences",
    "about_me",
    "family",
    "work",
    "projects",
  ]),
  candidateIndices: z.array(z.number().int().min(0)).min(1),
  existingFactId: z.string().nullable().optional(),
  conflictTopic: z.string().max(120).nullable().optional(),
  conflictOptions: z
    .array(
      z.object({
        fact: z.string().min(2).max(1500),
        candidateIndex: z.number().int().min(0).nullable().optional(),
        existingFactId: z.string().nullable().optional(),
        isNewest: z.boolean().optional(),
      })
    )
    .optional(),
});

const vertexMergePayloadSchema = z.object({
  items: z.array(vertexMergedItemSchema),
});

export type VertexMergeStructuredPayload = z.infer<
  typeof vertexMergePayloadSchema
>;

export const VERTEX_MERGE_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["new", "merged", "conflict", "already_saved"],
          },
          fact: {
            type: "string",
            description:
              "Normalized single self-contained sentence ending with a period. For conflicts, put the newest fact here.",
          },
          category: {
            type: "string",
            enum: [
              "rules",
              "preferences",
              "about_me",
              "family",
              "work",
              "projects",
            ],
          },
          candidateIndices: {
            type: "array",
            items: { type: "integer" },
            description:
              "0-based indices of imported candidate statements covered by this output item.",
          },
          existingFactId: {
            type: "string",
            nullable: true,
            description:
              "ID of an existing saved memory that this item matches, enriches, or supersedes, or null.",
          },
          conflictTopic: {
            type: "string",
            nullable: true,
            description:
              "Short 2-5 word topic label when status is conflict (e.g. 'Google AI tier' or 'Default model'), else null.",
          },
          conflictOptions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fact: { type: "string" },
                candidateIndex: { type: "integer", nullable: true },
                existingFactId: { type: "string", nullable: true },
                isNewest: { type: "boolean" },
              },
              required: ["fact", "isNewest"],
            },
          },
        },
        required: ["status", "fact", "category", "candidateIndices"],
      },
    },
  },
  required: ["items"],
};

function buildVertexMergePrompt(
  candidates: readonly ExtractedCandidateStatement[],
  existingFacts: readonly ProfileFact[]
): { system: string; user: string } {
  const system = [
    "You are an expert bilingual (English & Turkish) assistant memory consolidation engine.",
    "The owner is importing memory exports from multiple assistants (ChatGPT, Claude, Gemini, Grok Bot, pasted lists) in English and/or Turkish.",
    "Your job is to produce a clean, non-redundant list of durable owner facts:",
    "1. ONE-SENTENCE NORMALIZATION: Rewrite every item into ONE concise, self-contained sentence ending with a period (e.g. 'Lives in London in the Europe/London timezone.'). Preserve proper names (e.g. Çağlar, Ece), exact technical identifiers, and rule constraints. When duplicate items mix Turkish and English, unify them into one clear English sentence; if a unique item is only in Turkish or only in English, normalize it cleanly.",
    '2. MERGE DUPLICATES & NEAR-DUPLICATES (`status: "merged"`): Whenever 2 or more candidate items (across sources or within exports, including Turkish/English translations of the same fact) express the same fact or complementary parts of one single fact, combine them into ONE richest one-sentence fact with `status: "merged"` and list all their `candidateIndices`.',
    '   - If 1 candidate item enriches an existing saved memory with new detail, set `status: "merged"` and set `existingFactId` to that saved memory\'s ID.',
    '   - If candidate item(s) add ZERO new detail beyond an existing saved memory, set `status: "already_saved"` and `existingFactId`.',
    '3. DETECT CONFLICTS (`status: "conflict"`): Whenever two candidate items (or a candidate item vs an existing saved memory) state CONTRADICTORY values for the same attribute — such as different subscription tiers (Pro vs Ultra), different dates/years/school years (Year 9 vs Year 11, 2024 vs 2026), different default models, or conflicting preferences/rules:',
    '   - Set `status: "conflict"` and a short `conflictTopic`.',
    "   - Determine which version is NEWEST using `observedAt` ISO dates, explicit years in text, or higher `sourceOrder` (imported candidates are newer than older undated `existingMemories`).",
    "   - Put the NEWEST normalized one-sentence fact in `fact`, and populate `conflictOptions` ordered NEWEST FIRST (`isNewest: true` on index 0, `false` on older alternatives), each rewritten as a clean one-sentence fact with its `candidateIndex` (or `existingFactId`).",
    "   - If the conflict supersedes an existing saved memory, set `existingFactId` to that memory's ID.",
    '4. UNIQUE NEW FACTS (`status: "new"`): Any candidate item that is unique (1 candidate, not already saved, no conflict) gets `status: "new"`.',
    '5. CATEGORY ASSIGNMENT: Every item MUST have `category` in `["rules", "preferences", "about_me", "family", "work", "projects"]`.',
    "6. COVERAGE: Every candidate index `0..N-1` should be accounted for in at least one item's `candidateIndices`. Never invent facts not grounded in the inputs.",
  ].join("\n");

  const payload = {
    candidates: candidates.map((c) => ({
      idx: c.idx,
      source: c.source,
      sourceOrder: c.sourceOrder,
      observedAt: c.observedAt,
      headingHint: c.headingHint,
      text: c.text,
    })),
    existingMemories: existingFacts.slice(0, 150).map((f) => ({
      id: f.id,
      category: f.category,
      learnedAt: f.learnedAt,
      fact: f.value,
    })),
  };

  return {
    system,
    user: JSON.stringify(payload),
  };
}

/**
 * Local deterministic fallback used ONLY in offline unit tests when Vertex WIF
 * is not configured and no custom runner is injected.
 */
export function deterministicFallbackMerge(
  candidates: readonly ExtractedCandidateStatement[],
  existingFacts: readonly ProfileFact[]
): VertexMergeStructuredPayload {
  const existingByNorm = new Map<string, ProfileFact>();
  for (const f of existingFacts) {
    const n = normalizeMemoryComparisonText(f.value);
    if (n) {
      existingByNorm.set(n, f);
    }
  }

  const groups = new Map<string, ExtractedCandidateStatement[]>();
  for (const c of candidates) {
    const norm = normalizeMemoryComparisonText(c.text);
    const key = norm || `idx_${c.idx}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const items: VertexMergeStructuredPayload["items"] = [];
  for (const [norm, group] of groups.entries()) {
    const ordered = [...group].sort(
      (a, b) => recencyRankForCandidate(b) - recencyRankForCandidate(a)
    );
    const top = ordered[0] as ExtractedCandidateStatement;
    const sentence = toSelfContainedSentence(top.text);
    const category = inferMemoryCategory(sentence, top.headingHint);
    const existingMatch = existingByNorm.get(norm);
    const status: MergedMemoryPreviewStatus = existingMatch
      ? "already_saved"
      : group.length >= 2
        ? "merged"
        : "new";
    items.push({
      status,
      fact: sentence,
      category,
      candidateIndices: group.map((g) => g.idx),
      existingFactId: existingMatch?.id ?? null,
    });
  }

  return { items };
}

export type VertexMergeRunner = (input: {
  candidates: readonly ExtractedCandidateStatement[];
  existingFacts: readonly ProfileFact[];
  preferredModel: "gemini-4-argon" | "gemini-4-hydrogen";
}) => Promise<{
  payload: VertexMergeStructuredPayload;
  modelUsed: "gemini-4-argon" | "gemini-4-hydrogen" | "local-deterministic";
}>;

async function defaultVertexMergeRunner({
  candidates,
  existingFacts,
  preferredModel,
}: {
  candidates: readonly ExtractedCandidateStatement[];
  existingFacts: readonly ProfileFact[];
  preferredModel: "gemini-4-argon" | "gemini-4-hydrogen";
}): Promise<{
  payload: VertexMergeStructuredPayload;
  modelUsed: "gemini-4-argon" | "gemini-4-hydrogen" | "local-deterministic";
}> {
  const { vertexEnabled } = await import("@/lib/ai/routing/catalog");
  if (!vertexEnabled()) {
    return {
      payload: deterministicFallbackMerge(candidates, existingFacts),
      modelUsed: "local-deterministic",
    };
  }

  const { createVertexGeminiAdapter } = await import("@/lib/ai/vertex-model");
  const { system, user } = buildVertexMergePrompt(candidates, existingFacts);

  const modelsToTry: Array<"gemini-4-argon" | "gemini-4-hydrogen"> =
    preferredModel === "gemini-4-argon"
      ? ["gemini-4-argon", "gemini-4-hydrogen"]
      : ["gemini-4-hydrogen", "gemini-4-argon"];

  let lastError: unknown;
  for (const modelId of modelsToTry) {
    try {
      const adapter = createVertexGeminiAdapter(modelId);
      const res = await adapter.doGenerate({
        prompt: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "text", text: user }] },
        ],
        maxOutputTokens: 8192,
        temperature: 0.1,
        responseFormat: {
          type: "json",
          schema: VERTEX_MERGE_RESPONSE_JSON_SCHEMA,
        },
        providerOptions: {
          openai: { reasoningEffort: "medium" },
        },
      });
      const rawJsonText = res.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      const cleanedJson = rawJsonText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const parsed = vertexMergePayloadSchema.parse(JSON.parse(cleanedJson));
      return { payload: parsed, modelUsed: modelId };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Vertex memory merge failed");
}

const STATUS_DISPLAY_ORDER: Record<MergedMemoryPreviewStatus, number> = {
  conflict: 0,
  merged: 1,
  new: 2,
  already_saved: 3,
};

/**
 * Multi-source memory import & consolidation pipeline:
 * 1. Parses exports from 1..N tagged sources (JSON, Markdown, CSV, plain text, TR/EN).
 * 2. Strips passwords, card numbers, and street addresses BEFORE any model call.
 * 3. Handles Korn Ferry statements strictly locally (keeping ONLY short job-title/region
 *    context lines and blocking all KF financials/codes/documents; ZERO KF bytes go to Vertex).
 * 4. Consolidates all remaining facts via Gemini 4 Hydrogen/Argon on Vertex AI:
 *    one-sentence normalization, cross-source near-duplicate merging, conflict detection
 *    (keeping newest, flagging alternatives), and category assignment.
 */
export async function mergeMemoryExports(input: {
  sources: readonly RawMemoryExportSource[];
  existingFacts: readonly ProfileFact[];
  runner?: VertexMergeRunner;
}): Promise<MultiSourceMergeResult> {
  const skippedSensitive: SkippedSensitiveLine[] = [];
  const safeCandidates: ExtractedCandidateStatement[] = [];
  const shortKfCandidates: ExtractedCandidateStatement[] = [];

  for (let sIdx = 0; sIdx < input.sources.length; sIdx++) {
    const block = input.sources[sIdx];
    if (!block?.rawText?.trim()) {
      continue;
    }
    const blockDate = normalizeIsoDateOrNull(block.exportedAt);
    const extracted = extractRawLinesFromText(block.rawText, blockDate);

    for (const line of extracted) {
      const personalSecret = detectSensitiveMemoryContent(line.text);
      if (personalSecret) {
        skippedSensitive.push({
          id: `sens_${skippedSensitive.length}`,
          preview: maskSensitivePreview(line.text),
          reason: personalSecret,
        });
        continue;
      }

      const kfClass = classifyKornFerryMemoryFact(line.text);
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
        shortKfCandidates.push({
          idx: shortKfCandidates.length,
          source: block.source,
          sourceOrder: sIdx,
          observedAt: line.observedAt,
          headingHint: "work",
          text: kfClass.fact,
        });
        continue;
      }
      if (kfClass.kind === "short_context") {
        shortKfCandidates.push({
          idx: shortKfCandidates.length,
          source: block.source,
          sourceOrder: sIdx,
          observedAt: line.observedAt,
          headingHint: "work",
          text: kfClass.fact,
        });
        continue;
      }

      if (safeCandidates.length < 250) {
        safeCandidates.push({
          idx: safeCandidates.length,
          source: block.source,
          sourceOrder: sIdx,
          observedAt: line.observedAt,
          headingHint: line.headingHint,
          text: line.text.slice(0, 1500),
        });
      }
    }
  }

  // Merge short Korn Ferry role/region context lines strictly locally
  const localKfMergedItems = mergeShortKornFerryCandidatesLocally(
    shortKfCandidates,
    input.existingFacts
  );

  // Filter existing facts sent to Vertex so zero Korn Ferry text ever enters Vertex merge prompt
  const nonKfExistingFacts = input.existingFacts.filter(
    (f) =>
      !containsRestrictedWorkData(`${f.key} ${f.value}`) &&
      !/\bkorn[\s_-]*ferry\b/iu.test(f.value)
  );
  const existingById = new Map(nonKfExistingFacts.map((f) => [f.id, f]));

  let modelUsed:
    | "gemini-4-argon"
    | "gemini-4-hydrogen"
    | "local-deterministic" = "local-deterministic";
  const vertexItems: MergedMemoryPreviewItem[] = [];

  if (safeCandidates.length > 0) {
    const distinctSourceCount = new Set(safeCandidates.map((c) => c.source))
      .size;
    const preferredModel: "gemini-4-argon" | "gemini-4-hydrogen" =
      distinctSourceCount >= 3 || safeCandidates.length > 20
        ? "gemini-4-argon"
        : "gemini-4-hydrogen";

    const runMerge = input.runner ?? defaultVertexMergeRunner;
    const mergeOut = await runMerge({
      candidates: safeCandidates,
      existingFacts: nonKfExistingFacts,
      preferredModel,
    });
    modelUsed = mergeOut.modelUsed;

    const coveredIndices = new Set<number>();

    for (let i = 0; i < mergeOut.payload.items.length; i++) {
      const rawItem = mergeOut.payload.items[i];
      if (!rawItem) {
        continue;
      }
      const validCands = rawItem.candidateIndices
        .map((idx) => safeCandidates[idx])
        .filter((c): c is ExtractedCandidateStatement => Boolean(c));
      if (validCands.length === 0) {
        continue;
      }
      for (const vc of validCands) {
        coveredIndices.add(vc.idx);
      }

      const sentence = toSelfContainedSentence(rawItem.fact).slice(0, 1500);
      const postDisallowed = detectDisallowedProfileFactReason(sentence);
      if (postDisallowed) {
        skippedSensitive.push({
          id: `sens_${skippedSensitive.length}`,
          preview: maskSensitivePreview(sentence),
          reason: postDisallowed,
        });
        continue;
      }

      const category = normalizeMemoryCategory(rawItem.category);
      const matchedExisting = rawItem.existingFactId
        ? existingById.get(rawItem.existingFactId)
        : undefined;

      const sortedCands = [...validCands].sort(
        (a, b) => recencyRankForCandidate(b) - recencyRankForCandidate(a)
      );
      const newestCand = sortedCands[0] as ExtractedCandidateStatement;
      const itemSources = [
        ...new Set(
          sortedCands.map((c) => normalizeMemorySource(c.source, "pasted"))
        ),
      ];
      if (matchedExisting && rawItem.status === "merged") {
        const exSrc = normalizeMemorySource(matchedExisting.source, "chat");
        if (!itemSources.includes(exSrc)) {
          itemSources.push(exSrc);
        }
      }
      const combinedSource = joinMemorySources(itemSources, "pasted");

      if (rawItem.status === "conflict") {
        const rawOptions = rawItem.conflictOptions ?? [];
        const options: MergedConflictOption[] = [];
        for (const opt of rawOptions) {
          const optSentence = toSelfContainedSentence(opt.fact).slice(0, 1500);
          if (
            !optSentence ||
            detectDisallowedProfileFactReason(optSentence) !== null
          ) {
            continue;
          }
          const optCand =
            opt.candidateIndex !== null && opt.candidateIndex !== undefined
              ? safeCandidates[opt.candidateIndex]
              : undefined;
          const optExisting = opt.existingFactId
            ? existingById.get(opt.existingFactId)
            : undefined;
          options.push({
            fact: optSentence,
            source: optCand
              ? normalizeMemorySource(optCand.source, "pasted")
              : optExisting
                ? normalizeMemorySource(optExisting.source, "chat")
                : combinedSource,
            observedAt: optCand?.observedAt ?? optExisting?.learnedAt ?? null,
            isNewest: Boolean(opt.isNewest),
          });
        }

        // Ensure at least 2 clean options ordered with newest first
        if (options.length < 2 && sortedCands.length >= 2) {
          options.length = 0;
          for (const [oIdx, cand] of sortedCands.slice(0, 3).entries()) {
            options.push({
              fact: toSelfContainedSentence(cand.text),
              source: normalizeMemorySource(cand.source, "pasted"),
              observedAt: cand.observedAt,
              isNewest: oIdx === 0,
            });
          }
        }
        options.sort((a, b) => Number(b.isNewest) - Number(a.isNewest));
        if (options[0]) {
          options[0].isNewest = true;
        }
        const winning = options[0];
        const finalFact = winning?.fact ?? sentence;

        vertexItems.push({
          id: `mrg_${i}_${deriveFactKey(finalFact)}`,
          key: deriveFactKey(finalFact),
          value: finalFact,
          category,
          pinned: matchedExisting?.pinned ?? defaultPinnedForCategory(category),
          source: winning?.source ?? combinedSource,
          sources: itemSources,
          learnedAt: winning?.observedAt ?? newestCand.observedAt,
          status: "conflict",
          checked: true,
          conflictTopic: rawItem.conflictTopic ?? undefined,
          conflictOptions: options.length >= 2 ? options : undefined,
          selectedOptionIndex: 0,
          mergedOriginals: sortedCands.map((c) => c.text),
          replaceFactId: matchedExisting?.id,
        });
        continue;
      }

      const effectiveStatus: MergedMemoryPreviewStatus =
        rawItem.status === "already_saved" && matchedExisting
          ? "already_saved"
          : rawItem.status === "merged" ||
              validCands.length >= 2 ||
              Boolean(matchedExisting)
            ? "merged"
            : "new";

      vertexItems.push({
        id: `mrg_${i}_${deriveFactKey(sentence)}`,
        key:
          effectiveStatus === "already_saved" && matchedExisting
            ? matchedExisting.key
            : deriveFactKey(sentence),
        value: sentence,
        category,
        pinned: matchedExisting?.pinned ?? defaultPinnedForCategory(category),
        source: combinedSource,
        sources: itemSources,
        learnedAt: newestCand.observedAt ?? matchedExisting?.learnedAt ?? null,
        status: effectiveStatus,
        checked: effectiveStatus !== "already_saved",
        mergedOriginals:
          effectiveStatus === "merged"
            ? sortedCands.map((c) => c.text)
            : undefined,
        replaceFactId:
          effectiveStatus === "merged" ? matchedExisting?.id : undefined,
      });
    }

    // Safety net: ensure any candidate index omitted by the model is never silently lost
    for (const cand of safeCandidates) {
      if (coveredIndices.has(cand.idx)) {
        continue;
      }
      const sentence = toSelfContainedSentence(cand.text).slice(0, 1500);
      if (!sentence || detectDisallowedProfileFactReason(sentence) !== null) {
        continue;
      }
      const norm = normalizeMemoryComparisonText(sentence);
      const alreadyInOutput = vertexItems.some(
        (vi) => normalizeMemoryComparisonText(vi.value) === norm
      );
      if (alreadyInOutput) {
        continue;
      }
      const existingMatch = nonKfExistingFacts.find(
        (ef) => normalizeMemoryComparisonText(ef.value) === norm
      );
      const cat = inferMemoryCategory(sentence, cand.headingHint);
      const src = normalizeMemorySource(cand.source, "pasted");
      vertexItems.push({
        id: `mrg_uncov_${cand.idx}_${deriveFactKey(sentence)}`,
        key: existingMatch?.key ?? deriveFactKey(sentence),
        value: sentence,
        category: cat,
        pinned: existingMatch?.pinned ?? defaultPinnedForCategory(cat),
        source: src,
        sources: [src],
        learnedAt: cand.observedAt,
        status: existingMatch ? "already_saved" : "new",
        checked: !existingMatch,
      });
    }
  }

  const combinedItems = [...localKfMergedItems, ...vertexItems].sort((a, b) => {
    const statusDiff =
      STATUS_DISPLAY_ORDER[a.status] - STATUS_DISPLAY_ORDER[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return 0;
  });

  const counts: MultiSourceMergeCounts = {
    newCount: combinedItems.filter((i) => i.status === "new").length,
    mergedCount: combinedItems.filter((i) => i.status === "merged").length,
    conflictCount: combinedItems.filter((i) => i.status === "conflict").length,
    skippedSensitiveCount: skippedSensitive.length,
    alreadySavedCount: combinedItems.filter((i) => i.status === "already_saved")
      .length,
  };

  return {
    items: combinedItems,
    counts,
    skippedSensitive,
    modelUsed,
  };
}
