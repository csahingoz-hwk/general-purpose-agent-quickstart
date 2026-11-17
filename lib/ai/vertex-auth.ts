import { createHash } from "node:crypto";

const REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

type CachedStsToken = {
  accessToken: string;
  expiresAtMs: number;
  subjectHash: string;
};

let cachedStsToken: CachedStsToken | null = null;

export function getVertexProjectId(): string | null {
  return process.env.GOOGLE_VERTEX_PROJECT_ID?.trim() || null;
}

export function getVertexWorkloadAudience(): string | null {
  return process.env.GOOGLE_VERTEX_WORKLOAD_AUDIENCE?.trim() || null;
}

/**
 * Reads the short-lived Vercel OIDC JWT from the live request context header
 * (`x-vercel-oidc-token`) on Vercel Functions, or `process.env.VERCEL_OIDC_TOKEN`
 * during Vercel builds / local `vercel env pull`.
 *
 * Deliberately NEVER reads GEMINI_API_KEY or AI Studio keys (whose prepaid
 * credit is empty); Vertex AI calls bill strictly to GCP project
 * `project-cd0bc64c-0025-446c-b41` (`0140A2-72DEB2-62EDCD` Ultra Cloud credit).
 */
export function resolveVercelOidcJwt(): string | null {
  try {
    const ctxHolder = (globalThis as Record<symbol, unknown>)[
      REQUEST_CONTEXT_SYMBOL
    ] as
      | {
          get?: () => {
            headers?: Headers | Record<string, string | undefined>;
          };
        }
      | undefined;
    const headers = ctxHolder?.get?.()?.headers;
    if (headers) {
      if (typeof (headers as Headers).get === "function") {
        const val = (headers as Headers).get("x-vercel-oidc-token")?.trim();
        if (val) {
          return val;
        }
      } else {
        const record = headers as Record<string, string | undefined>;
        const val = (
          record["x-vercel-oidc-token"] ?? record["X-Vercel-Oidc-Token"]
        )?.trim();
        if (val) {
          return val;
        }
      }
    }
  } catch {
    /* ignore request-context lookup errors */
  }
  return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
}

export function isVertexWifConfigured(): boolean {
  return Boolean(getVertexProjectId() && getVertexWorkloadAudience());
}

export function resolveEffectiveWorkloadAudience(
  oidcJwt: string,
  configuredAudience: string
): string {
  try {
    const payloadPart = oidcJwt.split(".")[1];
    if (payloadPart) {
      const claims = JSON.parse(
        Buffer.from(payloadPart, "base64url").toString("utf8")
      ) as { iss?: string };
      if (claims.iss === "https://oidc.vercel.com") {
        return configuredAudience.replace(
          /\/providers\/[^/]+$/,
          "/providers/vercel-global"
        );
      }
    }
  } catch {
    /* keep configuredAudience */
  }
  return configuredAudience;
}

export async function getVertexWifAccessToken(
  fetcher: typeof fetch = fetch
): Promise<string> {
  const projectId = getVertexProjectId();
  const configuredAudience = getVertexWorkloadAudience();
  const oidcJwt = resolveVercelOidcJwt();

  if (!projectId || !configuredAudience) {
    throw Object.assign(new Error("vertex_wif_not_configured"), {
      statusCode: 401,
    });
  }
  if (!oidcJwt) {
    throw Object.assign(new Error("vercel_oidc_token_missing"), {
      statusCode: 401,
    });
  }

  const subjectHash = createHash("sha256")
    .update(`${configuredAudience}:${oidcJwt}`)
    .digest("hex")
    .slice(0, 16);

  const now = Date.now();
  if (
    cachedStsToken &&
    cachedStsToken.subjectHash === subjectHash &&
    cachedStsToken.expiresAtMs - now > 180_000
  ) {
    return cachedStsToken.accessToken;
  }

  const audience = resolveEffectiveWorkloadAudience(
    oidcJwt,
    configuredAudience
  );
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    subject_token: oidcJwt,
  });

  const res = await fetcher("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw Object.assign(new Error(`vertex_sts_rejected_${res.status}`), {
      statusCode: res.status,
    });
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw Object.assign(new Error("vertex_sts_empty_token"), {
      statusCode: 401,
    });
  }

  const ttlSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cachedStsToken = {
    accessToken: json.access_token,
    expiresAtMs: now + ttlSec * 1000,
    subjectHash,
  };
  return json.access_token;
}

export function clearVertexTokenCacheForTests() {
  cachedStsToken = null;
}
