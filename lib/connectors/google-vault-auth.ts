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

export function isGoogleConnectorsEnabled(): boolean {
  return process.env.GOOGLE_CONNECTORS_ENABLED === "true";
}

export async function resolveGoogleAccessTokenFromVault(opts: {
  userId: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedGoogleAuth> {
  const store = opts.vaultStore ?? createPostgresVaultStore();
  const fetchFn = opts.fetchImpl ?? fetch;

  try {
    const directToken = await store.resolveSecret({
      userId: opts.userId,
      name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
    });
    if (directToken?.trim()) {
      return {
        ok: true,
        accessToken: directToken.trim(),
        source: "vault_access_token",
      };
    }

    const [refreshToken, clientId, clientSecret] = await Promise.all([
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

    if (!refreshToken || !clientId || !clientSecret) {
      return {
        ok: false,
        code: "connector_secret_missing",
        message:
          "Google connector credentials are not stored in the Secret Vault yet. Save GOOGLE_CONNECTOR_ACCESS_TOKEN (or GOOGLE_CONNECTOR_REFRESH_TOKEN + GOOGLE_CONNECTOR_CLIENT_ID + GOOGLE_CONNECTOR_CLIENT_SECRET) in /routines -> Secret Vault.",
      };
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
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
      return {
        ok: false,
        code: "oauth_refresh_failed",
        message: `Google OAuth token refresh failed (HTTP ${response.status}). Re-save a valid scoped token in Secret Vault.`,
      };
    }

    const tokenJson = (await response.json()) as { access_token?: string };
    if (!tokenJson.access_token?.trim()) {
      return {
        ok: false,
        code: "oauth_refresh_failed",
        message: "Google OAuth token response did not contain an access_token.",
      };
    }

    return {
      ok: true,
      accessToken: tokenJson.access_token.trim(),
      source: "vault_refresh_token",
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
          "Secret Vault is not configured or provisioned yet (check SECRET_VAULT_KEY and lib/db/parity-schema.sql).",
      };
    }
    return {
      ok: false,
      code: "oauth_refresh_failed",
      message: "Failed to resolve Google credentials from Secret Vault.",
    };
  }
}
