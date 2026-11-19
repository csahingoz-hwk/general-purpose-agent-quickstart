export type Failure =
  | "transient"
  | "structured"
  | "context"
  | "rate"
  | "auth"
  | "billing"
  | "cancelled"
  | "tool"
  | "unavailable"
  | "spend"
  | "work_boundary";

const SAFE_DIAG_TOKEN_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SECRET_LIKE_TOKEN_RE =
  /^(?:sk[-_]|pk[-_]|rk[-_]|gh[pousr][-_]|github_pat_|ya29\.|AIza|eyJ|xox[baprs][-_]|Bearer|whsec_|vck_|fc[-_])/i;

function sanitizeDiagToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    !trimmed ||
    !SAFE_DIAG_TOKEN_RE.test(trimmed) ||
    SECRET_LIKE_TOKEN_RE.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function sanitizeHttpStatusCode(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  ) {
    return value;
  }
  return null;
}

export type SafeErrorDiagnostic = {
  kind: Failure;
  statusCode: number | null;
  code: string | null;
  name: string | null;
};

export class ModelFailure extends Error {
  readonly code: Failure;
  readonly statusCode: number | null;
  readonly upstreamCode: string | null;
  readonly upstreamName: string | null;
  readonly primaryDiagnostic?: SafeErrorDiagnostic & { model?: string };

  constructor(
    code: Failure,
    meta?: {
      statusCode?: number | null;
      upstreamCode?: string | null;
      upstreamName?: string | null;
      primaryDiagnostic?: SafeErrorDiagnostic & { model?: string };
    }
  ) {
    super(`model_${code}`);
    this.name = "ModelFailure";
    this.code = code;
    this.statusCode = sanitizeHttpStatusCode(meta?.statusCode);
    this.upstreamCode = sanitizeDiagToken(meta?.upstreamCode);
    this.upstreamName = sanitizeDiagToken(meta?.upstreamName);
    this.primaryDiagnostic = meta?.primaryDiagnostic;
  }
}

type ErrorLike = {
  name?: unknown;
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  lastError?: unknown;
  error?: unknown;
  data?: {
    error?: {
      code?: unknown;
      status?: unknown;
      type?: unknown;
    };
  };
};

const TRANSIENT_NETWORK_CODES = new Set<string>([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_ABORTED",
  "vertex_timeout",
  "vertex_empty_stream",
  "empty_stream",
  "stream_ended_without_finish",
  "copilot_empty_stream",
  "copilot_bridge_unreachable",
]);

const PERMANENT_NON_RETRYABLE_CODES_RE =
  /INVALID_ARGUMENT|FAILED_PRECONDITION|PERMISSION_DENIED|SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|content_filter|finish_length/i;

export function collectErrorChain(error: unknown, maxDepth = 5): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur !== null && cur !== undefined && chain.length < maxDepth) {
    if (seen.has(cur)) {
      break;
    }
    seen.add(cur);
    chain.push(cur);
    if (typeof cur !== "object") {
      break;
    }
    const rec = cur as ErrorLike;
    cur = rec.cause ?? rec.lastError ?? rec.error ?? null;
  }
  return chain;
}

