import { createHash } from "node:crypto";
import {
  createPostgresVaultStore,
  type SecretVaultStore,
  VaultError,
} from "@/lib/vault/secret-vault";

export const GOOGLE_VAULT_SECRET_NAMES = {
  accessToken: "GOOGLE_CONNECTOR_ACCESS_TOKEN",
  refreshToken: "GOOGLE_CONNECTOR_REFRESH_TOKEN",
  clientId: "GOOGLE_CONNECTOR_CLIENT_ID",
  clientSecret: "GOOGLE_CONNECTOR_CLIENT_SECRET",
} as const;

export const GOOGLE_WORKSPACE_CONNECT_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export type ResolvedGoogleAuth =
  | {
      ok: true;
      accessToken: string;
      source: "vault_access_token" | "vault_refresh_token";
    }
  | {
      ok: false;
      code:
        | "vault_not_configured"
        | "connector_secret_missing"
        | "oauth_refresh_failed";
      message: string;
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

export async function resolveGoogleAccessTokenFromVault(opts: {
  userId: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedGoogleAuth> {
  const store = opts.vaultStore ?? createPostgresVaultStore();
  const fetchFn = opts.fetchImpl ?? fetch;
  const canUseRuntimeCache = !opts.fetchImpl && !opts.vaultStore;

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
        return {
          ok: false,
          code: "oauth_refresh_failed",
          message:
            "Your Google connection expired or needs updated permissions. Tap Reconnect Google to continue.",
        };
      }

      const tokenJson = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!tokenJson.access_token?.trim()) {
        return {
          ok: false,
          code: "oauth_refresh_failed",
          message:
            "Your Google connection expired. Tap Reconnect Google to refresh access.",
        };
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
      };
    }

    if (directToken?.trim()) {
      return {
        ok: true,
        accessToken: directToken.trim(),
        source: "vault_access_token",
      };
    }

    return {
      ok: false,
      code: "connector_secret_missing",
      message:
        "Google isn't connected yet. Tap Connect Google to allow read-only Gmail, Calendar, and Drive access.",
    };
  } catch (error) {
    if (
      error instanceof VaultError &&
      (error.code === "vault_key_missing" || error.code === "vault_unavailable")
    ) {
      return {
        ok: false,
        code: "vault_not_configured",
        message:
          "Secure account storage isn't ready yet. Open Setup to check your Google connection.",
      };
    }
    return {
      ok: false,
      code: "oauth_refresh_failed",
      message:
        "Your Google connection expired. Tap Reconnect Google to refresh it.",
    };
  }
}
