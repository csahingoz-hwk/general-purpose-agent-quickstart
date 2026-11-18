import postgres from "postgres";
import { assertSafeCalendarOrGithubRequest } from "@/lib/connectors/calendar-and-github";
import { buildGoogleWorkspaceEnableApiUrl } from "@/lib/connectors/card-state";
import { resolveGoogleAccessTokenFromVault } from "@/lib/connectors/google-vault-auth";
import {
  assertSafeGoogleRequest,
  buildGoogleApiError,
} from "@/lib/connectors/google-workspace";
import {
  createPostgresVaultStore,
  isVaultConfigured,
  type SecretVaultStore,
} from "@/lib/vault/secret-vault";

export type GoogleWorkspaceServiceLabel =
  | "Gmail"
  | "Google Calendar"
  | "Google Drive";

export type GoogleWorkspaceHealthResult =
  | { status: "not_connected"; code: string }
  | { status: "ready" }
  | { status: "reconnect_required" }
  | { status: "upstream_degraded" }
  | {
      status: "service_disabled";
      disabledServices: GoogleWorkspaceServiceLabel[];
      projectNumber: string | null;
      enableApiUrl: string;
    };

type CachedHealthEntry = {
  result: GoogleWorkspaceHealthResult;
  expiresAt: number;
};

const healthCache = new Map<string, CachedHealthEntry>();
const READY_TTL_MS = 10 * 60_000;
const DISABLED_TTL_MS = 30_000;
const TRANSIENT_TTL_MS = 30_000;

export function clearGoogleWorkspaceHealthCache(userId?: string): void {
  if (userId) {
    healthCache.delete(userId);
    return;
  }
  healthCache.clear();
}

export function getCachedGoogleWorkspaceHealth(
  userId: string
): GoogleWorkspaceHealthResult | null {
  const cached = healthCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  return null;
}

export async function probeGoogleWorkspaceApiHealth(opts: {
  userId: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}): Promise<GoogleWorkspaceHealthResult> {
  if (!opts.forceRefresh && !opts.fetchImpl) {
    const cached = healthCache.get(opts.userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  const auth = await resolveGoogleAccessTokenFromVault({
    userId: opts.userId,
    vaultStore: opts.vaultStore,
    fetchImpl: opts.fetchImpl,
  });

  if (!auth.ok) {
    if (auth.code === "oauth_refresh_failed") {
      return { status: "reconnect_required" };
    }
    return { status: "not_connected", code: auth.code };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const nowIso = encodeURIComponent(new Date().toISOString());

  const probes: Array<{
    service: GoogleWorkspaceServiceLabel;
    url: string;
    assertSafe: (method: string, url: string) => URL;
  }> = [
    {
      service: "Gmail",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=in%3Ainbox",
      assertSafe: assertSafeGoogleRequest,
    },
    {
      service: "Google Calendar",
      url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=1&timeMin=${nowIso}`,
      assertSafe: assertSafeCalendarOrGithubRequest,
    },
    {
      service: "Google Drive",
      url: "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)",
      assertSafe: assertSafeGoogleRequest,
    },
  ];

  const disabledServices: GoogleWorkspaceServiceLabel[] = [];
  let detectedProjectNumber: string | null =
    auth.oauthClientProjectNumber ?? null;
  let sawReconnectRequired = false;
  let sawTransientError = false;

  await Promise.all(
    probes.map(async (probe) => {
      probe.assertSafe("GET", probe.url);
      const res = await fetchFn(probe.url, {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      }).catch(() => null);

      if (!res) {
        sawTransientError = true;
        return;
      }
      if (res.ok) {
        return;
      }

      const apiErr = await buildGoogleApiError(probe.service, res, {
        oauthClientProjectNumber: auth.oauthClientProjectNumber,
      });
      if (apiErr.reason === "service_disabled") {
        disabledServices.push(probe.service);
        if (apiErr.projectNumber) {
          detectedProjectNumber = apiErr.projectNumber;
        }
        return;
      }
      if (
        apiErr.reason === "token_expired" ||
        apiErr.reason === "scope_missing"
      ) {
        sawReconnectRequired = true;
        return;
      }
      sawTransientError = true;
    })
  );

  let result: GoogleWorkspaceHealthResult;
  let ttlMs = READY_TTL_MS;

  if (disabledServices.length > 0) {
    // Keep deterministic order matching probes array
    const ordered = probes
      .map((p) => p.service)
      .filter((s) => disabledServices.includes(s));
    result = {
      status: "service_disabled",
      disabledServices: ordered,
      projectNumber: detectedProjectNumber,
      enableApiUrl: buildGoogleWorkspaceEnableApiUrl(detectedProjectNumber),
    };
    ttlMs = DISABLED_TTL_MS;
  } else if (sawReconnectRequired) {
    result = { status: "reconnect_required" };
    ttlMs = DISABLED_TTL_MS;
  } else if (sawTransientError) {
    result = { status: "upstream_degraded" };
    ttlMs = TRANSIENT_TTL_MS;
  } else {
    result = { status: "ready" };
    ttlMs = READY_TTL_MS;
  }

  if (!opts.fetchImpl) {
    healthCache.set(opts.userId, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  return result;
}

let startupProbeTriggered = false;

/**
 * Non-blocking server startup health check for the owner's Google Workspace OAuth project.
 * Logs SERVICE_DISABLED to server logs and warms the Setup checklist health cache;
 * never exposes Cloud Console links in chat.
 */
export async function runStartupGoogleWorkspaceHealthCheck(): Promise<void> {
  if (startupProbeTriggered) {
    return;
  }
  startupProbeTriggered = true;

  const pgUrl =
    process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
  const ownerEmail = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  if (!pgUrl || !ownerEmail || !isVaultConfigured()) {
    return;
  }

  const sql = postgres(pgUrl, { max: 1, connect_timeout: 5 });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM "User" WHERE LOWER(email) = ${ownerEmail} LIMIT 1
    `;
    const ownerId = rows[0]?.id;
    if (!ownerId) {
      return;
    }
    const health = await probeGoogleWorkspaceApiHealth({
      userId: ownerId,
      vaultStore: createPostgresVaultStore(),
    });
    if (health.status === "service_disabled") {
      console.warn("[google-health] startup SERVICE_DISABLED detected", {
        disabledServices: health.disabledServices,
        projectNumber: health.projectNumber,
        setupChecklistOnly: true,
      });
    } else {
      console.info("[google-health] startup status", { status: health.status });
    }
  } catch {
    // Non-blocking startup probe; ignore transient cold-boot errors
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