function extractRawCode(e: ErrorLike | null): string {
  const candidates = [
    e?.code,
    e?.data?.error?.code,
    e?.data?.error?.status,
    e?.data?.error?.type,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function isTransientNetworkLike(e: ErrorLike | null): boolean {
  if (!e) {
    return false;
  }
  const code = extractRawCode(e);
  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }
  const msg = typeof e.message === "string" ? e.message : "";
  if (
    (e.name === "TypeError" || e.name === "FetchError") &&
    /fetch failed|network|socket|terminated|other side closed/i.test(msg)
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts safe diagnostic metadata (`{ kind, statusCode, code, name }`) for
 * structured server logs without EVER returning secrets, headers, prompts,
 * URLs, or raw upstream response bodies. Unwraps `.cause` / `.lastError` so
 * a bare wrapper `Error` never hides the underlying HTTP status or provider code.
 */
export function safeErrorDiagnostic(error: unknown): SafeErrorDiagnostic {
  const kind = failureKind(error);
  if (error instanceof ModelFailure) {
    return {
      kind: error.code,
      statusCode: error.statusCode,
      code: error.upstreamCode ?? error.code,
      name: error.upstreamName ?? error.name,
    };
  }

  let statusCode: number | null = null;
  let code: string | null = null;
  let name: string | null = null;

  for (const link of collectErrorChain(error)) {
    if (link instanceof ModelFailure) {
      statusCode = statusCode ?? link.statusCode;
      code = code ?? link.upstreamCode ?? link.code;
      if (!name || name === "Error") {
        name = link.upstreamName ?? link.name;
      }
      continue;
    }
    if (!link || typeof link !== "object") {
      continue;
    }
    const e = link as ErrorLike;
    if (statusCode === null) {
      statusCode =
        sanitizeHttpStatusCode(e.statusCode) ??
        sanitizeHttpStatusCode(e.status);
    }
    if (code === null) {
      const sentinelMessageCode =
        typeof e.message === "string" &&
        e.message.includes("_") &&
        /^[a-z][a-z0-9_]{2,48}$/.test(e.message)
          ? sanitizeDiagToken(e.message)
          : null;
      code =
        sanitizeDiagToken(e.code) ??
        sanitizeDiagToken(e.data?.error?.code) ??
        sanitizeDiagToken(e.data?.error?.status) ??
        sanitizeDiagToken(e.data?.error?.type) ??
        sentinelMessageCode;
    }
    const candidateName = sanitizeDiagToken(e.name);
    if (
      candidateName &&
      (!name || (name === "Error" && candidateName !== "Error"))
    ) {
      name = candidateName;
    }
  }

  return {
    kind,
    statusCode,
    code,
    name,
  };
}

/** Inspect upstream data privately; never return raw messages, bodies or headers. */
export function failureKind(error: unknown): Failure {
  for (const link of collectErrorChain(error)) {
    if (link instanceof ModelFailure) {
      return link.code;
    }
    if (!link || typeof link !== "object") {
      continue;
    }
    const e = link as ErrorLike;
    if (e.name === "AbortError") {
      return "cancelled";
    }
    if (e.name === "TimeoutError" || e.name === "VertexTimeoutError") {
      return "transient";
    }
    const status =
      sanitizeHttpStatusCode(e.statusCode) ?? sanitizeHttpStatusCode(e.status);
    const code = extractRawCode(e);
    const msg = typeof e.message === "string" ? e.message : "";
    if (
      status === 402 ||
      /insufficient_funds|quota_for_entity_exceeded|customer_verification_required|insufficient_quota|credit_balance|spend_limit|usage_limit|billing/.test(
        code
      )
    ) {
      return "billing";
    }
    if (status === 401 || status === 403) {
      return "auth";
    }
    if (
      status === 429 ||
      /RESOURCE_EXHAUSTED|rate_limit|rateLimitExceeded/i.test(code) ||
      /\bmodel_rate\b/i.test(msg)
    ) {
      return "rate";
    }
    if (/context_length|context_window/.test(code) || status === 413) {
      return "context";
    }
    if (status === 408 || (status !== null && status >= 500 && status <= 599)) {
      return "transient";
    }
    if (isTransientNetworkLike(e)) {
      return "transient";
    }
  }
  return "unavailable";
}

export function isTimeoutError(error: unknown): boolean {
  for (const link of collectErrorChain(error)) {
    if (link instanceof ModelFailure) {
      if (
        link.statusCode === 504 ||
        link.upstreamCode === "vertex_timeout" ||
        link.upstreamName === "VertexTimeoutError"
      ) {
        return true;
      }
      continue;
    }
    if (!link || typeof link !== "object") {
      continue;
    }
    const e = link as ErrorLike;
    const status =
      sanitizeHttpStatusCode(e.statusCode) ?? sanitizeHttpStatusCode(e.status);
    if (
      e.name === "TimeoutError" ||
      e.name === "VertexTimeoutError" ||
      status === 504 ||
      extractRawCode(e) === "vertex_timeout"
    ) {
      return true;
    }
  }
  return false;
}

export function isPermanentNonRetryableError(error: unknown): boolean {
  const kind = failureKind(error);
  if (
    kind === "auth" ||
    kind === "billing" ||
    kind === "context" ||
    kind === "cancelled" ||
    kind === "tool" ||
    kind === "spend" ||
    kind === "work_boundary"
  ) {
    return true;
  }
  for (const link of collectErrorChain(error)) {
    if (link instanceof ModelFailure) {
      if (
        link.statusCode === 400 ||
        link.statusCode === 404 ||
        link.statusCode === 422 ||
        (link.upstreamCode &&
          PERMANENT_NON_RETRYABLE_CODES_RE.test(link.upstreamCode))
      ) {
        return true;
      }
      continue;
    }
    if (!link || typeof link !== "object") {
      continue;
    }
    const e = link as ErrorLike;
    const status =
      sanitizeHttpStatusCode(e.statusCode) ?? sanitizeHttpStatusCode(e.status);
    const code = extractRawCode(e);
    if (
      status === 400 ||
      status === 404 ||
      status === 422 ||
      PERMANENT_NON_RETRYABLE_CODES_RE.test(code)
    ) {
      return true;
    }
  }
  return false;
}

export function mayRetryVertexSameModel({
  error,
  failure,
  exposed,
  toolBoundary,
  retried,
  cancelled,
}: {
  error: unknown;
  failure: Failure;
  exposed: boolean;
  toolBoundary: boolean;
  retried: boolean;
  cancelled: boolean;
}): boolean {
  return (
    !cancelled &&
    !exposed &&
    !toolBoundary &&
    !retried &&
    !isPermanentNonRetryableError(error) &&
    !isTimeoutError(error) &&
    (failure === "transient" || failure === "rate")
  );
}

export function mayFallbackBetweenVertexModels({
  failure,
  exposed,
  toolBoundary,
  available,
  cancelled,
}: {
  failure: Failure;
  exposed: boolean;
  toolBoundary: boolean;
  available: boolean;
  cancelled: boolean;
}): boolean {
  return (
    available && !cancelled && !exposed && !toolBoundary && failure === "rate"
  );
}
export function mayFallback({
  failure,
  exposed,
  toolBoundary,
  used,
  available,
  cancelled,
}: {
  failure: Failure;
  exposed: boolean;
  toolBoundary: boolean;
  used: boolean;
  available: boolean;
  cancelled: boolean;
}) {
  return (
    available &&
    !cancelled &&
    !exposed &&
    !toolBoundary &&
    !used &&
    (failure === "transient" || failure === "structured")
  );
}

/**
 * Independent-provider fallback from Google Cloud Vertex AI (`gemini-4-hydrogen` /
 * `gemini-4-neon`) to GitHub Copilot SDK (`claude-haiku-5.5`) on the Cloud VM bridge.
 *
 * Fires ONLY on Vertex failure or timeout before any text/tool output is exposed,
 * NEVER when cancelled by the user and NEVER across the Korn Ferry `work_boundary`.
 */
export function mayFallbackFromVertexToCopilot({
  failure,
  exposed,
  toolBoundary,
  used,
  available,
  cancelled,
}: {
  failure: Failure;
  exposed: boolean;
  toolBoundary: boolean;
  used: boolean;
  available: boolean;
  cancelled: boolean;
}) {
  return (
    available &&
    !cancelled &&
    !exposed &&
    !toolBoundary &&
    !used &&
    failure !== "cancelled" &&
    failure !== "work_boundary" &&
    failure !== "context" &&
    failure !== "tool" &&
    failure !== "spend"
  );
}
