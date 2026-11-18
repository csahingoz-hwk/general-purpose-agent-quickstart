import { inflateRawSync, inflateSync } from "node:zlib";
import Papa from "papaparse";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import type { ChatMessage } from "@/lib/types";
import type { ExportedPrivateFileMediaType } from "./attachment-validator";
import {
  extractTokenFromPrivateFileUrl,
  verifySignedFileToken,
} from "./signed-url";
import { getDefaultPrivateFileStore, type PrivateFileStore } from "./store";

export const MAX_EXTRACTED_ATTACHMENT_CHARS = 16_000;
const MAX_CSV_PREVIEW_ROWS = 120;
const MAX_CSV_COLUMNS = 40;
const MAX_PDF_INFLATE_BYTES = 16 * 1024 * 1024;
const MAX_PDF_STREAMS = 250;

export type ParsedAttachmentText = {
  fencedText: string;
  rawCharCount: number;
  truncated: boolean;
  suspicious: boolean;
  signals: string[];
};

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfe_ff ? text.slice(1) : text;
}

function escapeMarkdownCell(val: string): string {
  return val.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim().slice(0, 160);
}

function parseNumericCell(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed
    .replace(/^[£$€¥]\s*/, "")
    .replace(/,/g, "")
    .replace(/^\((.+)\)$/, "-$1");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function parseCsvBufferToText(
  bytes: Uint8Array,
  filename: string
): ParsedAttachmentText {
  const rawUtf8 = stripUtf8Bom(Buffer.from(bytes).toString("utf8"));
  const parsed = Papa.parse<string[]>(rawUtf8, {
    skipEmptyLines: "greedy",
  });

  const rows = parsed.data.filter(
    (row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim())
  );

  if (rows.length === 0) {
    const fenced = fenceUntrustedContent({
      text: "[CSV file contains no non-empty rows]",
      source: `attachment:csv:${filename}`,
      maxChars: MAX_EXTRACTED_ATTACHMENT_CHARS,
    });
    return {
      fencedText: fenced.fencedText,
      rawCharCount: 0,
      truncated: false,
      suspicious: fenced.suspicious,
      signals: fenced.signals,
    };
  }

  const headerRow = (rows[0] ?? [])
    .slice(0, MAX_CSV_COLUMNS)
    .map((col, idx) => {
      const cleaned = escapeMarkdownCell(String(col ?? ""));
      return cleaned || `col_${idx + 1}`;
    });
  const dataRows = rows.slice(1);
  const totalDataRows = dataRows.length;

  // Compute deterministic numeric column summaries across ALL data rows
  const numericSummaries: string[] = [];
  for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
    let count = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of dataRows) {
      const cellVal = parseNumericCell(String(row[colIdx] ?? ""));
      if (cellVal !== null) {
        count += 1;
        sum += cellVal;
        if (cellVal < min) {
          min = cellVal;
        }
        if (cellVal > max) {
          max = cellVal;
        }
      }
    }
    if (count > 0 && count >= Math.ceil(totalDataRows * 0.5)) {
      const roundedSum = Math.round(sum * 100) / 100;
      numericSummaries.push(
        `${headerRow[colIdx]}: count=${count}, sum=${roundedSum}, min=${min}, max=${max}`
      );
    }
  }

  const previewRows = dataRows.slice(0, MAX_CSV_PREVIEW_ROWS);
  const mdLines: string[] = [
    `CSV Attachment: ${filename}`,
    `Columns (${headerRow.length}): ${headerRow.join(", ")}`,
    `Total data rows: ${totalDataRows}`,
  ];
  if (numericSummaries.length > 0) {
    mdLines.push(
      `Numeric column summary (exact across all ${totalDataRows} rows):`
    );
    for (const summary of numericSummaries) {
      mdLines.push(`- ${summary}`);
    }
  }
  mdLines.push("");
  mdLines.push(`| ${headerRow.join(" | ")} |`);
  mdLines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);
  for (const row of previewRows) {
    const cells = headerRow.map((_, idx) =>
      escapeMarkdownCell(String(row[idx] ?? ""))
    );
    mdLines.push(`| ${cells.join(" | ")} |`);
  }
  if (totalDataRows > previewRows.length) {
    mdLines.push(
      `\n[Showing first ${previewRows.length} of ${totalDataRows} data rows]`
    );
  }

  const combined = mdLines.join("\n");
  const fenced = fenceUntrustedContent({
    text: combined,
    source: `attachment:csv:${filename}`,
    maxChars: MAX_EXTRACTED_ATTACHMENT_CHARS,
  });

  return {
    fencedText: fenced.fencedText,
    rawCharCount: combined.length,
    truncated: fenced.truncated || totalDataRows > previewRows.length,
    suspicious: fenced.suspicious,
    signals: fenced.signals,
  };
}

