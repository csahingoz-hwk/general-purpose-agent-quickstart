import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { clearLiveCapabilityManifestCache } from "@/lib/ai/capability-manifest";
import { isCopilotTokenConfigured } from "@/lib/ai/copilot-vm-model";
import { vertexEnabled } from "@/lib/ai/routing/catalog";
import { isCloudComputerConfigured } from "@/lib/cloud-computer/client";
import {
  GITHUB_VAULT_SECRET_NAME,
  isGithubConnectorEnabled,
} from "@/lib/connectors/calendar-and-github";
import {
  type GoogleWorkspaceHealthResult,
  probeGoogleWorkspaceApiHealth,
} from "@/lib/connectors/google-health";
import { hasStoredGoogleConnection } from "@/lib/connectors/google-vault-auth";
import { isGoogleSignInConfigured } from "@/lib/google-owner";
import { isMacBridgeConfigured } from "@/lib/mac-bridge/client";
import { pingRedis } from "@/lib/ratelimit";
import {
  createPostgresVaultStore,
  isVaultConfigured,
} from "@/lib/vault/secret-vault";
import { VOICE_VAULT_SECRET_NAMES } from "@/lib/voice/voice-service";

export type SetupChecklistItem = {
  id: string;
  label: string;
  summary: string;
  status: "ready" | "action_needed" | "optional";
  actionKind: "none" | "connect_google" | "connect_github" | "external_link";
  externalUrl?: string;
  externalLabel?: string;
  connectedProvider?: "google" | "github";
};

type CachedSetupStatus = {
  payload: Record<string, unknown>;
  expiresAt: number;
};

const setupStatusCache = new Map<string, CachedSetupStatus>();
const SETUP_STATUS_TTL_MS = 10 * 60_000;

