import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";

export const WORKSPACE_ROOT = "/workspace";

export type CloudCommandPolicyDecision =
  | { tier: "allow" }
  | { tier: "needs_approval"; reason: string }
  | { tier: "blocked"; reason: string };

const HARD_BLOCKED_CLOUD_CMD =
  /(?:169\.254\.169\.254|metadata\.google\.internal|computemetadata\/v1|\bsudo\b|\bsu\s+-|\btailscale\s+(?:funnel|serve)\b|\/proc\/\d+\/environ|\/etc\/shadow|:\(\)\s*\{)/i;

const APPROVAL_REQUIRED_CLOUD_CMD =
  /\b(?:git\s+push|gh\s+(?:pr|issue|release)\s+(?:create|merge|comment|close|edit)|npm\s+publish|pnpm\s+publish|twine\s+upload|curl\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|-d\s|-F\s|--upload-file)|wget\b[^\n]*--post-|ssh-keygen|scp\b|rsync\b)\b|rm\s+-[rf]{1,2}\s+\/workspace\/?(?:\s|$|\*)/i;

export function classifyCloudCommand(
  command: string
): CloudCommandPolicyDecision {
  const trimmed = command.trim();
  if (!trimmed) {
    return { tier: "blocked", reason: "Command cannot be empty." };
  }
  if (containsRestrictedWorkData(trimmed)) {
    return {
      tier: "blocked",
      reason:
        "Blocked: employer/Korn Ferry material cannot run on the personal Cloud Computer.",
    };
  }
  if (HARD_BLOCKED_CLOUD_CMD.test(trimmed)) {
    return {
      tier: "blocked",
      reason:
        "Blocked by Cloud Computer sandbox policy (no sudo, metadata server access, or public tunnels).",
    };
  }
  if (APPROVAL_REQUIRED_CLOUD_CMD.test(trimmed)) {
    return {
      tier: "needs_approval",
      reason:
        "Outbound push, network upload, or workspace-wide delete requires your approval first.",
    };
  }
  return { tier: "allow" };
}

/** Confines any relative or `/workspace/...` path strictly inside `/workspace`. */
export function resolveSafeWorkspacePath(rawPath = ""): string {
  const cleaned = rawPath.trim() || WORKSPACE_ROOT;
  if (cleaned.includes("\0")) {
    throw new Error("Invalid workspace path");
  }
  if (
    cleaned.startsWith("/") &&
    cleaned !== WORKSPACE_ROOT &&
    !cleaned.startsWith(`${WORKSPACE_ROOT}/`)
  ) {
    throw new Error(
      "Path escapes /workspace; absolute paths outside /workspace are blocked."
    );
  }
  const normalized = cleaned.startsWith(WORKSPACE_ROOT)
    ? path.posix.normalize(cleaned)
    : path.posix.normalize(path.posix.join(WORKSPACE_ROOT, cleaned));

  if (
    normalized !== WORKSPACE_ROOT &&
    !normalized.startsWith(`${WORKSPACE_ROOT}/`)
  ) {
    throw new Error(
      "Path escapes /workspace; Cloud Computer files must stay inside /workspace."
    );
  }
  return normalized;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) {
    return false;
  }
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => n < 0 || n > 255)) {
    return true;
  }
  const [a = 0, b = 0] = nums;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT / Tailscale range blocked from browser tool
  );
}

/** Prevents SSRF against GCP metadata (`169.254.169.254`), localhost, Tailscale, and RFC1918 IPs. */
export function validateCloudBrowseUrl(rawUrl: string): URL {
  if (containsRestrictedWorkData(rawUrl)) {
    throw new Error(
      "Blocked: employer/Korn Ferry URLs cannot be opened on the personal Cloud Computer."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".ts.net") ||
    host === "metadata" ||
    host === "metadata.google.internal" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:") ||
    host.startsWith("::ffff:") ||
    isPrivateIpv4(host)
  ) {
    throw new Error(
      "Blocked internal or metadata address on Cloud Computer browser."
    );
  }
  return parsed;
}

