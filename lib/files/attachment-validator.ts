export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "text/csv",
] as const;

export type AllowedAttachmentMediaType =
  (typeof ALLOWED_ATTACHMENT_TYPES)[number];

export const EXPORTED_PRIVATE_FILE_TYPES = [
  ...ALLOWED_ATTACHMENT_TYPES,
  "image/webp",
  "image/svg+xml",
  "text/html",
  "text/css",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "application/json",
  "application/xml",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
] as const;

export type ExportedPrivateFileMediaType =
  (typeof EXPORTED_PRIVATE_FILE_TYPES)[number];

export function inferPrivateFileMediaType(
  filename: string
): ExportedPrivateFileMediaType {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  if (lower.endsWith(".css")) {
    return "text/css";
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "text/javascript";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) {
    return "application/json";
  }
  if (lower.endsWith(".xml")) {
    return "application/xml";
  }
  if (lower.endsWith(".zip")) {
    return "application/zip";
  }
  if (
    lower.endsWith(".gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar.gz")
  ) {
    return "application/gzip";
  }
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".log") ||
    lower.endsWith(".py") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".sql")
  ) {
    return "text/plain";
  }
  return "application/octet-stream";
}

export const MAX_IMAGE_OR_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

const CSV_MIME_ALIASES = new Set([
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
]);

export type ValidatedAttachment =
  | {
      valid: true;
      mediaType: AllowedAttachmentMediaType;
      safeName: string;
      size: number;
    }
  | {
      valid: false;
      error: string;
    };

export function sanitizeAttachmentFilename(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop()?.trim() ?? "attachment";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^\.+/, "");
  const bounded = cleaned.slice(0, 120);
  return bounded.length > 0 ? bounded : "attachment";
}

function normalizeDeclaredMime(
  declaredType: string,
  safeName: string
): AllowedAttachmentMediaType | null {
  const lowerType = declaredType.trim().toLowerCase().split(";")[0] ?? "";
  const lowerName = safeName.toLowerCase();

  if (lowerType === "image/jpeg" || lowerType === "image/jpg") {
    return "image/jpeg";
  }
  if (lowerType === "image/png") {
    return "image/png";
  }
  if (lowerType === "application/pdf") {
    return "application/pdf";
  }
  if (CSV_MIME_ALIASES.has(lowerType)) {
    if (
      lowerType === "application/vnd.ms-excel" &&
      !lowerName.endsWith(".csv")
    ) {
      return null;
    }
    return "text/csv";
  }
  if (
    (lowerType === "" ||
      lowerType === "application/octet-stream" ||
      lowerType === "text/plain") &&
    lowerName.endsWith(".csv")
  ) {
    return "text/csv";
  }
  if (
    (lowerType === "" || lowerType === "application/octet-stream") &&
    lowerName.endsWith(".pdf")
  ) {
    return "application/pdf";
  }
  return null;
}

function hasJpegMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function hasPngMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function findPdfHeaderOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return i;
    }
  }
  return -1;
}

function isEncryptedPdf(bytes: Uint8Array): boolean {
  const sample = Buffer.from(bytes).toString("latin1");
  return /\/Encrypt\b/.test(sample);
}

function isLikelyTextCsv(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  const checkLen = Math.min(bytes.length, 65_536);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0x00) {
      return false;
    }
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(bytes.subarray(0, checkLen));
    return true;
  } catch {
    return false;
  }
}

export function validateAttachmentBuffer(opts: {
  filename: string;
  declaredType: string;
  bytes: Uint8Array;
}): ValidatedAttachment {
  const safeName = sanitizeAttachmentFilename(opts.filename);
  const size = opts.bytes.byteLength;

  if (size === 0) {
    return { valid: false, error: "Uploaded file is empty" };
  }

  const mediaType = normalizeDeclaredMime(opts.declaredType, safeName);
  if (!mediaType) {
    return {
      valid: false,
      error: "File type must be JPEG, PNG, PDF, or CSV",
    };
  }

  const maxBytes =
    mediaType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_OR_CSV_BYTES;
  if (size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File size exceeds the ${limitMb}MB limit for ${mediaType}`,
    };
  }

  if (mediaType === "image/jpeg" && !hasJpegMagic(opts.bytes)) {
    return { valid: false, error: "Invalid JPEG file header" };
  }
  if (mediaType === "image/png" && !hasPngMagic(opts.bytes)) {
    return { valid: false, error: "Invalid PNG file header" };
  }
  if (mediaType === "application/pdf") {
    if (findPdfHeaderOffset(opts.bytes) < 0) {
      return { valid: false, error: "Invalid PDF file header" };
    }
    if (isEncryptedPdf(opts.bytes)) {
      return {
        valid: false,
        error: "Password-protected or encrypted PDFs are not supported",
      };
    }
  }
  if (mediaType === "text/csv" && !isLikelyTextCsv(opts.bytes)) {
    return {
      valid: false,
      error: "CSV file must be valid UTF-8 text without binary bytes",
    };
  }

  return {
    valid: true,
    mediaType,
    safeName,
    size,
  };
}
