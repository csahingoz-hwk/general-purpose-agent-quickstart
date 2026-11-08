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
  | "spend";
export class ModelFailure extends Error {
  readonly code: Failure;
  constructor(code: Failure) {
    super(`model_${code}`);
    this.code = code;
  }
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
