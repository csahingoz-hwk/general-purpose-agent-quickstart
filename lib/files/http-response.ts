import type { ExportedPrivateFileMediaType } from "./attachment-validator";

export type FileServeDisposition = "inline" | "attachment";

function formatContentTypeWithCharset(
  contentType: ExportedPrivateFileMediaType
): string {
  if (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml"
  ) {
    return `${contentType}; charset=utf-8`;
  }
  return contentType;
}

function cspForFileResponse(
  contentType: ExportedPrivateFileMediaType,
  disposition: FileServeDisposition
): string {
  if (disposition === "attachment") {
    return "default-src 'none'; sandbox";
  }
  if (contentType === "text/html" || contentType === "image/svg+xml") {
    // Opaque-origin sandbox (no allow-same-origin): renders HTML/CSS/inline charts
    // cleanly in mobile Safari while isolating cookies, storage, and same-origin APIs,
    // and permits clicking external source links (`target="_blank"`).
    return "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'unsafe-inline' https: data: blob:; img-src * data: blob:; style-src 'unsafe-inline' https:; font-src * data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  }
  if (contentType.startsWith("image/") || contentType === "application/pdf") {
    return "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox";
  }
  return "default-src 'none'; style-src 'unsafe-inline'; sandbox";
}

export function resolveFileDisposition(
  rawParam: string | null | undefined,
  contentType: ExportedPrivateFileMediaType
): FileServeDisposition {
  if (rawParam === "inline") {
    return "inline";
  }
  if (rawParam === "attachment") {
    return "attachment";
  }
  return contentType.startsWith("image/") ? "inline" : "attachment";
}

export function buildPrivateFileHttpResponse(opts: {
  bytes: Uint8Array;
  filename: string;
  contentType: ExportedPrivateFileMediaType;
  disposition?: FileServeDisposition;
}): Response {
  const disposition =
    opts.disposition ??
    (opts.contentType.startsWith("image/") ? "inline" : "attachment");
  const safeAsciiName =
    opts.filename
      .replace(/["\\\r\n]/g, "_")
      .replace(/[^\x20-\x7E]/g, "_")
      .trim() || "file";
  const encodedUtf8Name = encodeURIComponent(
    opts.filename.replace(/[\r\n]/g, "_").trim() || "file"
  );

  return new Response(Buffer.from(opts.bytes), {
    status: 200,
    headers: {
      "Content-Type": formatContentTypeWithCharset(opts.contentType),
      "Content-Length": String(opts.bytes.byteLength),
      "Content-Disposition": `${disposition}; filename="${safeAsciiName}"; filename*=UTF-8''${encodedUtf8Name}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": cspForFileResponse(
        opts.contentType,
        disposition
      ),
    },
  });
}
