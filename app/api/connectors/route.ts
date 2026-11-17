import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  GITHUB_VAULT_SECRET_NAME,
  isGithubConnectorEnabled,
} from "@/lib/connectors/calendar-and-github";
import {
  GOOGLE_VAULT_SECRET_NAMES,
  isGoogleConnectorsEnabled,
} from "@/lib/connectors/google-vault-auth";
import {
  createPostgresVaultStore,
  isVaultConfigured,
  VaultError,
} from "@/lib/vault/secret-vault";
import { VOICE_VAULT_SECRET_NAMES } from "@/lib/voice/voice-service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isGoogleConnectorsEnabled();
  const githubEnabled = isGithubConnectorEnabled();
  const vaultKeyReady = isVaultConfigured();

  if (!vaultKeyReady) {
    return NextResponse.json({
      enabled,
      vaultConfigured: false,
      policy: "read_and_draft_only_never_send",
      gmailReady: false,
      driveReady: false,
      calendarReady: false,
      geminiReady: false,
      githubReady: false,
      voiceSttKeyReady: false,
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
    const hasGemini = names.has(VOICE_VAULT_SECRET_NAMES.geminiApiKey);
    const hasOpenAiVoice = names.has(VOICE_VAULT_SECRET_NAMES.openaiApiKey);
    const hasGithub = names.has(GITHUB_VAULT_SECRET_NAME);

    return NextResponse.json({
      enabled,
      vaultConfigured: true,
      policy: "read_and_draft_only_never_send",
      gmailReady: ready,
      driveReady: ready,
      calendarReady: ready,
      geminiReady: hasGemini,
      githubReady: githubEnabled && hasGithub,
      voiceSttKeyReady: hasGemini || hasOpenAiVoice,
      configuredKeys: secrets.map((s) => ({
        name: s.name,
        provider: s.provider,
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
        calendarReady: false,
        geminiReady: false,
        githubReady: false,
        voiceSttKeyReady: false,
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