function decodePdfLiteralString(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    i += 1;
    if (i >= raw.length) {
      break;
    }
    const next = raw[i];
    if (next === "n") {
      out += "\n";
      i += 1;
    } else if (next === "r") {
      out += "\r";
      i += 1;
    } else if (next === "t") {
      out += "\t";
      i += 1;
    } else if (next === "b" || next === "f") {
      out += " ";
      i += 1;
    } else if (next === "\r") {
      i += raw[i + 1] === "\n" ? 2 : 1;
    } else if (next === "\n") {
      i += 1;
    } else if (next >= "0" && next <= "7") {
      let oct = next;
      if (i + 1 < raw.length && raw[i + 1] >= "0" && raw[i + 1] <= "7") {
        oct += raw[i + 1];
        if (i + 2 < raw.length && raw[i + 2] >= "0" && raw[i + 2] <= "7") {
          oct += raw[i + 2];
        }
      }
      out += String.fromCharCode(Number.parseInt(oct, 8));
      i += oct.length;
    } else {
      out += next;
      i += 1;
    }
  }
  if (
    out.length >= 2 &&
    out.charCodeAt(0) === 0xfe &&
    out.charCodeAt(1) === 0xff
  ) {
    let utf16 = "";
    for (let j = 2; j + 1 < out.length; j += 2) {
      const code = (out.charCodeAt(j) << 8) | out.charCodeAt(j + 1);
      utf16 += String.fromCharCode(code);
    }
    return utf16;
  }
  return out;
}

function decodePdfHexToken(hexRaw: string, cmap: Map<number, string>): string {
  const cleaned = hexRaw.replace(/\s+/g, "");
  if (!cleaned) {
    return "";
  }
  const padded = cleaned.length % 2 === 1 ? `${cleaned}0` : cleaned;
  const upper = padded.toUpperCase();

  if (upper.startsWith("FEFF") && upper.length >= 8) {
    let utf16 = "";
    for (let i = 4; i + 3 < upper.length; i += 4) {
      const code = Number.parseInt(upper.slice(i, i + 4), 16);
      if (Number.isFinite(code)) {
        utf16 += String.fromCharCode(code);
      }
    }
    return utf16;
  }

  if (cmap.size > 0) {
    // Try 2-byte big-endian glyph lookups first if even number of 2-byte pairs, else 1-byte
    if (upper.length % 4 === 0) {
      let mapped = "";
      let hitCount = 0;
      for (let i = 0; i < upper.length; i += 4) {
        const code = Number.parseInt(upper.slice(i, i + 4), 16);
        const found = cmap.get(code);
        if (found !== undefined) {
          mapped += found;
          hitCount += 1;
        }
      }
      if (hitCount > 0) {
        return mapped;
      }
    }
    let mapped1 = "";
    let hit1 = 0;
    for (let i = 0; i < upper.length; i += 2) {
      const code = Number.parseInt(upper.slice(i, i + 2), 16);
      const found = cmap.get(code);
      if (found !== undefined) {
        mapped1 += found;
        hit1 += 1;
      } else if (code >= 32 && code <= 126) {
        mapped1 += String.fromCharCode(code);
      }
    }
    if (hit1 > 0) {
      return mapped1;
    }
  }

  let out = "";
  for (let i = 0; i < upper.length; i += 2) {
    const code = Number.parseInt(upper.slice(i, i + 2), 16);
    if (Number.isFinite(code) && code >= 9) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

function parseToUnicodeCmap(
  streamText: string,
  cmap: Map<number, string>
): void {
  const bfcharBlocks = streamText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
  for (const match of bfcharBlocks) {
    const body = match[1] ?? "";
    const pairs = body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
    for (const pair of pairs) {
      const src = Number.parseInt(pair[1], 16);
      const dstHex = pair[2];
      let dst = "";
      for (let i = 0; i + 3 < dstHex.length; i += 4) {
        dst += String.fromCodePoint(
          Number.parseInt(dstHex.slice(i, i + 4), 16)
        );
      }
      if (!dst && dstHex.length >= 2) {
        dst = String.fromCodePoint(Number.parseInt(dstHex, 16));
      }
      if (Number.isFinite(src) && dst) {
        cmap.set(src, dst);
      }
    }
  }

  const bfrangeBlocks = streamText.matchAll(
    /beginbfrange([\s\S]*?)endbfrange/g
  );
  for (const match of bfrangeBlocks) {
    const body = match[1] ?? "";
    const ranges = body.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    );
    for (const range of ranges) {
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const dstStart = Number.parseInt(range[3], 16);
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        Number.isFinite(dstStart) &&
        end >= start &&
        end - start <= 1024
      ) {
        for (let code = start; code <= end; code++) {
          cmap.set(code, String.fromCodePoint(dstStart + (code - start)));
        }
      }
    }
  }
}

