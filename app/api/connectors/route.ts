import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { vertexEnabled } from "@/lib/ai/routing/catalog";
import {
  GITHUB_VAULT_SECRET_NAME,
  isGithubConnectorEnabled,
} from "@/lib/connectors/calendar-and-github";
import {
  GOOGLE_VAULT_SECRET_NAMES,
  isGoogleConnectorsEnabled,
} from "@/lib/connectors/google-vault-auth";
import { isGoogleSignInConfigured } from "@/lib/google-owner";
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
  const googleSignInReady = isGoogleSignInConfigured();
  const vertexMediaReady = vertexEnabled();

  if (!vaultKeyReady) {
    return NextResponse.json({
      enabled,
      vaultConfigured: false,
      googleSignInReady,
      mediaReady: vertexMediaReady,
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
      ((names.has(GOOGLE_VAULT_SECRET_NAMES.clientId) &&
        names.has(GOOGLE_VAULT_SECRET_NAMES.clientSecret)) ||
        googleSignInReady);
    const ready = enabled && (hasAccess || hasRefreshSet);
    const hasGemini = names.has(VOICE_VAULT_SECRET_NAMES.geminiApiKey);
    const hasOpenAiVoice = names.has(VOICE_VAULT_SECRET_NAMES.openaiApiKey);
    const hasGithub = names.has(GITHUB_VAULT_SECRET_NAME);

    return NextResponse.json({
      enabled,
      vaultConfigured: true,
      googleSignInReady,
      mediaReady: vertexMediaReady || hasGemini,
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
        googleSignInReady,
        mediaReady: vertexMediaReady,
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

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = new URL(request.url).searchParams.get("provider") ?? "";
  const store = createPostgresVaultStore();

  try {
    if (provider === "google") {
      await Promise.all([
        store.deleteSecret({
          userId: session.user.id,
          name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
        }),
        store.deleteSecret({
          userId: session.user.id,
          name: GOOGLE_VAULT_SECRET_NAMES.refreshToken,
        }),
        store.deleteSecret({
          userId: session.user.id,
          name: GOOGLE_VAULT_SECRET_NAMES.clientId,
        }),
        store.deleteSecret({
          userId: session.user.id,
          name: GOOGLE_VAULT_SECRET_NAMES.clientSecret,
        }),
      ]);
      return NextResponse.json({ disconnected: "google" });
    }
    if (provider === "github") {
      await store.deleteSecret({
        userId: session.user.id,
        name: GITHUB_VAULT_SECRET_NAME,
      });
      return NextResponse.json({ disconnected: "github" });
    }
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: "Could not disconnect service" },
      { status: 500 }
    );
  }
}
