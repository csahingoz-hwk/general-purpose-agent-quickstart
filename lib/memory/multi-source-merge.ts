import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
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

export type FailedMergeChunk = {
  chunkNumber: number;
  totalChunks: number;
  lineCount: number;
  preview: string;
  retryText: string;
  error: string;
};

export type MergeProgressEvent = {
  completedChunks: number;
  totalChunks: number;
  activeChunk: number;
};

export type MergeModelUsed =
  | "gemini-4-argon"
  | "gemini-4-hydrogen"
  | "claude-haiku-5.5"
  | "local-deterministic";

export type MultiSourceMergeResult = {
  items: MergedMemoryPreviewItem[];
  counts: MultiSourceMergeCounts;
  skippedSensitive: SkippedSensitiveLine[];
  modelUsed: MergeModelUsed;
  chunksTotal?: number;
  chunksSucceeded?: number;
  failedChunks?: FailedMergeChunk[];
};

export type ExtractedCandidateStatement = {
  idx: number;
  source: ImportMemorySource;
  sourceOrder: number;
  observedAt: string | null;
  headingHint: CanonicalMemoryCategory | null;
  text: string;
};

export const DEFAULT_MERGE_CHUNK_CHARS = 7200;
export const DEFAULT_MERGE_CHUNK_MAX_ITEMS = 60;
const MERGE_CONCURRENCY = 3;