function extractBalancedParenStrings(
  segment: string,
  cmap: Map<number, string>
): string {
  let out = "";
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      let raw = "";
      while (j < segment.length && depth > 0) {
        const c = segment[j];
        if (c === "\\") {
          raw += c + (segment[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (c === "(") {
          depth += 1;
          raw += c;
        } else if (c === ")") {
          depth -= 1;
          if (depth > 0) {
            raw += c;
          }
        } else {
          raw += c;
        }
        j += 1;
      }
      out += decodePdfLiteralString(raw);
      i = j;
      continue;
    }
    if (ch === "<" && segment[i + 1] !== "<") {
      const closeIdx = segment.indexOf(">", i + 1);
      if (closeIdx > i) {
        out += decodePdfHexToken(segment.slice(i + 1, closeIdx), cmap);
        i = closeIdx + 1;
        continue;
      }
    }
    if (ch === "-" && /[0-9]/.test(segment[i + 1] ?? "")) {
      // Negative kerning adjustment inside TJ array (>= 120 thousandths em -> word space)
      let j = i + 1;
      while (j < segment.length && /[0-9.]/.test(segment[j] ?? "")) {
        j += 1;
      }
      const kern = Number.parseFloat(segment.slice(i + 1, j));
      if (Number.isFinite(kern) && kern >= 120 && !out.endsWith(" ")) {
        out += " ";
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

function extractTextFromPdfContentStream(
  content: string,
  cmap: Map<number, string>
): string {
  const chunks: string[] = [];
  const btBlocks = [...content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)];
  const targets =
    btBlocks.length > 0 ? btBlocks.map((m) => m[1] ?? "") : [content];

  for (const block of targets) {
    const lines = block.split(/\r?\n/);
    let currentLine = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (/\b(?:T\*|TD|Td|Tm)\b/.test(trimmed) && currentLine.trim()) {
        chunks.push(currentLine.trim());
        currentLine = "";
      }
      // Match TJ arrays, Tj literals/hex, and ' / " quote text operators
      if (
        /\bTJ\b/.test(trimmed) ||
        /\bTj\b/.test(trimmed) ||
        /['"]\s*$/.test(trimmed)
      ) {
        const piece = extractBalancedParenStrings(trimmed, cmap);
        if (piece) {
          currentLine += piece;
        }
        if (/['"]\s*$/.test(trimmed) && currentLine.trim()) {
          chunks.push(currentLine.trim());
          currentLine = "";
        }
      }
    }
    if (currentLine.trim()) {
      chunks.push(currentLine.trim());
    }
  }

  return chunks.join("\n");
}

function tryDecompressPdfStream(
  rawStreamBytes: Buffer,
  dictHeader: string
): string | null {
  const isFlate = /\/FlateDecode\b|\/Fl\b/.test(dictHeader);
  if (!isFlate) {
    // Skip binary image/font streams
    if (/\/Subtype\s*\/Image\b|\/FontFile\d*\b/.test(dictHeader)) {
      return null;
    }
    return rawStreamBytes.toString("latin1");
  }

  try {
    return inflateSync(rawStreamBytes, {
      maxOutputLength: MAX_PDF_INFLATE_BYTES,
    }).toString("latin1");
  } catch {
    try {
      return inflateRawSync(rawStreamBytes, {
        maxOutputLength: MAX_PDF_INFLATE_BYTES,
      }).toString("latin1");
    } catch {
      return null;
    }
  }
}

export function parsePdfBufferToText(
  bytes: Uint8Array,
  filename: string
): ParsedAttachmentText {
  const buf = Buffer.from(bytes);
  const latin = buf.toString("latin1");

  if (/\/Encrypt\b/.test(latin)) {
    const msg = `[PDF Attachment: ${filename} is encrypted/password-protected and cannot be parsed.]`;
    const fenced = fenceUntrustedContent({
      text: msg,
      source: `attachment:pdf:${filename}`,
      maxChars: MAX_EXTRACTED_ATTACHMENT_CHARS,
    });
    return {
      fencedText: fenced.fencedText,
      rawCharCount: msg.length,
      truncated: false,
      suspicious: false,
      signals: [],
    };
  }

  const decodedStreams: string[] = [];
  const cmap = new Map<number, string>();
  let searchOffset = 0;
  let streamCount = 0;

  while (searchOffset < latin.length && streamCount < MAX_PDF_STREAMS) {
    const streamIdx = latin.indexOf("stream", searchOffset);
    if (streamIdx < 0) {
      break;
    }
    // Verify 'stream' is preceded by '<< ... >>' dictionary and followed by EOL
    const afterKeyword = latin.slice(streamIdx + 6, streamIdx + 8);
    if (!afterKeyword.startsWith("\n") && !afterKeyword.startsWith("\r\n")) {
      searchOffset = streamIdx + 6;
      continue;
    }
    const dataStart = streamIdx + 6 + (afterKeyword.startsWith("\r\n") ? 2 : 1);
    const endIdx = latin.indexOf("endstream", dataStart);
    if (endIdx < 0) {
      break;
    }

    let dataEnd = endIdx;
    if (latin[dataEnd - 1] === "\n") {
      dataEnd -= 1;
      if (latin[dataEnd - 1] === "\r") {
        dataEnd -= 1;
      }
    } else if (latin[dataEnd - 1] === "\r") {
      dataEnd -= 1;
    }

    const dictStart = Math.max(0, latin.lastIndexOf("<<", streamIdx));
    const dictHeader = latin.slice(dictStart, streamIdx);
    const rawSlice = buf.subarray(dataStart, Math.max(dataStart, dataEnd));
    const decoded = tryDecompressPdfStream(rawSlice, dictHeader);

    if (decoded) {
      if (decoded.includes("beginbfchar") || decoded.includes("beginbfrange")) {
        parseToUnicodeCmap(decoded, cmap);
      } else {
        decodedStreams.push(decoded);
      }
    }

    streamCount += 1;
    searchOffset = endIdx + 9;
  }

  const extractedBlocks: string[] = [];
  for (const streamText of decodedStreams) {
    const text = extractTextFromPdfContentStream(streamText, cmap);
    if (text.trim()) {
      extractedBlocks.push(text.trim());
    }
  }

  const bodyText = extractedBlocks
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const finalDoc = bodyText
    ? `PDF Attachment: ${filename}\n\n${bodyText}`
    : `PDF Attachment: ${filename}\n[No extractable text layer found — PDF may be a scanned image.]`;

  const fenced = fenceUntrustedContent({
    text: finalDoc,
    source: `attachment:pdf:${filename}`,
    maxChars: MAX_EXTRACTED_ATTACHMENT_CHARS,
  });

  return {
    fencedText: fenced.fencedText,
    rawCharCount: finalDoc.length,
    truncated: fenced.truncated,
    suspicious: fenced.suspicious,
    signals: fenced.signals,
  };
}

export async function prepareMessagesWithAttachments(opts: {
  messages: ChatMessage[];
  userId: string;
  visionEnabled: boolean;
  store?: PrivateFileStore;
  secret?: string;
}): Promise<{
  messages: ChatMessage[];
  hasUntrustedAttachment: boolean;
}> {
  const store = opts.store ?? getDefaultPrivateFileStore();
  let hasUntrustedAttachment = false;

  const transformed: ChatMessage[] = [];

  for (const message of opts.messages) {
    if (message.role !== "user") {
      transformed.push(message);
      continue;
    }

    const nextParts: ChatMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type !== "file") {
        nextParts.push(part);
        continue;
      }

      hasUntrustedAttachment = true;
      const filePart = part as {
        type: "file";
        url: string;
        mediaType: string;
        filename?: string;
        name?: string;
      };
      const displayName = filePart.filename ?? filePart.name ?? "attachment";

      // Security invariant: NEVER fetch arbitrary external URLs (prevents SSRF).
      // Only resolve HMAC-signed private proxy URLs belonging to opts.userId.
      const token = extractTokenFromPrivateFileUrl(filePart.url);
      if (!token) {
        nextParts.push({
          type: "text",
          text: `[Attachment "${displayName}" skipped: URL is not a signed private proxy URL.]`,
        });
        continue;
      }

      const verified = verifySignedFileToken(token, {
        expectedUserId: opts.userId,
        secret: opts.secret,
        ignoreExpiry: true,
      });

      if (!verified.valid) {
        nextParts.push({
          type: "text",
          text: `[Attachment "${displayName}" rejected: ${verified.reason}.]`,
        });
        continue;
      }

      const bytes = await store.read({
        userId: opts.userId,
        fileId: verified.payload.fid,
        contentType: verified.payload.ct,
        storageRef: verified.payload.ref,
      });

      if (!bytes) {
        nextParts.push({
          type: "text",
          text: `[Attachment "${verified.payload.name}" is no longer available in private storage.]`,
        });
        continue;
      }

      const mediaType: ExportedPrivateFileMediaType = verified.payload.ct;
      if (mediaType === "text/csv") {
        const parsed = parseCsvBufferToText(bytes, verified.payload.name);
        nextParts.push({
          type: "text",
          text: parsed.fencedText,
        });
      } else if (mediaType === "application/pdf") {
        const parsed = parsePdfBufferToText(bytes, verified.payload.name);
        nextParts.push({
          type: "text",
          text: parsed.fencedText,
        });
      } else if (
        mediaType === "text/html" ||
        mediaType === "text/plain" ||
        mediaType === "text/markdown" ||
        mediaType === "application/json"
      ) {
        const rawText = Buffer.from(bytes)
          .toString("utf8")
          .slice(0, MAX_EXTRACTED_ATTACHMENT_CHARS);
        nextParts.push({
          type: "text",
          text: fenceUntrustedContent({
            text: rawText,
            source: `attachment:${verified.payload.name}`,
            maxChars: MAX_EXTRACTED_ATTACHMENT_CHARS,
          }).fencedText,
        });
      } else if (opts.visionEnabled && mediaType.startsWith("image/")) {
        const dataUrl = `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
        nextParts.push({
          ...part,
          url: dataUrl,
        });
      } else {
        nextParts.push({
          type: "text",
          text: `[Image attachment "${verified.payload.name}" (${mediaType}, ${verified.payload.size} bytes) uploaded securely; vision input is disabled on the selected model.]`,
        });
      }
    }

    transformed.push({
      ...message,
      parts: nextParts,
    });
  }

  return {
    messages: transformed,
    hasUntrustedAttachment,
  };
}
