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

    const [refreshToken, vaultClientId, vaultClientSecret] = await Promise.all([
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

    if (!refreshToken || !clientId || !clientSecret) {
      return {
        ok: false,
        code: "connector_secret_missing",
        message:
          "Google Workspace isn't connected yet. Open Settings and tap Connect Google to allow Gmail, Calendar, and Drive read/draft access.",
      };
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
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
          "Secure account storage isn't ready yet. Open Setup to check your Google connection.",
      };
    }
    return {
      ok: false,
      code: "oauth_refresh_failed",
      message: "Google connection expired. Tap Connect in Setup to refresh it.",
    };
  }
}