export function clearSetupStatusCache(userId?: string): void {
  clearLiveCapabilityManifestCache(userId);
  if (userId) {
    setupStatusCache.delete(userId);
    return;
  }
  setupStatusCache.clear();
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!forceRefresh) {
    const cached = setupStatusCache.get(session.user.id);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }
  }

  const vertexReady = vertexEnabled();
  const aiReady = vertexReady;
  const dbReady = Boolean(process.env.POSTGRES_URL?.trim());
  const vaultReady = isVaultConfigured();
  const googleSignInReady = isGoogleSignInConfigured();
  const githubOAuthReady = Boolean(
    process.env.AUTH_GITHUB_ID?.trim() && process.env.AUTH_GITHUB_SECRET?.trim()
  );
  const redisConfigured = Boolean(process.env.REDIS_URL?.trim());
  const cloudComputerReady = isCloudComputerConfigured();
  const copilotTokenReady = isCopilotTokenConfigured();
  const copilotFallbackReady = cloudComputerReady && copilotTokenReady;
  const macBridgeReady = isMacBridgeConfigured();

  const storedNames = new Set<string>();
  const vaultStore =
    vaultReady && dbReady ? createPostgresVaultStore() : undefined;

  const [redisReady, secretsResult] = await Promise.all([
    redisConfigured
      ? Promise.race([
          pingRedis(),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 1500)
          ),
        ]).catch(() => false)
      : Promise.resolve(false),
    vaultStore
      ? vaultStore.listSecrets(session.user.id).catch(() => [])
      : Promise.resolve([]),
  ]);

  for (const s of secretsResult) {
    storedNames.add(s.name);
  }

  const googleConnected = hasStoredGoogleConnection(
    storedNames,
    googleSignInReady
  );

  let googleHealth: GoogleWorkspaceHealthResult | null = null;
  if (googleConnected && vaultStore) {
    try {
      googleHealth = await Promise.race([
        probeGoogleWorkspaceApiHealth({
          userId: session.user.id,
          vaultStore,
          forceRefresh,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
    } catch {
      googleHealth = null;
    }
  }
  const googleServiceDisabled =
    googleHealth?.status === "service_disabled" ? googleHealth : null;

  const githubConnected =
    isGithubConnectorEnabled() &&
    (Boolean(process.env.GITHUB_CONNECTOR_PAT?.trim()) ||
      storedNames.has(GITHUB_VAULT_SECRET_NAME));

  const geminiReady =
    aiReady ||
    Boolean(process.env.GEMINI_API_KEY?.trim()) ||
    storedNames.has(VOICE_VAULT_SECRET_NAMES.geminiApiKey);

  const items: SetupChecklistItem[] = [
    {
      id: "core_ai",
      label: "Chat, web search, voice & images",
      summary: vertexReady
        ? "Active via Google Cloud Vertex AI (Gemini 4 Hydrogen -> Argon escalation on Google AI Ultra credit — zero pay-per-use APIs, no internal spend cap)."
        : "Turn on Vertex AI WIF (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE) in your Vercel project settings.",
      status: aiReady ? "ready" : "action_needed",
      actionKind: aiReady ? "none" : "external_link",
      externalUrl: aiReady ? undefined : "https://vercel.com/dashboard",
      externalLabel: aiReady ? undefined : "Open Vercel",
    },
    {
      id: "copilot_fallback",
      label: "Copilot Claude Haiku 5.5 fallback (Cloud VM)",
      summary: copilotFallbackReady
        ? "Active via Cloud VM bridge (COPILOT_GITHUB_TOKEN configured in Vercel/VM server env — answers only on Vertex failure or timeout)."
        : cloudComputerReady
          ? "Set COPILOT_GITHUB_TOKEN (GitHub token with Copilot Requests permission) in Vercel & Cloud VM server env."
          : "Connect Cloud Computer VM relay and set COPILOT_GITHUB_TOKEN in Vercel/VM server env to enable Claude Haiku 5.5 fallback.",
      status: copilotFallbackReady ? "ready" : "action_needed",
      actionKind: "external_link",
      externalUrl: "https://github.com/settings/personal-access-tokens/new",
      externalLabel: "Copilot token",
    },
    {
      id: "database_vault",
      label: "Private database & encrypted vault",
      summary:
        dbReady && vaultReady
          ? "Active automatically on Neon Postgres with AES-256-GCM encryption."
          : "Connect a Postgres store in Vercel.",
      status: dbReady && vaultReady ? "ready" : "action_needed",
      actionKind: dbReady && vaultReady ? "none" : "external_link",
      externalUrl:
        dbReady && vaultReady
          ? undefined
          : "https://vercel.com/dashboard/stores",
      externalLabel: dbReady && vaultReady ? undefined : "Vercel Stores",
    },
    {
      id: "google_workspace",
      label: "Google Gmail, Calendar & Drive",
      summary: googleServiceDisabled
        ? `Google account connected — enable ${googleServiceDisabled.disabledServices.join(", ")} API${googleServiceDisabled.projectNumber ? ` on project #${googleServiceDisabled.projectNumber}` : ""} once.`
        : googleConnected
          ? "Connected (read & unsent drafts only — never sends automatically)."
          : googleSignInReady
            ? "Click Connect to link your Google account for read & draft help."
            : "Create a Google OAuth client to enable one-click Google connection.",
      status: googleServiceDisabled
        ? "action_needed"
        : googleConnected
          ? "ready"
          : "action_needed",
      actionKind: googleServiceDisabled
        ? "external_link"
        : googleConnected
          ? "none"
          : googleSignInReady
            ? "connect_google"
            : "external_link",
      externalUrl: googleServiceDisabled
        ? googleServiceDisabled.enableApiUrl
        : !googleConnected && !googleSignInReady
          ? "https://console.cloud.google.com/apis/credentials"
          : undefined,
      externalLabel: googleServiceDisabled
        ? "Enable Google APIs"
        : !googleConnected && !googleSignInReady
          ? "Google Cloud Credentials"
          : undefined,
      connectedProvider:
        googleConnected && !googleServiceDisabled ? "google" : undefined,
    },
    {
      id: "github",
      label: "GitHub pull requests",
      summary: githubConnected
        ? "Connected (read pull requests & prepare draft reviews)."
        : githubOAuthReady
          ? "Click Connect to link your GitHub account."
          : "Optional — create a fine-grained GitHub token if you want PR review drafts.",
      status: githubConnected ? "ready" : "optional",
      actionKind: githubConnected
        ? "none"
        : githubOAuthReady
          ? "connect_github"
          : "external_link",
      externalUrl:
        !githubConnected && !githubOAuthReady
          ? "https://github.com/settings/tokens?type=beta"
          : undefined,
      externalLabel:
        !githubConnected && !githubOAuthReady
          ? "Create GitHub token"
          : undefined,
      connectedProvider: githubConnected ? "github" : undefined,
    },
    {
      id: "gemini_live",
      label: "Live voice conversations (Gemini 3.8 Live)",
      summary: vertexReady
        ? "Active automatically via Google Cloud Vertex AI on Ultra credit — zero API keys needed."
        : geminiReady
          ? "Active — hands-free voice runs on Gemini 3.8 Live."
          : "Configure Google Cloud Vertex AI WIF to enable hands-free voice.",
      status: geminiReady ? "ready" : "action_needed",
      actionKind: geminiReady ? "none" : "external_link",
      externalUrl: geminiReady
        ? undefined
        : "https://console.cloud.google.com/vertex-ai",
      externalLabel: geminiReady ? undefined : "Vertex AI",
    },
    {
      id: "cloud_computer",
      label: "Cloud Computer (Linux VM)",
      summary: cloudComputerReady
        ? "Active on Google Cloud (auto-wakes on demand, £0 net on Ultra credit)."
        : "Optional — connect your Google Cloud sandbox relay for remote Linux & browser runs.",
      status: cloudComputerReady ? "ready" : "optional",
      actionKind: "none",
    },
    {
      id: "mac_bridge",
      label: "Mac mini Tailscale bridge (tmux)",
      summary: macBridgeReady
        ? "Connected via private Tailscale SSH (non-admin botrunner, logged tmux sessions)."
        : "Optional — replace App Store Tailscale with standalone tailscaled and run ops/mac-bridge/setup-mac-bridge.sh.",
      status: macBridgeReady ? "ready" : "optional",
      actionKind: "none",
    },
    {
      id: "redis_store",
      label: "Background stream resume & rate limits",
      summary: redisReady
        ? "Active via Vercel Redis (ephemeral rate limits & mid-stream resume only — zero permanent data)."
        : redisConfigured
          ? "Redis URL is set, but the store could not be reached."
          : "Optional — add a Redis store in Vercel only if you want mid-stream mobile reconnects.",
      status: redisReady
        ? "ready"
        : redisConfigured
          ? "action_needed"
          : "optional",
      actionKind: redisReady ? "none" : "external_link",
      externalUrl: redisReady
        ? undefined
        : "https://vercel.com/dashboard/stores",
      externalLabel: redisReady ? undefined : "Vercel Stores",
    },
  ];

  const payload = {
    items,
    googleConnected,
    githubConnected,
    googleSignInReady,
    githubOAuthReady,
    vaultReady: dbReady && vaultReady,
  };
  setupStatusCache.set(session.user.id, {
    payload,
    expiresAt: Date.now() + SETUP_STATUS_TTL_MS,
  });

  return NextResponse.json(payload);
}
