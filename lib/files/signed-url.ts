import { createHmac, timingSafeEqual } from "node:crypto";
import type { AllowedAttachmentMediaType } from "./attachment-validator";

export const DEFAULT_SIGNED_FILE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type SignedFileTokenPayload = {
  v: 1;
  uid: string;
  fid: string;
  name: string;
  ct: AllowedAttachmentMediaType;
  size: number;
  ref: string;
  exp: number;
};

export type VerifySignedFileResult =
  | { valid: true; payload: SignedFileTokenPayload }
  | {
      valid: false;
      reason:
        | "secret_missing"
        | "malformed_token"
        | "invalid_signature"
        | "expired"
        | "owner_mismatch";
    };

function resolveSigningSecret(explicitSecret?: string): string | null {
  const candidate = (
    explicitSecret ??
    process.env.AUTH_SECRET ??
    process.env.SECRET_VAULT_KEY ??
    ""
  ).trim();
  if (candidate.length < 16 || candidate === "****") {
    return null;
  }
  return candidate;
}

function computeSignature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update("assistant-private-file-token-v1:")
    .update(encodedPayload)
    .digest();
}

export function createSignedFileToken(
  input: Omit<SignedFileTokenPayload, "v" | "exp"> & {
    ttlSeconds?: number;
    nowMs?: number;
    secret?: string;
  }
): string {
  const secret = resolveSigningSecret(input.secret);
  if (!secret) {
    throw new Error(
      "Signed file proxy requires AUTH_SECRET (or SECRET_VAULT_KEY) of at least 16 characters"
    );
  }
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_SIGNED_FILE_TTL_SECONDS;
  const payload: SignedFileTokenPayload = {
    v: 1,
    uid: input.uid,
    fid: input.fid,
    name: input.name,
    ct: input.ct,
    size: input.size,
    ref: input.ref,
    exp: nowSec + ttl,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = computeSignature(encodedPayload, secret).toString(
    "base64url"
  );
  return `${encodedPayload}.${signature}`;
}

export function buildSignedFileProxyUrl(opts: {
  origin: string;
  basePath?: string;
  token: string;
}): string {
  const normalizedBase = (opts.basePath ?? "").replace(/\/$/, "");
  const normalizedOrigin = opts.origin.replace(/\/$/, "");
  return `${normalizedOrigin}${normalizedBase}/api/files/${encodeURIComponent(opts.token)}`;
}

export function extractTokenFromPrivateFileUrl(url: string): string | null {
  try {
    const parsed = url.startsWith("/")
      ? new URL(url, "http://localhost")
      : new URL(url);
    const marker = "/api/files/";
    const idx = parsed.pathname.indexOf(marker);
    if (idx < 0) {
      return null;
    }
    const rest = parsed.pathname.slice(idx + marker.length);
    if (!rest || rest === "upload" || rest.includes("/")) {
      return null;
    }
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

export function verifySignedFileToken(
  token: string,
  opts?: {
    expectedUserId?: string;
    nowMs?: number;
    secret?: string;
    ignoreExpiry?: boolean;
  }
): VerifySignedFileResult {
  const secret = resolveSigningSecret(opts?.secret);
  if (!secret) {
    return { valid: false, reason: "secret_missing" };
  }

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx !== token.lastIndexOf(".")) {
    return { valid: false, reason: "malformed_token" };
  }

  const encodedPayload = token.slice(0, dotIdx);
  const encodedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !encodedSig) {
    return { valid: false, reason: "malformed_token" };
  }

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(encodedSig, "base64url");
  } catch {
    return { valid: false, reason: "malformed_token" };
  }

  const expectedSig = computeSignature(encodedPayload, secret);
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return { valid: false, reason: "invalid_signature" };
  }

  let payload: SignedFileTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as SignedFileTokenPayload;
  } catch {
    return { valid: false, reason: "malformed_token" };
  }

  if (
    payload?.v !== 1 ||
    typeof payload.uid !== "string" ||
    !payload.uid ||
    typeof payload.fid !== "string" ||
    !payload.fid ||
    typeof payload.name !== "string" ||
    typeof payload.ct !== "string" ||
    typeof payload.size !== "number" ||
    typeof payload.ref !== "string" ||
    !payload.ref ||
    typeof payload.exp !== "number"
  ) {
    return { valid: false, reason: "malformed_token" };
  }

  if (opts?.expectedUserId && payload.uid !== opts.expectedUserId) {
    return { valid: false, reason: "owner_mismatch" };
  }

  const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  if (!opts?.ignoreExpiry && payload.exp <= nowSec) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
