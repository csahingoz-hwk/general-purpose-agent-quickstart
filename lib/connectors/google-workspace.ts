import {
  buildGoogleWorkspaceEnableApiUrl,
  extractGoogleClientProjectNumber,
} from "@/lib/connectors/card-state";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";

const WORK_DATA_BOUNDARY_PATTERN =
  /\b(?:korn[\s_-]*ferry|hay[\s_-]*group|\bsa90\b|\beosb\b|gl[\s_-]*239300|sox\s+control)\b/i;

// Hard safety guard: ONLY read endpoints and unsent draft creation endpoints are permitted.
// Sending mail, deleting messages/files, modifying existing Drive files, or changing sharing
// permissions is architecturally blocked at the URL guard layer.
const FORBIDDEN_GOOGLE_PATH_SEGMENT =
  /\/(?:send|trash|untrash|delete|batchDelete|batchModify|modify|permissions|import|insert)\b/i;

export function assertSafeGoogleRequest(method: string, rawUrl: string): URL {
  const upperMethod = method.toUpperCase();
  const parsed = new URL(rawUrl);

  if (parsed.protocol !== "https:") {
    throw new Error("Google connector requests must use HTTPS");
  }

  const allowedHost =
    parsed.hostname === "gmail.googleapis.com" ||
    parsed.hostname === "www.googleapis.com";
  if (!allowedHost) {
    throw new Error(`Disallowed Google API host: ${parsed.hostname}`);
  }

  if (FORBIDDEN_GOOGLE_PATH_SEGMENT.test(parsed.pathname)) {
    throw new Error(
      `Blocked forbidden Google API action (${upperMethod} ${parsed.pathname}): connector is strictly read + draft-only (never send/delete/share).`
    );
  }

  if (upperMethod === "GET") {
    const validGmailGet =
      /^\/gmail\/v1\/users\/me\/messages(?:\/[a-zA-Z0-9_-]+)?$/.test(
        parsed.pathname
      );
    const validDriveGet =
      /^\/drive\/v3\/files(?:\/[a-zA-Z0-9_-]+(?:\/export)?)?$/.test(
        parsed.pathname
      );
    if (!validGmailGet && !validDriveGet) {
      throw new Error(`Disallowed Google GET path: ${parsed.pathname}`);
    }
    return parsed;
  }

  if (upperMethod === "POST") {
    const validGmailDraftCreate =
      parsed.hostname === "gmail.googleapis.com" &&
      parsed.pathname === "/gmail/v1/users/me/drafts";
    const validDriveDraftCreate =
      parsed.hostname === "www.googleapis.com" &&
      parsed.pathname === "/upload/drive/v3/files";
    if (!validGmailDraftCreate && !validDriveDraftCreate) {
      throw new Error(
        `Blocked Google POST path (${parsed.pathname}): only unsent Gmail drafts and new private Drive draft files are permitted.`
      );
    }
    return parsed;
  }

  throw new Error(
    `Blocked HTTP method ${upperMethod}: Google connector supports GET (read) and POST (unsent draft creation) only.`
  );
}

export function containsRestrictedWorkData(text: string): boolean {
  return WORK_DATA_BOUNDARY_PATTERN.test(text);
}

type GmailMessagePayload = {
  mimeType?: string;
  body?: { data?: string };
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailMessagePayload[];
};

