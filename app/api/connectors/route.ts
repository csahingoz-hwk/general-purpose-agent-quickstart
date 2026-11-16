import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  GOOGLE_VAULT_SECRET_NAMES,
  isGoogleConnectorsEnabled,
} from "@/lib/connectors/google-vault-auth";
import {
  createPostgresVaultStore,
  isVaultConfigured,
  VaultError,
} from "@/lib/vault/secret-vault";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isGoogleConnectorsEnabled();
  const vaultKeyReady = isVaultConfigured();

  if (!vaultKeyReady) {
    return NextResponse.json({
      enabled,
      vaultConfigured: false,
      policy: "read_and_draft_only_never_send",
      gmailReady: false,
      driveReady: false,
      configuredKeys: [],
      requiredAnyOf: [
        [GOOGLE_VAULT_SECRET_NAMES.accessToken],
        [
          GOOGLE_VAULT_SECRET_NAMES.refreshToken,
          GOOGLE_VAULT_SECRET_NAMES.clientId,
          GOOGLE_VAULT_SECRET_NAMES.clientSecret,
        ],
      ],
    });
  }

  try {
    const secrets = await createPostgresVaultStore().listSecrets(
      session.user.id
    );
    const names = new Set(secrets.map((s) => s.name));
    const hasAccess = names.has(GOOGLE_VAULT_SECRET_NAMES.accessToken);
    const hasRefreshSet =
      names.has(GOOGLE_VAULT_SECRET_NAMES.refreshToken) &&
      names.has(GOOGLE_VAULT_SECRET_NAMES.clientId) &&
      names.has(GOOGLE_VAULT_SECRET_NAMES.clientSecret);
    const ready = enabled && (hasAccess || hasRefreshSet);

    return NextResponse.json({
      enabled,
      vaultConfigured: true,
      policy: "read_and_draft_only_never_send",
      gmailReady: ready,
      driveReady: ready,
      configuredKeys: secrets
        .filter((s) =>
          (Object.values(GOOGLE_VAULT_SECRET_NAMES) as string[]).includes(
            s.name
          )
        )
        .map((s) => ({
          name: s.name,
          keyHint: s.keyHint,
          updatedAt: s.updatedAt,
        })),
      requiredAnyOf: [
        [GOOGLE_VAULT_SECRET_NAMES.accessToken],
        [
          GOOGLE_VAULT_SECRET_NAMES.refreshToken,
          GOOGLE_VAULT_SECRET_NAMES.clientId,
          GOOGLE_VAULT_SECRET_NAMES.clientSecret,
        ],
      ],
    });
  } catch (err) {
    if (err instanceof VaultError && err.code === "vault_unavailable") {
      return NextResponse.json({
        enabled,
        vaultConfigured: false,
        policy: "read_and_draft_only_never_send",
        gmailReady: false,
        driveReady: false,
        configuredKeys: [],
        setupRequired: true,
      });
    }
    return NextResponse.json(
      { error: "Failed to inspect connector status" },
      { status: 500 }
    );
  }
}