export function signCloudRelayRequest(opts: {
  secret: string;
  method: string;
  pathname: string;
  body: string;
  timestampMs?: number;
}): { timestamp: string; signature: string } {
  const secret = opts.secret.trim();
  if (secret.length < 16) {
    throw new Error("CLOUD_COMPUTER_HMAC_SECRET must be at least 16 chars");
  }
  const ts = String(opts.timestampMs ?? Date.now());
  const sig = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${ts}.${opts.method.toUpperCase()}.${opts.pathname}.`)
    .update(opts.body)
    .digest("hex");
  return { timestamp: ts, signature: sig };
}

export function verifyCloudRelayRequest(opts: {
  secret: string;
  method: string;
  pathname: string;
  body: string;
  timestamp: string;
  signature: string;
  nowMs?: number;
  maxSkewMs?: number;
}): boolean {
  const tsNum = Number.parseInt(opts.timestamp, 10);
  if (!Number.isFinite(tsNum)) {
    return false;
  }
  const skew = Math.abs((opts.nowMs ?? Date.now()) - tsNum);
  if (skew > (opts.maxSkewMs ?? 60_000)) {
    return false;
  }
  const expected = signCloudRelayRequest({
    secret: opts.secret,
    method: opts.method,
    pathname: opts.pathname,
    body: opts.body,
    timestampMs: tsNum,
  }).signature;
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(opts.signature, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

export type CloudExecResult = {
  status: "ok" | "error";
  exitCode: number;
  stdout: string;
  stderr: string;
  cwd: string;
  durationMs: number;
  vmWakeMs?: number;
  hostname?: string;
};

export type CloudFileReadResult = {
  status: "ok" | "error";
  path: string;
  sizeBytes: number;
  base64: string;
};

export type CloudBrowseResult = {
  status: "ok" | "error";
  url: string;
  title: string;
  fencedText: string;
  screenshotBase64?: string;
};

export function isCloudComputerConfigured(): boolean {
  return Boolean(
    process.env.CLOUD_COMPUTER_RELAY_URL?.trim() &&
      (process.env.CLOUD_COMPUTER_HMAC_SECRET?.trim() ||
        process.env.AUTH_SECRET?.trim())
  );
}

function resolveRelayConfig(override?: {
  relayUrl?: string;
  hmacSecret?: string;
}) {
  const relayUrl = (
    override?.relayUrl ??
    process.env.CLOUD_COMPUTER_RELAY_URL ??
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const hmacSecret = (
    override?.hmacSecret ??
    process.env.CLOUD_COMPUTER_HMAC_SECRET ??
    process.env.AUTH_SECRET ??
    ""
  ).trim();
  return { relayUrl, hmacSecret };
}

export async function callCloudRelay<T>(opts: {
  pathname: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const { relayUrl, hmacSecret } = resolveRelayConfig(opts);
  if (!relayUrl || hmacSecret.length < 16) {
    throw new Error(
      "Cloud Computer isn't connected yet. Check Setup to verify Cloud VM status."
    );
  }
  const body = JSON.stringify(opts.payload);
  if (containsRestrictedWorkData(body)) {
    throw new Error(
      "Blocked: employer/Korn Ferry material cannot leave to the personal Cloud Computer."
    );
  }
  const { timestamp, signature } = signCloudRelayRequest({
    secret: hmacSecret,
    method: "POST",
    pathname: opts.pathname,
    body,
  });
  const fetchFn = opts.fetchImpl ?? fetch;
  const res = await fetchFn(`${relayUrl}${opts.pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sandbox-Timestamp": timestamp,
      "X-Sandbox-Signature": signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 55_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        `Cloud Computer returned HTTP ${res.status}.`
    );
  }
  return data;
}

export async function cloudRunExec(opts: {
  command: string;
  cwd?: string;
  timeoutSec?: number;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<CloudExecResult> {
  const safeCwd = resolveSafeWorkspacePath(opts.cwd ?? WORKSPACE_ROOT);
  const timeoutSec = Math.max(2, Math.min(90, opts.timeoutSec ?? 30));
  return await callCloudRelay<CloudExecResult>({
    pathname: "/exec",
    payload: { command: opts.command, cwd: safeCwd, timeoutSec },
    timeoutMs: (timeoutSec + 25) * 1000,
    relayUrl: opts.relayUrl,
    hmacSecret: opts.hmacSecret,
    fetchImpl: opts.fetchImpl,
  });
}

export async function cloudWriteWorkspaceFile(opts: {
  path: string;
  contentBase64: string;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "ok"; path: string; bytesWritten: number }> {
  const safePath = resolveSafeWorkspacePath(opts.path);
  return await callCloudRelay({
    pathname: "/files/write",
    payload: { path: safePath, contentBase64: opts.contentBase64 },
    relayUrl: opts.relayUrl,
    hmacSecret: opts.hmacSecret,
    fetchImpl: opts.fetchImpl,
  });
}

export async function cloudReadWorkspaceFile(opts: {
  path: string;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<CloudFileReadResult> {
  const safePath = resolveSafeWorkspacePath(opts.path);
  return await callCloudRelay<CloudFileReadResult>({
    pathname: "/files/read",
    payload: { path: safePath },
    relayUrl: opts.relayUrl,
    hmacSecret: opts.hmacSecret,
    fetchImpl: opts.fetchImpl,
  });
}

export async function cloudBrowsePublicUrl(opts: {
  url: string;
  captureScreenshot?: boolean;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<CloudBrowseResult> {
  const validUrl = validateCloudBrowseUrl(opts.url);
  const raw = await callCloudRelay<{
    status: "ok";
    url: string;
    title: string;
    text: string;
    screenshotBase64?: string;
  }>({
    pathname: "/browse",
    payload: {
      url: validUrl.href,
      captureScreenshot: opts.captureScreenshot === true,
    },
    timeoutMs: 45_000,
    relayUrl: opts.relayUrl,
    hmacSecret: opts.hmacSecret,
    fetchImpl: opts.fetchImpl,
  });
  return {
    status: "ok",
    url: raw.url || validUrl.href,
    title: raw.title || validUrl.hostname,
    fencedText: fenceUntrustedContent({
      text: raw.text || "",
      source: `cloudBrowse:${validUrl.hostname}`,
      maxChars: 6000,
    }).fencedText,
    screenshotBase64: raw.screenshotBase64,
  };
}