const BULLET_PREFIX_RE =
  /^\s*(?:[-*•◦▪‣⁃–—➤→]+|\[\s*[xX ]?\s*\]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/u;
const HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const BOLD_HEADING_RE = /^\s*\*\*([^*]{2,64}?)\*\*\s*:?\s*$/;
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

/**
 * Splits multi-sentence paragraphs (such as Claude narrative memory exports)
 * into clean individual statements without abandoning the split when an
 * abbreviation or short fragment appears.
 */
function splitParagraphIntoSentences(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length <= 140) {
    return [trimmed];
  }
  const rawParts = trimmed
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const stitched: string[] = [];
  for (const part of rawParts) {
    if (stitched.length > 0 && part.length < 12) {
      stitched[stitched.length - 1] = `${stitched.at(-1)} ${part}`;
    } else if (stitched.length > 0 && (stitched.at(-1)?.length ?? 0) < 12) {
      stitched[stitched.length - 1] = `${stitched.at(-1)} ${part}`;
    } else {
      stitched.push(part);
    }
  }

  const expanded: string[] = [];
  for (const seg of stitched.length > 0 ? stitched : [trimmed]) {
    if (seg.length > 420 && seg.includes("; ")) {
      for (const sub of seg.split(/;\s+/)) {
        if (sub.trim().length >= 4) {
          expanded.push(sub.trim());
        }
      }
    } else {
      expanded.push(seg);
    }
  }
  return expanded.length > 0 ? expanded : [trimmed];
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
  if (acc.length >= 1200 || node === null || node === undefined) {
    return;
  }
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (trimmed.length >= 3) {
      for (const seg of splitParagraphIntoSentences(trimmed)) {
        if (seg.trim().length >= 3) {
          acc.push({
            text: seg.trim(),
            observedAt: fallbackDate,
            headingHint,
          });
        }
      }
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

  const csvResult = parseSimpleCsvLines(trimmedWhole, fallbackDate);
  if (csvResult) {
    return csvResult;
  }

  const out: RawExtractedLine[] = [];
  let activeHeading: CanonicalMemoryCategory | null = null;
  let exportHeaderDate = fallbackDate;

  for (const rawLine of trimmedWhole.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || DIVIDER_RE.test(trimmed)) {
      continue;
    }
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

    const grokMeta = cleaned.match(GROK_EXPORT_META_RE);
    if (grokMeta) {
      if (grokMeta[2]) {
        lineDate = normalizeIsoDateOrNull(grokMeta[2]) ?? lineDate;
      }
      cleaned = cleaned.replace(GROK_EXPORT_META_RE, "").trim();
    }

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
  const years = [...c.text.matchAll(INLINE_YEAR_RE)].map((m) => Number(m[1]));
  if (years.length > 0) {
    const maxYear = Math.max(...years);
    return Date.UTC(maxYear, 6, 1) + c.sourceOrder;
  }
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

  const ordered = [...kfCandidates].sort(
    (a, b) => recencyRankForCandidate(b) - recencyRankForCandidate(a)
  );

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
  conflictTopic: z.string().max(200).nullable().optional(),
  conflictOptions: z
    .array(
      z.object({
        fact: z.string().min(2).max(1500),
        candidateIndex: z.number().int().min(0).nullable().optional(),
        existingFactId: z.string().nullable().optional(),
        isNewest: z.boolean().nullable().optional(),
      })
    )
    .nullable()
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
    existingMemories: existingFacts.slice(0, 80).map((f) => ({
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
  modelUsed: MergeModelUsed;
}>;

function parseStructuredMergeOutput(
  rawText: string
): VertexMergeStructuredPayload {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      rawParsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } else {
      throw new Error(
        "Invalid structured JSON returned from memory merge model"
      );
    }
  }

  if (
    rawParsed &&
    typeof rawParsed === "object" &&
    Array.isArray((rawParsed as { items?: unknown }).items)
  ) {
    const validItems: z.infer<typeof vertexMergedItemSchema>[] = [];
    for (const entry of (rawParsed as { items: unknown[] }).items) {
      if (entry && typeof entry === "object") {
        const mut = { ...(entry as Record<string, unknown>) };
        if (typeof mut.fact === "string" && mut.fact.length > 1500) {
          mut.fact = mut.fact.slice(0, 1500);
        }
        if (
          typeof mut.conflictTopic === "string" &&
          mut.conflictTopic.length > 200
        ) {
          mut.conflictTopic = mut.conflictTopic.slice(0, 200);
        }
        const check = vertexMergedItemSchema.safeParse(mut);
        if (check.success) {
          validItems.push(check.data);
        }
      }
    }
    return { items: validItems };
  }

  return vertexMergePayloadSchema.parse(rawParsed);
}

export type MergeTextGenerator = {
  doGenerate: (params: LanguageModelV4CallOptions) => PromiseLike<{
    content: ReadonlyArray<
      { type: string; text?: string } | Record<string, unknown>
    >;
  }>;
};

/**
 * Per-chunk resilient model chain:
 * 1) `gemini-4-hydrogen` (`low` effort, `maxOutputTokens: 16384`, `timeoutMs: 45s`)
 * 2) Retry once on `gemini-4-hydrogen`
 * 3) Escalate to `gemini-4-argon` (`medium` effort, `maxOutputTokens: 16384`, `timeoutMs: 55s`)
 * 4) Fallback to `claude-haiku-5.5` via GitHub Copilot SDK on Cloud VM bridge
 */
export function createResilientChunkMergeRunner(deps?: {
  hasVertex?: boolean;
  hasCopilot?: boolean;
  createVertexModel?: (
    modelId: "gemini-4-hydrogen" | "gemini-4-argon",
    opts: { timeoutMs: number }
  ) => MergeTextGenerator;
  createCopilotModel?: (opts: { timeoutMs: number }) => MergeTextGenerator;
}): VertexMergeRunner {
  return async ({ candidates, existingFacts }) => {
    const catalog =
      deps?.hasVertex === undefined || deps?.hasCopilot === undefined
        ? await import("@/lib/ai/routing/catalog")
        : null;
    const hasVertex = deps?.hasVertex ?? catalog?.vertexEnabled() ?? false;
    const hasCopilot =
      deps?.hasCopilot ?? catalog?.copilotFallbackEnabled() ?? false;

    if (!hasVertex && !hasCopilot) {
      return {
        payload: deterministicFallbackMerge(candidates, existingFacts),
        modelUsed: "local-deterministic",
      };
    }

    const { system, user } = buildVertexMergePrompt(candidates, existingFacts);
    const prompt = [
      { role: "system" as const, content: system },
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: user }],
      },
    ];

    let lastError: unknown;

    if (hasVertex) {
      const buildVertex =
        deps?.createVertexModel ??
        (await import("@/lib/ai/vertex-model")).createVertexGeminiAdapter;
      const vertexPlan: ReadonlyArray<{
        modelId: "gemini-4-hydrogen" | "gemini-4-argon";
        effort: "low" | "medium";
        timeoutMs: number;
      }> = [
        { modelId: "gemini-4-hydrogen", effort: "low", timeoutMs: 45_000 },
        { modelId: "gemini-4-hydrogen", effort: "low", timeoutMs: 45_000 },
        { modelId: "gemini-4-argon", effort: "medium", timeoutMs: 55_000 },
      ];

      for (const step of vertexPlan) {
        try {
          const adapter = buildVertex(step.modelId, {
            timeoutMs: step.timeoutMs,
          });
          const res = await adapter.doGenerate({
            prompt,
            maxOutputTokens: 16_384,
            temperature: 0.1,
            responseFormat: {
              type: "json",
              schema: VERTEX_MERGE_RESPONSE_JSON_SCHEMA,
            },
            providerOptions: {
              openai: { reasoningEffort: step.effort },
            },
          });
          const rawJsonText = res.content
            .map((part) =>
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string"
                ? part.text
                : ""
            )
            .join("");
          const parsed = parseStructuredMergeOutput(rawJsonText);
          return { payload: parsed, modelUsed: step.modelId };
        } catch (err) {
          lastError = err;
        }
      }
    }

    if (hasCopilot) {
      try {
        const buildCopilot =
          deps?.createCopilotModel ??
          (await import("@/lib/ai/copilot-vm-model"))
            .createCopilotHaikuVmAdapter;
        const copilot = buildCopilot({ timeoutMs: 45_000 });
        const res = await copilot.doGenerate({
          prompt,
          maxOutputTokens: 8192,
          responseFormat: {
            type: "json",
            schema: VERTEX_MERGE_RESPONSE_JSON_SCHEMA,
          },
        });
        const rawJsonText = res.content
          .map((part) =>
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
              ? part.text
              : ""
          )
          .join("");
        const parsed = parseStructuredMergeOutput(rawJsonText);
        return { payload: parsed, modelUsed: "claude-haiku-5.5" };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Memory merge failed across Vertex and Copilot fallback");
  };
}

const defaultVertexMergeRunner: VertexMergeRunner =
  createResilientChunkMergeRunner();

type DedupedCandidateGroup = {
  rep: ExtractedCandidateStatement;
  memberIndices: number[];
};

function preDedupeCandidatesLocally(
  candidates: readonly ExtractedCandidateStatement[]
): DedupedCandidateGroup[] {
  const byNorm = new Map<string, ExtractedCandidateStatement[]>();
  for (const cand of candidates) {
    const norm = normalizeMemoryComparisonText(cand.text);
    const key = norm && norm.length >= 6 ? norm : `__idx_${cand.idx}`;
    const bucket = byNorm.get(key) ?? [];
    bucket.push(cand);
    byNorm.set(key, bucket);
  }

  const out: DedupedCandidateGroup[] = [];
  for (const members of byNorm.values()) {
    const ordered = [...members].sort(
      (a, b) => recencyRankForCandidate(b) - recencyRankForCandidate(a)
    );
    const rep = ordered[0] as ExtractedCandidateStatement;
    out.push({
      rep,
      memberIndices: members.map((m) => m.idx),
    });
  }
  return out;
}

export type CandidateMergeChunk = {
  chunkIndex: number;
  groups: DedupedCandidateGroup[];
  chunkCandidates: ExtractedCandidateStatement[];
  charCount: number;
};

/**
 * Splits pre-deduped candidates into ~6.8k-char chunks (<=36 candidates/chunk).
 * When multiple chunks are needed, groups candidates by inferred category first
 * so related statements across/within exports land in the same chunk.
 */
export function chunkCandidatesForMerge(
  groups: readonly DedupedCandidateGroup[],
  opts?: { maxChunkChars?: number; maxChunkItems?: number }
): CandidateMergeChunk[] {
  if (groups.length === 0) {
    return [];
  }
  const maxChars = Math.max(
    1200,
    opts?.maxChunkChars ?? DEFAULT_MERGE_CHUNK_CHARS
  );
  const maxItems = Math.max(
    5,
    opts?.maxChunkItems ?? DEFAULT_MERGE_CHUNK_MAX_ITEMS
  );

  const totalRawChars = groups.reduce(
    (sum, g) => sum + JSON.stringify(g.rep).length,
    0
  );
  const needsMultiChunk = totalRawChars > maxChars || groups.length > maxItems;

  const orderedGroups = needsMultiChunk
    ? [...groups].sort((a, b) => {
        const catA = inferMemoryCategory(a.rep.text, a.rep.headingHint);
        const catB = inferMemoryCategory(b.rep.text, b.rep.headingHint);
        if (catA !== catB) {
          return catA.localeCompare(catB);
        }
        return a.rep.idx - b.rep.idx;
      })
    : [...groups];

  const chunks: CandidateMergeChunk[] = [];
  let current: DedupedCandidateGroup[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const chunkIndex = chunks.length;
    chunks.push({
      chunkIndex,
      groups: current,
      chunkCandidates: current.map((g, localIdx) => ({
        ...g.rep,
        idx: localIdx,
      })),
      charCount: currentChars,
    });
    current = [];
    currentChars = 0;
  };

  for (const grp of orderedGroups) {
    const entryLen = JSON.stringify(grp.rep).length + 12;
    if (
      current.length > 0 &&
      (currentChars + entryLen > maxChars || current.length >= maxItems)
    ) {
      flush();
    }
    current.push(grp);
    currentChars += entryLen;
  }
  flush();

  return chunks;
}

const STATUS_DISPLAY_ORDER: Record<MergedMemoryPreviewStatus, number> = {
  conflict: 0,
  merged: 1,
  new: 2,
  already_saved: 3,
};

const MODEL_PRIORITY_RANK: Record<MergeModelUsed, number> = {
  "claude-haiku-5.5": 3,
  "gemini-4-argon": 2,
  "gemini-4-hydrogen": 1,
  "local-deterministic": 0,
};

export async function mergeMemoryExports(input: {
  sources: readonly RawMemoryExportSource[];
  existingFacts: readonly ProfileFact[];
  runner?: VertexMergeRunner;
  maxChunkChars?: number;
  maxChunkItems?: number;
  onProgress?: (event: MergeProgressEvent) => void;
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

      if (safeCandidates.length < 1200) {
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

  const localKfMergedItems = mergeShortKornFerryCandidatesLocally(
    shortKfCandidates,
    input.existingFacts
  );

  const nonKfExistingFacts = input.existingFacts.filter(
    (f) =>
      !containsRestrictedWorkData(`${f.key} ${f.value}`) &&
      !/\bkorn[\s_-]*ferry\b/iu.test(f.value)
  );
  const existingById = new Map(nonKfExistingFacts.map((f) => [f.id, f]));

  let modelUsed: MergeModelUsed = "local-deterministic";
  const vertexItems: MergedMemoryPreviewItem[] = [];
  const failedChunks: FailedMergeChunk[] = [];
  let chunksTotal = 0;
  let chunksSucceeded = 0;

  if (safeCandidates.length > 0) {
    const dedupedGroups = preDedupeCandidatesLocally(safeCandidates);
    const chunks = chunkCandidatesForMerge(dedupedGroups, {
      maxChunkChars: input.maxChunkChars,
      maxChunkItems: input.maxChunkItems,
    });
    chunksTotal = chunks.length;

    const distinctSourceCount = new Set(safeCandidates.map((c) => c.source))
      .size;
    const preferredModel: "gemini-4-argon" | "gemini-4-hydrogen" =
      chunks.length === 1 &&
      (distinctSourceCount >= 3 || safeCandidates.length > 20)
        ? "gemini-4-argon"
        : "gemini-4-hydrogen";

    const runMerge = input.runner ?? defaultVertexMergeRunner;
    const coveredGlobalIndices = new Set<number>();
    const failedGlobalIndices = new Set<number>();

    type ChunkOutcome =
      | {
          ok: true;
          chunk: CandidateMergeChunk;
          payload: VertexMergeStructuredPayload;
          modelUsed: MergeModelUsed;
        }
      | {
          ok: false;
          chunk: CandidateMergeChunk;
          error: string;
        };

    const outcomes: ChunkOutcome[] = new Array(chunks.length);
    let completedCount = 0;
    let cursor = 0;

    input.onProgress?.({
      completedChunks: 0,
      totalChunks: chunks.length,
      activeChunk: 1,
    });

    const workerCount = Math.min(MERGE_CONCURRENCY, chunks.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        for (;;) {
          const idx = cursor++;
          if (idx >= chunks.length) {
            return;
          }
          const chunk = chunks[idx] as CandidateMergeChunk;
          try {
            const res = await runMerge({
              candidates: chunk.chunkCandidates,
              existingFacts: nonKfExistingFacts,
              preferredModel,
            });
            outcomes[idx] = {
              ok: true,
              chunk,
              payload: res.payload,
              modelUsed: res.modelUsed,
            };
          } catch (err) {
            outcomes[idx] = {
              ok: false,
              chunk,
              error: err instanceof Error ? err.message : "chunk_merge_failed",
            };
          } finally {
            completedCount += 1;
            input.onProgress?.({
              completedChunks: completedCount,
              totalChunks: chunks.length,
              activeChunk: Math.min(chunks.length, completedCount + 1),
            });
          }
        }
      })
    );

    let firstChunkError: string | null = null;
    let itemSeq = 0;

    for (const outcome of outcomes) {
      if (!outcome) {
        continue;
      }
      if (!outcome.ok) {
        firstChunkError ??= outcome.error;
        const memberIds = outcome.chunk.groups.flatMap((g) => g.memberIndices);
        for (const mId of memberIds) {
          failedGlobalIndices.add(mId);
        }
        const rawLines = outcome.chunk.groups.map((g) => `- ${g.rep.text}`);
        failedChunks.push({
          chunkNumber: outcome.chunk.chunkIndex + 1,
          totalChunks: chunks.length,
          lineCount: memberIds.length,
          preview:
            outcome.chunk.groups[0]?.rep.text.slice(0, 96) ?? "Memory section",
          retryText: rawLines.join("\n"),
          error: outcome.error,
        });
        continue;
      }

      chunksSucceeded += 1;
      if (
        MODEL_PRIORITY_RANK[outcome.modelUsed] > MODEL_PRIORITY_RANK[modelUsed]
      ) {
        modelUsed = outcome.modelUsed;
      }

      for (const rawItem of outcome.payload.items) {
        const globalIndices = rawItem.candidateIndices.flatMap(
          (localIdx) => outcome.chunk.groups[localIdx]?.memberIndices ?? []
        );
        const validCands = globalIndices
          .map((gIdx) => safeCandidates[gIdx])
          .filter((c): c is ExtractedCandidateStatement => Boolean(c));
        if (validCands.length === 0) {
          continue;
        }
        for (const vc of validCands) {
          coveredGlobalIndices.add(vc.idx);
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
        const seqId = itemSeq++;

        if (rawItem.status === "conflict") {
          const rawOptions = rawItem.conflictOptions ?? [];
          const options: MergedConflictOption[] = [];
          for (const opt of rawOptions) {
            const optSentence = toSelfContainedSentence(opt.fact).slice(
              0,
              1500
            );
            if (
              !optSentence ||
              detectDisallowedProfileFactReason(optSentence) !== null
            ) {
              continue;
            }
            const optGlobalIdx =
              opt.candidateIndex !== null && opt.candidateIndex !== undefined
                ? outcome.chunk.groups[opt.candidateIndex]?.memberIndices[0]
                : undefined;
            const optCand =
              optGlobalIdx !== undefined
                ? safeCandidates[optGlobalIdx]
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
            id: `mrg_${seqId}_${deriveFactKey(finalFact)}`,
            key: deriveFactKey(finalFact),
            value: finalFact,
            category,
            pinned:
              matchedExisting?.pinned ?? defaultPinnedForCategory(category),
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
          id: `mrg_${seqId}_${deriveFactKey(sentence)}`,
          key:
            effectiveStatus === "already_saved" && matchedExisting
              ? matchedExisting.key
              : deriveFactKey(sentence),
          value: sentence,
          category,
          pinned: matchedExisting?.pinned ?? defaultPinnedForCategory(category),
          source: combinedSource,
          sources: itemSources,
          learnedAt:
            newestCand.observedAt ?? matchedExisting?.learnedAt ?? null,
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
    }

    // Only throw if EVERY chunk failed and zero local items were produced
    if (chunksSucceeded === 0 && localKfMergedItems.length === 0) {
      throw new Error(firstChunkError ?? "All memory merge chunks failed");
    }

    // Safety net for candidates inside successful chunks omitted by the model
    for (const cand of safeCandidates) {
      if (
        coveredGlobalIndices.has(cand.idx) ||
        failedGlobalIndices.has(cand.idx)
      ) {
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

  // Cross-chunk deduplication in case two chunks emitted the same normalized fact
  const dedupedOutputByNorm = new Map<string, MergedMemoryPreviewItem>();
  for (const item of [...localKfMergedItems, ...vertexItems]) {
    const norm =
      item.status === "conflict"
        ? `__conflict_${item.id}`
        : normalizeMemoryComparisonText(item.value) || item.id;
    const prev = dedupedOutputByNorm.get(norm);
    if (!prev) {
      dedupedOutputByNorm.set(norm, item);
      continue;
    }
    const combinedSources = [...new Set([...prev.sources, ...item.sources])];
    dedupedOutputByNorm.set(norm, {
      ...prev,
      status: prev.status === "already_saved" ? "already_saved" : "merged",
      source: joinMemorySources(combinedSources, prev.source),
      sources: combinedSources,
      mergedOriginals: [
        ...new Set([
          ...(prev.mergedOriginals ?? [prev.value]),
          ...(item.mergedOriginals ?? [item.value]),
        ]),
      ],
    });
  }

  const combinedItems = [...dedupedOutputByNorm.values()].sort((a, b) => {
    const statusDiff =
      STATUS_DISPLAY_ORDER[a.status] - STATUS_DISPLAY_ORDER[b.status];
    return statusDiff !== 0 ? statusDiff : 0;
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
    chunksTotal,
    chunksSucceeded,
    ...(failedChunks.length > 0 ? { failedChunks } : {}),
  };
}