function decodeBase64UrlUtf8(encoded: string): string {
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function stripBasicHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPlainBodyFromPayload(payload?: GmailMessagePayload): string {
  if (!payload) {
    return "";
  }
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64UrlUtf8(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64UrlUtf8(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const nested = extractPlainBodyFromPayload(part);
      if (nested) {
        return nested;
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return stripBasicHtml(decodeBase64UrlUtf8(part.body.data));
      }
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripBasicHtml(decodeBase64UrlUtf8(payload.body.data));
  }
  return "";
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  targetName: string
): string {
  const lower = targetName.toLowerCase();
  return (
    headers?.find((h) => h.name?.toLowerCase() === lower)?.value?.trim() ?? ""
  );
}

export type GoogleConnectorErrorReason =
  | "token_expired"
  | "scope_missing"
  | "service_disabled"
  | "upstream_error";

export type ParsedGoogleApiErrorDiagnostics = {
  googleStatus: string | null;
  googleReasons: string[];
  errorProjectNumber: string | null;
  activationUrl: string | null;
};

export function parseGoogleApiErrorDiagnostics(
  rawBody: string
): ParsedGoogleApiErrorDiagnostics {
  let googleStatus: string | null = null;
  const reasonSet = new Set<string>();
  let errorProjectNumber: string | null = null;
  let activationUrl: string | null = null;

  try {
    const parsed = JSON.parse(rawBody) as {
      error?: {
        status?: unknown;
        message?: unknown;
        errors?: Array<{ reason?: unknown }>;
        details?: Array<{
          reason?: unknown;
          metadata?: {
            consumer?: unknown;
            activationUrl?: unknown;
          };
        }>;
      };
    };
    const errObj = parsed?.error;
    if (errObj && typeof errObj === "object") {
      if (typeof errObj.status === "string") {
        googleStatus = errObj.status.slice(0, 64);
      }
      for (const item of errObj.errors ?? []) {
        if (typeof item?.reason === "string" && item.reason.trim()) {
          reasonSet.add(item.reason.trim().slice(0, 80));
        }
      }
      for (const detail of errObj.details ?? []) {
        if (typeof detail?.reason === "string" && detail.reason.trim()) {
          reasonSet.add(detail.reason.trim().slice(0, 80));
        }
        const consumer =
          typeof detail?.metadata?.consumer === "string"
            ? detail.metadata.consumer
            : "";
        const consumerMatch = consumer.match(/projects\/(\d{6,20})\b/i);
        if (consumerMatch?.[1]) {
          errorProjectNumber = consumerMatch[1];
        }
        const rawAct =
          typeof detail?.metadata?.activationUrl === "string"
            ? detail.metadata.activationUrl.trim()
            : "";
        if (
          rawAct &&
          /^https:\/\/console\.(?:developers|cloud)\.google\.com\//i.test(
            rawAct
          )
        ) {
          activationUrl = rawAct.slice(0, 300);
        }
      }
      if (!errorProjectNumber && typeof errObj.message === "string") {
        const msgMatch = errObj.message.match(/\bproject\s+#?(\d{6,20})\b/i);
        if (msgMatch?.[1]) {
          errorProjectNumber = msgMatch[1];
        }
      }
    }
  } catch {
    const msgMatch = rawBody.match(/\bproject\s+#?(\d{6,20})\b/i);
    if (msgMatch?.[1]) {
      errorProjectNumber = msgMatch[1];
    }
  }

  return {
    googleStatus,
    googleReasons: [...reasonSet],
    errorProjectNumber,
    activationUrl,
  };
}

export class GoogleConnectorApiError extends Error {
  readonly statusCode: number;
  readonly reason: GoogleConnectorErrorReason;
  readonly friendlyMessage: string;
  readonly projectNumber: string | null;
  readonly enableApiUrl: string | null;
  readonly googleReasons: string[];

  constructor(opts: {
    statusCode: number;
    reason: GoogleConnectorErrorReason;
    friendlyMessage: string;
    internalMessage: string;
    projectNumber?: string | null;
    enableApiUrl?: string | null;
    googleReasons?: string[];
  }) {
    super(opts.internalMessage);
    this.name = "GoogleConnectorApiError";
    this.statusCode = opts.statusCode;
    this.reason = opts.reason;
    this.friendlyMessage = opts.friendlyMessage;
    this.projectNumber = opts.projectNumber ?? null;
    this.enableApiUrl = opts.enableApiUrl ?? null;
    this.googleReasons = opts.googleReasons ?? [];
  }
}

export async function buildGoogleApiError(
  serviceLabel: "Gmail" | "Google Drive" | "Google Calendar",
  res: Response,
  context?: { oauthClientProjectNumber?: string | null }
): Promise<GoogleConnectorApiError> {
  let rawBody = "";
  try {
    rawBody = await res.text();
  } catch {
    rawBody = "";
  }
  const status = res.status;
  const diag = parseGoogleApiErrorDiagnostics(rawBody);
  const oauthClientProjectNumber =
    context?.oauthClientProjectNumber ??
    extractGoogleClientProjectNumber(process.env.AUTH_GOOGLE_ID);
  const resolvedProjectNumber =
    diag.errorProjectNumber ?? oauthClientProjectNumber ?? null;

  if (status === 401) {
    console.error("[google-connector] api_error", {
      service: serviceLabel,
      httpStatus: 401,
      classifiedReason: "token_expired",
      googleStatus: diag.googleStatus,
      googleReasons: diag.googleReasons,
      errorProjectNumber: diag.errorProjectNumber,
      oauthClientProjectNumber,
    });
    return new GoogleConnectorApiError({
      statusCode: 401,
      reason: "token_expired",
      friendlyMessage: `Your Google session expired. Tap Reconnect Google to refresh read-only ${serviceLabel} access.`,
      internalMessage: `${serviceLabel} API unauthorized (HTTP 401)`,
      projectNumber: resolvedProjectNumber,
      googleReasons: diag.googleReasons,
    });
  }
  if (status === 403) {
    const isDisabled =
      diag.googleReasons.includes("SERVICE_DISABLED") ||
      diag.googleReasons.includes("accessNotConfigured") ||
      /SERVICE_DISABLED|accessNotConfigured|has not been used in project|it is disabled/i.test(
        rawBody
      );
    const classifiedReason: GoogleConnectorErrorReason = isDisabled
      ? "service_disabled"
      : "scope_missing";
    const enableApiUrl = isDisabled
      ? buildGoogleWorkspaceEnableApiUrl(resolvedProjectNumber)
      : null;

    console.error("[google-connector] api_error", {
      service: serviceLabel,
      httpStatus: 403,
      classifiedReason,
      googleStatus: diag.googleStatus,
      googleReasons: diag.googleReasons,
      errorProjectNumber: diag.errorProjectNumber,
      oauthClientProjectNumber,
      activationUrl: diag.activationUrl ?? enableApiUrl,
    });

    if (isDisabled) {
      const neutralServiceName =
        serviceLabel === "Google Calendar" ? "Google Takvim" : serviceLabel;
      return new GoogleConnectorApiError({
        statusCode: 403,
        reason: "service_disabled",
        friendlyMessage: `${neutralServiceName} şu an kullanılamıyor, kurulum kontrol ediliyor`,
        internalMessage: `${serviceLabel} API disabled on GCP project ${resolvedProjectNumber ?? "unknown"} (HTTP 403)`,
        projectNumber: resolvedProjectNumber,
        enableApiUrl,
        googleReasons: diag.googleReasons,
      });
    }
    return new GoogleConnectorApiError({
      statusCode: 403,
      reason: "scope_missing",
      friendlyMessage: `${serviceLabel} read permission isn't granted yet. Tap Reconnect Google and allow ${serviceLabel} access.`,
      internalMessage: `${serviceLabel} API forbidden / missing scope (HTTP 403)`,
      projectNumber: resolvedProjectNumber,
      googleReasons: diag.googleReasons,
    });
  }
  console.error("[google-connector] api_error", {
    service: serviceLabel,
    httpStatus: status,
    classifiedReason: "upstream_error",
    googleStatus: diag.googleStatus,
    googleReasons: diag.googleReasons,
    errorProjectNumber: diag.errorProjectNumber,
    oauthClientProjectNumber,
  });
  return new GoogleConnectorApiError({
    statusCode: status,
    reason: "upstream_error",
    friendlyMessage: `Could not reach ${serviceLabel} right now. Tap Try again shortly.`,
    internalMessage: `${serviceLabel} API failed (HTTP ${status})`,
    projectNumber: resolvedProjectNumber,
    googleReasons: diag.googleReasons,
  });
}

export type FencedGmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  fencedContent: string;
  suspicious: boolean;
};

export async function readGmailMessages(opts: {
  accessToken: string;
  query?: string;
  maxResults?: number;
  oauthClientProjectNumber?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<FencedGmailMessage[]> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const maxResults = Math.min(Math.max(1, opts.maxResults ?? 10), 20);
  const effectiveQuery = opts.query?.trim()
    ? opts.query.trim().slice(0, 200)
    : "in:inbox";

  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages"
  );
  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set("q", effectiveQuery);
  assertSafeGoogleRequest("GET", listUrl.toString());

  const listRes = await fetchFn(listUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!listRes.ok) {
    throw await buildGoogleApiError("Gmail", listRes, {
      oauthClientProjectNumber: opts.oauthClientProjectNumber,
    });
  }

  const listJson = (await listRes.json()) as {
    messages?: Array<{ id?: string; threadId?: string }>;
  };
  const stubs = (listJson.messages ?? []).slice(0, maxResults);
  const results: FencedGmailMessage[] = [];

  for (const stub of stubs) {
    if (!stub.id || !/^[a-zA-Z0-9_-]+$/.test(stub.id)) {
      continue;
    }
    const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${stub.id}?format=full`;
    assertSafeGoogleRequest("GET", detailUrl);
    const detailRes = await fetchFn(detailUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!detailRes.ok) {
      continue;
    }
    const detail = (await detailRes.json()) as {
      id?: string;
      threadId?: string;
      snippet?: string;
      payload?: GmailMessagePayload;
    };
    const headers = detail.payload?.headers;
    const subject = headerValue(headers, "Subject") || "(no subject)";
    const from = headerValue(headers, "From") || "(unknown sender)";
    const date = headerValue(headers, "Date") || "";
    const bodyText =
      extractPlainBodyFromPayload(detail.payload) || detail.snippet || "";

    const rawSummary = `From: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${bodyText}`;
    const fenced = fenceUntrustedContent({
      text: rawSummary,
      source: `connector:gmail:${stub.id}`,
      maxChars: 4000,
    });

    results.push({
      id: stub.id,
      threadId: detail.threadId ?? stub.threadId ?? "",
      subject: subject.slice(0, 160),
      from: from.slice(0, 160),
      date: date.slice(0, 80),
      fencedContent: fenced.fencedText,
      suspicious: fenced.suspicious,
    });
  }

  return results;
}

function encodeMimeHeaderUtf8(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export function buildRfc2822DraftRaw(opts: {
  to: string;
  subject: string;
  body: string;
}): string {
  const safeTo = opts.to.replace(/[\r\n]+/g, " ").trim();
  const lines = [
    `To: ${safeTo}`,
    `Subject: ${encodeMimeHeaderUtf8(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function createGmailUnsentDraft(opts: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ draftId: string; messageId: string | null }> {
  if (containsRestrictedWorkData(`${opts.to}\n${opts.subject}\n${opts.body}`)) {
    throw new Error(
      "Blocked by data governance rule: employer/Korn Ferry material cannot be written to personal Gmail."
    );
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
  assertSafeGoogleRequest("POST", url);

  const raw = buildRfc2822DraftRaw({
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
  });

  const payload = {
    message: {
      raw,
      ...(opts.threadId?.trim() ? { threadId: opts.threadId.trim() } : {}),
    },
  };

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`Gmail draft creation failed (HTTP ${res.status})`);
  }

  const created = (await res.json()) as {
    id?: string;
    message?: { id?: string };
  };
  return {
    draftId: created.id ?? "draft",
    messageId: created.message?.id ?? null,
  };
}

export type FencedDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  fencedExcerpt: string;
  suspicious: boolean;
};

export async function readDriveFiles(opts: {
  accessToken: string;
  query?: string;
  maxResults?: number;
  includeExcerpt?: boolean;
  oauthClientProjectNumber?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<FencedDriveFile[]> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const maxResults = Math.min(Math.max(1, opts.maxResults ?? 5), 10);

  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("pageSize", String(maxResults));
  listUrl.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,size)"
  );
  const escapedTerm = opts.query
    ? opts.query.replace(/[\\']/g, "").trim().slice(0, 120)
    : "";
  listUrl.searchParams.set(
    "q",
    escapedTerm
      ? `trashed = false and name contains '${escapedTerm}'`
      : "trashed = false"
  );

  assertSafeGoogleRequest("GET", listUrl.toString());

  const listRes = await fetchFn(listUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!listRes.ok) {
    throw await buildGoogleApiError("Google Drive", listRes, {
      oauthClientProjectNumber: opts.oauthClientProjectNumber,
    });
  }

  const listJson = (await listRes.json()) as {
    files?: Array<{
      id?: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
    }>;
  };

  const results: FencedDriveFile[] = [];

  for (const file of (listJson.files ?? []).slice(0, maxResults)) {
    if (!file.id || !/^[a-zA-Z0-9_-]+$/.test(file.id)) {
      continue;
    }
    const name = file.name ?? "Untitled";
    const mimeType = file.mimeType ?? "application/octet-stream";
    let excerpt = "";

    if (opts.includeExcerpt !== false) {
      let contentUrl: string | null = null;
      if (mimeType === "application/vnd.google-apps.document") {
        contentUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text%2Fplain`;
      } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
        contentUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text%2Fcsv`;
      } else if (
        mimeType.startsWith("text/") ||
        mimeType === "application/json"
      ) {
        contentUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
      }

      if (contentUrl) {
        assertSafeGoogleRequest("GET", contentUrl);
        const contentRes = await fetchFn(contentUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        }).catch(() => null);

        if (contentRes?.ok) {
          const text = await contentRes.text();
          excerpt = text.slice(0, 4000);
        }
      }
    }

    const rawDoc = `File: ${name} (${mimeType})\nModified: ${file.modifiedTime ?? "unknown"}\n\n${excerpt || "[Metadata only]"}`;
    const fenced = fenceUntrustedContent({
      text: rawDoc,
      source: `connector:gdrive:${file.id}`,
      maxChars: 4000,
    });

    results.push({
      id: file.id,
      name: name.slice(0, 160),
      mimeType,
      modifiedTime: file.modifiedTime ?? "",
      fencedExcerpt: fenced.fencedText,
      suspicious: fenced.suspicious,
    });
  }

  return results;
}

export async function createDrivePrivateDraftDoc(opts: {
  accessToken: string;
  title: string;
  content: string;
  fetchImpl?: typeof fetch;
}): Promise<{ fileId: string; name: string }> {
  if (containsRestrictedWorkData(`${opts.title}\n${opts.content}`)) {
    throw new Error(
      "Blocked by data governance rule: employer/Korn Ferry material cannot be uploaded to personal Google Drive."
    );
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const url =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name";
  assertSafeGoogleRequest("POST", url);

  const normalizedTitle = opts.title.trim().startsWith("[DRAFT]")
    ? opts.title.trim().slice(0, 140)
    : `[DRAFT] ${opts.title.trim().slice(0, 130)}`;

  const boundary = "assistant_drive_draft_boundary_v1";
  const metadata = JSON.stringify({
    name: normalizedTitle,
    mimeType: "application/vnd.google-apps.document",
  });

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset="UTF-8"',
    "",
    metadata,
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.content,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`Google Drive draft creation failed (HTTP ${res.status})`);
  }

  const created = (await res.json()) as { id?: string; name?: string };
  return {
    fileId: created.id ?? "drive-draft",
    name: created.name ?? normalizedTitle,
  };
}
