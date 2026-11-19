import type { VertexCloudBillingStatus } from "@/lib/billing/vertex-cloud-usage";
import {
  FIRECRAWL_KEY_CREATE_URL,
  isFirecrawlConfigured,
  VERCEL_ENV_VARS_URL,
} from "@/lib/connectors/firecrawl";
import type { GoogleWorkspaceHealthResult } from "@/lib/connectors/google-health";
import type { CloudBillingMissingCode } from "@/lib/ui-copy";

export type SetupChecklistItem = {
  id: string;
  label: string;
  summary: string;
  status: "ready" | "action_needed" | "optional";
  actionKind: "none" | "connect_google" | "connect_github" | "external_link";
  externalUrl?: string;
  externalLabel?: string;
  secondaryExternalUrl?: string;
  secondaryExternalLabel?: string;
  connectedProvider?: "google" | "github";
  variant?: string;
  meta?: {
    disabledServices?: string[];
    projectNumber?: string | null;
    billingUsedUsd?: number;
    billingRemainingUsd?: number | null;
    billingMissingCode?: CloudBillingMissingCode | null;
    billingMissingDetail?: string | null;
    billingMissingReason?: string | null;
    billingProjectId?: string | null;
    billingAccountId?: string | null;
  };
};

export type SetupStatusPayload = {
  items: SetupChecklistItem[];
  googleConnected: boolean;
  githubConnected: boolean;
  googleSignInReady: boolean;
  githubOAuthReady: boolean;
  vaultReady: boolean;
};

export type SetupStatusProbes = {
  redisReady: boolean;
  storedSecretNames: string[];
  googleHealth: GoogleWorkspaceHealthResult | null;
  gcpBilling: VertexCloudBillingStatus | null;
};

type CachedSetupProbes = {
  probes: SetupStatusProbes;
  expiresAt: number;
};

const setupProbesCache = new Map<string, CachedSetupProbes>();
export const SETUP_STATUS_PROBES_TTL_MS = 10 * 60_000;

export function clearSetupProbesCache(userId?: string): void {
  if (userId) {
    setupProbesCache.delete(userId);
    return;
  }
  setupProbesCache.clear();
}

export function buildFirecrawlChecklistItem(
  firecrawlReady: boolean = isFirecrawlConfigured()
): SetupChecklistItem {
  if (firecrawlReady) {
    return {
      id: "firecrawl",
      label: "Firecrawl web search, scrape & site map",
      summary:
        "Active via FIRECRAWL_API_KEY in Vercel environment variables — server-side search, clean URL-to-Markdown scrape, and site mapping.",
      status: "ready",
      actionKind: "external_link",
      externalUrl: FIRECRAWL_KEY_CREATE_URL,
      externalLabel: "Manage key",
    };
  }
  return {
    id: "firecrawl",
    label: "Firecrawl web search, scrape & site map",
    summary:
      "Optional — There is no in-app API key input field. Connect in 2 steps: 1) Get your key at firecrawl.dev. 2) Add FIRECRAWL_API_KEY in Vercel Environment Variables and redeploy.",
    status: "optional",
    actionKind: "external_link",
    externalUrl: FIRECRAWL_KEY_CREATE_URL,
    externalLabel: "1. Get Firecrawl key",
    secondaryExternalUrl: VERCEL_ENV_VARS_URL,
    secondaryExternalLabel: "2. Vercel Env Variables",
  };
}

/**
 * Resolves `/api/setup-status` by caching only slow network/DB probes while
 * ALWAYS recomputing cheap server env flags (such as `FIRECRAWL_API_KEY`,
 * Vertex WIF, Cloud Computer, Mac Bridge, and Copilot token presence) live on
 * every request. Never caches a stale "not connected" state for env-backed
 * connectors.
 */
export async function resolveSetupStatusWithLiveEnv<T>(opts: {
  userId: string;
  forceRefresh?: boolean;
  now?: number;
  loadProbes: () => Promise<SetupStatusProbes>;
  assemble: (probes: SetupStatusProbes) => T;
}): Promise<T> {
  const now = opts.now ?? Date.now();
  let probes: SetupStatusProbes | null = null;

  if (!opts.forceRefresh) {
    const cached = setupProbesCache.get(opts.userId);
    if (cached && cached.expiresAt > now) {
      probes = cached.probes;
    }
  }

  if (!probes) {
    probes = await opts.loadProbes();
    setupProbesCache.set(opts.userId, {
      probes,
      expiresAt: now + SETUP_STATUS_PROBES_TTL_MS,
    });
  }

  return opts.assemble(probes);
}
