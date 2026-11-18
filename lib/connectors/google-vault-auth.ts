import { createHash } from "node:crypto";
import { isOwnerEmail } from "@/lib/access-policy";
import { extractGoogleClientProjectNumber as parseClientProjectNumber } from "@/lib/connectors/card-state";
import {
  createPostgresVaultStore,
  type SecretVaultStore,
  VaultError,
} from "@/lib/vault/secret-vault";

export {
  buildGoogleWorkspaceEnableApiUrl,
  extractGoogleClientProjectNumber,
} from "@/lib/connectors/card-state";

export const GOOGLE_VAULT_SECRET_NAMES = {
  accessToken: "GOOGLE_CONNECTOR_ACCESS_TOKEN",
  refreshToken: "GOOGLE_CONNECTOR_REFRESH_TOKEN",
  clientId: "GOOGLE_CONNECTOR_CLIENT_ID",
  clientSecret: "GOOGLE_CONNECTOR_CLIENT_SECRET",
} as const;

export const OWNER_GOOGLE_TEST_USER_EMAILS = [
  "csahingoz@gmail.com",
  "hawkeyedlion.wos@gmail.com",
] as const;

export const GOOGLE_WORKSPACE_CONNECT_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

/**
 * Allows an already-authenticated owner session to link Google Workspace tokens
 * from either the configured APP_OWNER_EMAIL or the owner's explicit OAuth test
 * accounts (`csahingoz@gmail.com` and `hawkeyedlion.wos@gmail.com`).
 * Initial app `/login` continues to require `isOwnerEmail` strictly.
 */
