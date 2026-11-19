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

/**
 * Extracts safe diagnostic metadata (`{ kind, statusCode, code, name }`) for
 * structured server logs without EVER returning secrets, headers, prompts,
 * URLs, or raw upstream response bodies.
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
  const e = error as {
    name?: unknown;
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    message?: unknown;
    data?: {
      error?: {
        code?: unknown;
        status?: unknown;
        type?: unknown;
      };
    };
  } | null;

  const statusCode =
    sanitizeHttpStatusCode(e?.statusCode) ?? sanitizeHttpStatusCode(e?.status);
  const sentinelMessageCode =
    typeof e?.message === "string" &&
    e.message.includes("_") &&
    /^[a-z][a-z0-9_]{2,48}$/.test(e.message)
      ? sanitizeDiagToken(e.message)
      : null;
  const code =
    sanitizeDiagToken(e?.code) ??
    sanitizeDiagToken(e?.data?.error?.code) ??
    sanitizeDiagToken(e?.data?.error?.status) ??
    sanitizeDiagToken(e?.data?.error?.type) ??
    sentinelMessageCode;
  const name = sanitizeDiagToken(e?.name);

  return {
    kind,
    statusCode,
    code,
    name,
  };
}
/** Inspect upstream data privately; never return raw messages, bodies or headers. */
export function failureKind(error: unknown): Failure {
  if (error instanceof ModelFailure) {
    return error.code;
  }
  const e = error as {
    name?: string;
    statusCode?: number;
    data?: { error?: { code?: string; type?: string } };
    code?: string;
    message?: string;
  } | null;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") {
    return "cancelled";
  }
  const code = e?.data?.error?.code ?? e?.code ?? e?.data?.error?.type ?? "";
  if (
    e?.statusCode === 402 ||
    /insufficient_funds|quota_for_entity_exceeded|customer_verification_required|insufficient_quota|credit_balance|spend_limit|usage_limit|billing/.test(
      code
    )
  ) {
    return "billing";
  }
  if (e?.statusCode === 401 || e?.statusCode === 403) {
    return "auth";
  }
  if (e?.statusCode === 429) {
    return "rate";
  }
  if (/context_length|context_window/.test(code) || e?.statusCode === 413) {
    return "context";
  }
  if (e?.statusCode && e.statusCode >= 500 && e.statusCode <= 599) {
    return "transient";
  }
  return "unavailable";
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