export function isAllowedOwnerGoogleConnectorEmail(email: unknown): boolean {
  if (isOwnerEmail(email)) {
    return true;
  }
  if (typeof email !== "string") {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  return (OWNER_GOOGLE_TEST_USER_EMAILS as readonly string[]).includes(
    normalized
  );
}

export type ResolvedGoogleAuth =
  | {
      ok: true;
      accessToken: string;
      source: "vault_access_token" | "vault_refresh_token";
      oauthClientProjectNumber?: string;
    }
  | {
      ok: false;
      code:
        | "vault_not_configured"
        | "connector_secret_missing"
        | "oauth_refresh_failed";
      message: string;
      oauthClientProjectNumber?: string;
    };

const refreshedTokenCache = new Map<
  string,
  { digest: string; accessToken: string; expiresAtMs: number }
>();

export function invalidateGoogleAccessTokenCache(userId: string): void {
  refreshedTokenCache.delete(userId);
}

export function isGoogleConnectorsEnabled(): boolean {
  return process.env.GOOGLE_CONNECTORS_ENABLED !== "false";
}

/**
 * Single source of truth for whether the owner's Vault currently holds usable
 * Google Workspace credentials (shared by `/api/connectors` and `/api/setup-status`).
 */
export function hasStoredGoogleConnection(
  storedSecretNames: ReadonlySet<string>,
  googleSignInReady: boolean
): boolean {
  if (!isGoogleConnectorsEnabled()) {
    return false;
  }
  const hasAccess = storedSecretNames.has(
    GOOGLE_VAULT_SECRET_NAMES.accessToken
  );
  const hasRefreshSet =
    storedSecretNames.has(GOOGLE_VAULT_SECRET_NAMES.refreshToken) &&
    (googleSignInReady ||
      (storedSecretNames.has(GOOGLE_VAULT_SECRET_NAMES.clientId) &&
        storedSecretNames.has(GOOGLE_VAULT_SECRET_NAMES.clientSecret)));
  return hasAccess || hasRefreshSet;
}

export async function resolveGoogleAccessTokenFromVault(opts: {
  userId: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}): Promise<ResolvedGoogleAuth> {
  const store = opts.vaultStore ?? createPostgresVaultStore();
  const fetchFn = opts.fetchImpl ?? fetch;
  const canUseRuntimeCache =
    !opts.fetchImpl && !opts.vaultStore && !opts.forceRefresh;
  const envProjectNumber = parseClientProjectNumber(process.env.AUTH_GOOGLE_ID);

  try {
    const [directToken, refreshToken, vaultClientId, vaultClientSecret] =
      await Promise.all([
        store.resolveSecret({
          userId: opts.userId,
          name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
        }),
        store.resolveSecret({
          userId: opts.userId,
          name: GOOGLE_VAULT_SECRET_NAMES.refreshToken,
        }),
        store.resolveSecret({
          userId: opts.userId,
          name: GOOGLE_VAULT_SECRET_NAMES.clientId,
        }),
        store.resolveSecret({
          userId: opts.userId,
          name: GOOGLE_VAULT_SECRET_NAMES.clientSecret,
        }),
      ]);

    const clientId =
      vaultClientId?.trim() || process.env.AUTH_GOOGLE_ID?.trim() || "";
    const clientSecret =
      vaultClientSecret?.trim() || process.env.AUTH_GOOGLE_SECRET?.trim() || "";
    const oauthClientProjectNumber =
      parseClientProjectNumber(clientId) ?? envProjectNumber ?? undefined;
    const projectSpread = oauthClientProjectNumber
      ? { oauthClientProjectNumber }
      : {};

    // Prefer OAuth refresh_token whenever present so 1-hour access tokens never go stale.
    if (refreshToken?.trim() && clientId && clientSecret) {
      const trimmedRefresh = refreshToken.trim();
      const digest = createHash("sha256")
        .update(`${opts.userId}:${trimmedRefresh}:${clientId}`)
        .digest("hex");

      if (canUseRuntimeCache) {
        const cached = refreshedTokenCache.get(opts.userId);
        if (
          cached &&
          cached.digest === digest &&
          cached.expiresAtMs > Date.now()
        ) {
          return {
            ok: true,
            accessToken: cached.accessToken,
            source: "vault_refresh_token",
            ...projectSpread,
          };
        }
      }

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: trimmedRefresh,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetchFn("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        refreshedTokenCache.delete(opts.userId);
        let oauthError = "unknown";
        try {
          const errPayload = (await response.json()) as {
            error?: string;
          };
          if (typeof errPayload.error === "string") {
            oauthError = errPayload.error.slice(0, 64);
          }
        } catch {
          /* ignore non-json error body */
        }
        console.error("[google-connector] oauth_refresh_failed", {
          httpStatus: response.status,
          oauthError,
          oauthClientProjectNumber,
        });
        return {
          ok: false,
          code: "oauth_refresh_failed",
          message:
            "Your Google connection expired or needs updated permissions. Tap Reconnect Google to continue.",
          ...projectSpread,
        };
      }

      const tokenJson = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!tokenJson.access_token?.trim()) {
        return {
          ok: false,
          code: "oauth_refresh_failed",
          message:
            "Your Google connection expired. Tap Reconnect Google to refresh access.",
          ...projectSpread,
        };
      }

      // Persist rotated refresh_token if Google issued a new one
      const rotatedRefresh = tokenJson.refresh_token?.trim();
      if (rotatedRefresh && rotatedRefresh !== trimmedRefresh) {
        await store
          .upsertSecret({
            userId: opts.userId,
            name: GOOGLE_VAULT_SECRET_NAMES.refreshToken,
            provider: "google",
            plaintext: rotatedRefresh,
          })
          .catch(() => undefined);
      }

      const minted = tokenJson.access_token.trim();
      if (canUseRuntimeCache) {
        const ttlSec = Math.max(
          60,
          Math.min(2700, Number(tokenJson.expires_in ?? 3300) - 300)
        );
        refreshedTokenCache.set(opts.userId, {
          digest,
          accessToken: minted,
          expiresAtMs: Date.now() + ttlSec * 1000,
        });
      }

      return {
        ok: true,
        accessToken: minted,
        source: "vault_refresh_token",
        ...projectSpread,
      };
    }

    if (directToken?.trim()) {
      return {
        ok: true,
        accessToken: directToken.trim(),
        source: "vault_access_token",
        ...projectSpread,
      };
    }

    return {
      ok: false,
      code: "connector_secret_missing",
      message:
        "Google isn't connected yet. Tap Connect Google to allow read-only Gmail, Calendar, and Drive access.",
      ...projectSpread,
    };
  } catch (error) {
    const envSpread = envProjectNumber
      ? { oauthClientProjectNumber: envProjectNumber }
      : {};
    if (
      error instanceof VaultError &&
      (error.code === "vault_key_missing" || error.code === "vault_unavailable")
    ) {
      return {
        ok: false,
        code: "vault_not_configured",
        message:
          "Secure account storage isn't ready yet. Open Setup to check your Google connection.",
        ...envSpread,
      };
    }
    return {
      ok: false,
      code: "oauth_refresh_failed",
      message:
        "Your Google connection expired. Tap Reconnect Google to refresh it.",
      ...envSpread,
    };
  }
}
