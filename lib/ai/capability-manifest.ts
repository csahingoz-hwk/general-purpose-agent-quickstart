import { isCloudComputerConfigured } from "@/lib/cloud-computer/client";
import {
  GITHUB_VAULT_SECRET_NAME,
  isGithubConnectorEnabled,
} from "@/lib/connectors/calendar-and-github";
import {
  FIRECRAWL_KEY_CREATE_URL,
  FIRECRAWL_SETUP_HREF,
  isFirecrawlConfigured,
} from "@/lib/connectors/firecrawl";
import {
  type GoogleWorkspaceHealthResult,
  getCachedGoogleWorkspaceHealth,
  probeGoogleWorkspaceApiHealth,
} from "@/lib/connectors/google-health";
import {
  hasStoredGoogleConnection,
  isGoogleConnectorsEnabled,
} from "@/lib/connectors/google-vault-auth";
import { isRoutinesEnabled } from "@/lib/cron/routine-presets";
import { isGoogleSignInConfigured } from "@/lib/google-owner";
import { isMacBridgeConfigured } from "@/lib/mac-bridge/client";
import { isMediaStudioEnabled } from "@/lib/media/media-studio";
import { isMemoryToolsEnabled } from "@/lib/memory/store";
import {
  createPostgresVaultStore,
  isVaultConfigured,
  type SecretVaultStore,
} from "@/lib/vault/secret-vault";
import {
  isVoiceEnabled,
  VOICE_VAULT_SECRET_NAMES,
} from "@/lib/voice/voice-service";
import { isCopilotTokenConfigured } from "./copilot-vm-model";
import { vertexEnabled } from "./routing/catalog";

export type CapabilityId =
  | "gmail"
  | "calendar"
  | "drive"
  | "github"
  | "firecrawl"
  | "mac_bridge"
  | "cloud_computer"
  | "voice"
  | "image"
  | "web_search"
  | "memory"
  | "routines"
  | "model_hydrogen"
  | "model_neon"
  | "model_copilot_fallback";

export type CapabilityState =
  | "connected_and_healthy"
  | "not_connected"
  | "error";

export type CapabilityManifestEntry = {
  id: CapabilityId;
  label: string;
  category: "connector" | "tool" | "model";
  state: CapabilityState;
  /** Technical cause in plain owner-readable words when `not_connected` or `error`. */
  reason?: string;
  /** Exact owner-only Setup checklist anchor (`/setup#setup-...`) or internal route. */
  setupHref: string;
  /** Optional one-tap OAuth connect link (`/connect/google/start?...`). */
  connectHref?: string;
  /** True when retrying the action or re-authing can recover an error state. */
  retryable?: boolean;
  /** Tool names wired to this capability. */
  tools: readonly string[];
};

export type CapabilityManifest = {
  entries: readonly CapabilityManifestEntry[];
};

export type BuildCapabilityManifestInput = {
  googleConnectorsEnabled?: boolean;
  googleSignInReady?: boolean;
  googleConnected: boolean;
  googleHealth?: GoogleWorkspaceHealthResult | null;
  githubConnectorEnabled?: boolean;
  githubConnected: boolean;
  githubErrorReason?: string;
  firecrawlConnected?: boolean;
  firecrawlErrorReason?: string;
  macBridgeConnected: boolean;
  macBridgeErrorReason?: string;
  cloudComputerConnected: boolean;
  cloudComputerErrorReason?: string;
  voiceReady: boolean;
  voiceErrorReason?: string;
  imageReady: boolean;
  imageErrorReason?: string;
  webSearchReady: boolean;
  webSearchErrorReason?: string;
  memoryReady: boolean;
  routinesReady: boolean;
  vertexReady: boolean;
  vertexErrorReason?: string;
  copilotTokenReady: boolean;
  copilotErrorReason?: string;
};

const GOOGLE_CONNECT_HREF =
  "/connect/google/start?returnTo=%2Fsetup%3Fconnected%3Dgoogle";

function buildGoogleServiceEntry(opts: {
  id: "gmail" | "calendar" | "drive";
  label: string;
  serviceTag: "Gmail" | "Google Calendar" | "Google Drive";
  tools: readonly string[];
  enabled: boolean;
  signInReady: boolean;
  connected: boolean;
  health?: GoogleWorkspaceHealthResult | null;
}): CapabilityManifestEntry {
  const setupHref = "/setup#setup-google_workspace";
  const connectHref = opts.signInReady ? GOOGLE_CONNECT_HREF : undefined;

  if (!opts.enabled) {
    return {
      id: opts.id,
      label: opts.label,
      category: "connector",
      state: "not_connected",
      reason: "Google Workspace connectors are disabled in server settings",
      setupHref,
      tools: opts.tools,
    };
  }

  if (!opts.connected || opts.health?.status === "not_connected") {
    return {
      id: opts.id,
      label: opts.label,
      category: "connector",
      state: "not_connected",
      reason:
        "Google account OAuth credentials are not linked in the encrypted Vault yet",
      setupHref,
      connectHref,
      tools: opts.tools,
    };
  }

  if (opts.health?.status === "reconnect_required") {
    return {
      id: opts.id,
      label: opts.label,
      category: "connector",
      state: "error",
      reason:
        "Google OAuth refresh token expired or was revoked — reconnect required",
      setupHref,
      connectHref,
      retryable: true,
      tools: opts.tools,
    };
  }

  if (
    opts.health?.status === "service_disabled" &&
    opts.health.disabledServices.includes(opts.serviceTag)
  ) {
    return {
      id: opts.id,
      label: opts.label,
      category: "connector",
      state: "error",
      reason: `${opts.serviceTag} backend API is currently disabled on the linked project`,
      setupHref,
      retryable: true,
      tools: opts.tools,
    };
  }

  if (opts.health?.status === "upstream_degraded") {
    return {
      id: opts.id,
      label: opts.label,
      category: "connector",
      state: "error",
      reason: `${opts.serviceTag} upstream API returned a temporary error`,
      setupHref,
      retryable: true,
      tools: opts.tools,
    };
  }

  return {
    id: opts.id,
    label: opts.label,
    category: "connector",
    state: "connected_and_healthy",
    setupHref,
    tools: opts.tools,
  };
}

/**
 * Deterministic builder for every capability wired into the app (both connected
 * and not connected / erroring). Never exposes raw secrets or Google Cloud Console URLs.
 */
export function buildCapabilityManifestFromStatus(
  input: BuildCapabilityManifestInput
): CapabilityManifest {
  const googleEnabled = input.googleConnectorsEnabled ?? true;
  const googleSignInReady = input.googleSignInReady ?? true;
  const githubEnabled = input.githubConnectorEnabled ?? true;
  const copilotReady =
    input.cloudComputerConnected &&
    input.copilotTokenReady &&
    !input.copilotErrorReason;

  const entries: CapabilityManifestEntry[] = [
    buildGoogleServiceEntry({
      id: "gmail",
      label: "Gmail (read & unsent drafts)",
      serviceTag: "Gmail",
      tools: ["gmailReadMessages", "gmailCreateDraft"],
      enabled: googleEnabled,
      signInReady: googleSignInReady,
      connected: input.googleConnected,
      health: input.googleHealth,
    }),
    buildGoogleServiceEntry({
      id: "calendar",
      label: "Google Calendar (read & draft events)",
      serviceTag: "Google Calendar",
      tools: ["calendarReadEvents", "calendarCreateDraftEvent"],
      enabled: googleEnabled,
      signInReady: googleSignInReady,
      connected: input.googleConnected,
      health: input.googleHealth,
    }),
    buildGoogleServiceEntry({
      id: "drive",
      label: "Google Drive (read & private [DRAFT] docs)",
      serviceTag: "Google Drive",
      tools: ["driveReadFiles", "driveCreateDraftDoc"],
      enabled: googleEnabled,
      signInReady: googleSignInReady,
      connected: input.googleConnected,
      health: input.googleHealth,
    }),
    input.githubErrorReason
      ? {
          id: "github",
          label: "GitHub Pull Requests (read & draft reviews)",
          category: "connector",
          state: "error",
          reason: input.githubErrorReason,
          setupHref: "/setup#setup-github",
          retryable: true,
          tools: ["githubReadPullRequests", "githubCreateDraftReview"],
        }
      : githubEnabled && input.githubConnected
        ? {
            id: "github",
            label: "GitHub Pull Requests (read & draft reviews)",
            category: "connector",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-github",
            tools: ["githubReadPullRequests", "githubCreateDraftReview"],
          }
        : {
            id: "github",
            label: "GitHub Pull Requests (read & draft reviews)",
            category: "connector",
            state: "not_connected",
            reason: githubEnabled
              ? "GitHub account or personal token is not connected in the Vault yet"
              : "GitHub connector is disabled in server settings",
            setupHref: "/setup#setup-github",
            tools: ["githubReadPullRequests", "githubCreateDraftReview"],
          },
    input.firecrawlErrorReason
      ? {
          id: "firecrawl",
          label: "Firecrawl Web Search, Scrape & Site Map",
          category: "connector",
          state: "error",
          reason: input.firecrawlErrorReason,
          setupHref: FIRECRAWL_SETUP_HREF,
          connectHref: FIRECRAWL_KEY_CREATE_URL,
          retryable: true,
          tools: ["firecrawlSearch", "firecrawlScrape", "firecrawlCrawlMap"],
        }
      : input.firecrawlConnected
        ? {
            id: "firecrawl",
            label: "Firecrawl Web Search, Scrape & Site Map",
            category: "connector",
            state: "connected_and_healthy",
            setupHref: FIRECRAWL_SETUP_HREF,
            tools: ["firecrawlSearch", "firecrawlScrape", "firecrawlCrawlMap"],
          }
        : {
            id: "firecrawl",
            label: "Firecrawl Web Search, Scrape & Site Map",
            category: "connector",
            state: "not_connected",
            reason:
              "FIRECRAWL_API_KEY is not configured in Vercel environment variables yet",
            setupHref: FIRECRAWL_SETUP_HREF,
            connectHref: FIRECRAWL_KEY_CREATE_URL,
            tools: ["firecrawlSearch", "firecrawlScrape", "firecrawlCrawlMap"],
          },
    input.macBridgeErrorReason
      ? {
          id: "mac_bridge",
          label: "Mac mini Bridge (private Tailscale SSH tmux)",
          category: "connector",
          state: "error",
          reason: input.macBridgeErrorReason,
          setupHref: "/setup#setup-mac_bridge",
          retryable: true,
          tools: ["macExec", "macRunAgentCli"],
        }
      : input.macBridgeConnected
        ? {
            id: "mac_bridge",
            label: "Mac mini Bridge (private Tailscale SSH tmux)",
            category: "connector",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-mac_bridge",
            tools: ["macExec", "macRunAgentCli"],
          }
        : {
            id: "mac_bridge",
            label: "Mac mini Bridge (private Tailscale SSH tmux)",
            category: "connector",
            state: "not_connected",
            reason:
              "Tailscale SSH bridge environment (MAC_BRIDGE_RELAY_URL / host) is not configured yet",
            setupHref: "/setup#setup-mac_bridge",
            tools: ["macExec", "macRunAgentCli"],
          },
    input.cloudComputerErrorReason
      ? {
          id: "cloud_computer",
          label: "Cloud Computer (Linux VM sandbox & browser)",
          category: "connector",
          state: "error",
          reason: input.cloudComputerErrorReason,
          setupHref: "/setup#setup-cloud_computer",
          retryable: true,
          tools: [
            "cloudExec",
            "cloudWriteFile",
            "cloudReadFile",
            "cloudExportFileToChat",
            "cloudBrowseUrl",
            "delegateTask",
          ],
        }
      : input.cloudComputerConnected
        ? {
            id: "cloud_computer",
            label: "Cloud Computer (Linux VM sandbox & browser)",
            category: "connector",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-cloud_computer",
            tools: [
              "cloudExec",
              "cloudWriteFile",
              "cloudReadFile",
              "cloudExportFileToChat",
              "cloudBrowseUrl",
              "delegateTask",
            ],
          }
        : {
            id: "cloud_computer",
            label: "Cloud Computer (Linux VM sandbox & browser)",
            category: "connector",
            state: "not_connected",
            reason:
              "Cloud Computer Linux VM relay (CLOUD_COMPUTER_RELAY_URL / HMAC secret) is not configured yet",
            setupHref: "/setup#setup-cloud_computer",
            tools: [
              "cloudExec",
              "cloudWriteFile",
              "cloudReadFile",
              "cloudExportFileToChat",
              "cloudBrowseUrl",
              "delegateTask",
            ],
          },
    input.voiceErrorReason
      ? {
          id: "voice",
          label: "Live Voice & Speech Dictation (Gemini 3.8 Live)",
          category: "tool",
          state: "error",
          reason: input.voiceErrorReason,
          setupHref: "/setup#setup-gemini_live",
          retryable: true,
          tools: [],
        }
      : input.voiceReady
        ? {
            id: "voice",
            label: "Live Voice & Speech Dictation (Gemini 3.8 Live)",
            category: "tool",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-gemini_live",
            tools: [],
          }
        : {
            id: "voice",
            label: "Live Voice & Speech Dictation (Gemini 3.8 Live)",
            category: "tool",
            state: "not_connected",
            reason:
              "Live voice Vertex AI WIF or speech credentials are not configured yet",
            setupHref: "/setup#setup-gemini_live",
            tools: [],
          },
    input.imageErrorReason
      ? {
          id: "image",
          label: "Image & Video Studio",
          category: "tool",
          state: "error",
          reason: input.imageErrorReason,
          setupHref: "/setup#setup-core_ai",
          retryable: true,
          tools: ["generateImageAsset", "generateVideoClip"],
        }
      : input.imageReady
        ? {
            id: "image",
            label: "Image & Video Studio",
            category: "tool",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-core_ai",
            tools: ["generateImageAsset", "generateVideoClip"],
          }
        : {
            id: "image",
            label: "Image & Video Studio",
            category: "tool",
            state: "not_connected",
            reason: "Image & Video Studio media backend is not configured yet",
            setupHref: "/setup#setup-core_ai",
            tools: ["generateImageAsset", "generateVideoClip"],
          },
    input.webSearchErrorReason
      ? {
          id: "web_search",
          label: "Web Search (live Google Search grounding)",
          category: "tool",
          state: "error",
          reason: input.webSearchErrorReason,
          setupHref: "/setup#setup-core_ai",
          retryable: true,
          tools: ["webSearch"],
        }
      : input.webSearchReady
        ? {
            id: "web_search",
            label: "Web Search (live Google Search grounding)",
            category: "tool",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-core_ai",
            tools: ["webSearch"],
          }
        : {
            id: "web_search",
            label: "Web Search (live Google Search grounding)",
            category: "tool",
            state: "not_connected",
            reason:
              "Live Web Search grounding requires Vertex AI WIF to be active",
            setupHref: "/setup#setup-core_ai",
            tools: ["webSearch"],
          },
    input.memoryReady
      ? {
          id: "memory",
          label: "Durable Memory & Journal (Postgres)",
          category: "tool",
          state: "connected_and_healthy",
          setupHref: "/setup#setup-database_vault",
          tools: ["recallMemories", "saveProfileFact", "addJournalEntry"],
        }
      : {
          id: "memory",
          label: "Durable Memory & Journal (Postgres)",
          category: "tool",
          state: "not_connected",
          reason: "Private Postgres memory database is not connected yet",
          setupHref: "/setup#setup-database_vault",
          tools: ["recallMemories", "saveProfileFact", "addJournalEntry"],
        },
    input.routinesReady
      ? {
          id: "routines",
          label: "Scheduled Routines & Reminders",
          category: "tool",
          state: "connected_and_healthy",
          setupHref: "/routines",
          tools: ["listMySchedules", "scheduleTask", "cancelSchedule"],
        }
      : {
          id: "routines",
          label: "Scheduled Routines & Reminders",
          category: "tool",
          state: "not_connected",
          reason: "Scheduled routines storage is not enabled yet",
          setupHref: "/routines",
          tools: ["listMySchedules", "scheduleTask", "cancelSchedule"],
        },
    input.vertexErrorReason
      ? {
          id: "model_hydrogen",
          label: "Model: Gemini 4 Hydrogen (default everyday Vertex AI model)",
          category: "model",
          state: "error",
          reason: input.vertexErrorReason,
          setupHref: "/setup#setup-core_ai",
          retryable: true,
          tools: [],
        }
      : input.vertexReady
        ? {
            id: "model_hydrogen",
            label:
              "Model: Gemini 4 Hydrogen (default everyday Vertex AI model)",
            category: "model",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-core_ai",
            tools: [],
          }
        : {
            id: "model_hydrogen",
            label:
              "Model: Gemini 4 Hydrogen (default everyday Vertex AI model)",
            category: "model",
            state: "not_connected",
            reason: "Vertex AI Workload Identity Federation is not configured",
            setupHref: "/setup#setup-core_ai",
            tools: [],
          },
    input.vertexErrorReason
      ? {
          id: "model_neon",
          label:
            "Model: Gemini 4 Neon (deep reasoning, research & visual escalation)",
          category: "model",
          state: "error",
          reason: input.vertexErrorReason,
          setupHref: "/setup#setup-core_ai",
          retryable: true,
          tools: [],
        }
      : input.vertexReady
        ? {
            id: "model_neon",
            label:
              "Model: Gemini 4 Neon (deep reasoning, research & visual escalation)",
            category: "model",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-core_ai",
            tools: [],
          }
        : {
            id: "model_neon",
            label:
              "Model: Gemini 4 Neon (deep reasoning, research & visual escalation)",
            category: "model",
            state: "not_connected",
            reason: "Vertex AI Workload Identity Federation is not configured",
            setupHref: "/setup#setup-core_ai",
            tools: [],
          },
    input.copilotErrorReason
      ? {
          id: "model_copilot_fallback",
          label:
            "Model: Claude Haiku 5.5 (Copilot Cloud VM automatic fallback)",
          category: "model",
          state: "error",
          reason: input.copilotErrorReason,
          setupHref: "/setup#setup-copilot_fallback",
          retryable: true,
          tools: [],
        }
      : copilotReady
        ? {
            id: "model_copilot_fallback",
            label:
              "Model: Claude Haiku 5.5 (Copilot Cloud VM automatic fallback)",
            category: "model",
            state: "connected_and_healthy",
            setupHref: "/setup#setup-copilot_fallback",
            tools: [],
          }
        : {
            id: "model_copilot_fallback",
            label:
              "Model: Claude Haiku 5.5 (Copilot Cloud VM automatic fallback)",
            category: "model",
            state: "not_connected",
            reason: input.cloudComputerConnected
              ? "COPILOT_GITHUB_TOKEN is not configured in server env yet"
              : "Cloud Computer VM relay and COPILOT_GITHUB_TOKEN are not configured yet",
            setupHref: "/setup#setup-copilot_fallback",
            tools: [],
          },
  ];

  return { entries };
}

/**
 * Returns all tool names belonging to `connected_and_healthy` capabilities in the
 * manifest (excluding `webSearch`, which is gated separately by live-fact intent
 * so Vertex never mixes `googleSearch` and `functionDeclarations` in one call).
 */
export function connectedToolsFromManifest(
  manifest: CapabilityManifest
): string[] {
  const out: string[] = [];
  for (const entry of manifest.entries) {
    if (entry.state !== "connected_and_healthy") {
      continue;
    }
    for (const toolName of entry.tools) {
      if (toolName === "webSearch") {
        continue;
      }
      if (!out.includes(toolName)) {
        out.push(toolName);
      }
    }
  }
  return out;
}

export type TurnToolFailure = {
  toolName: string;
  reason: string;
  code?: string;
};

function extractToolFailureFromOutput(
  toolName: string,
  output: unknown,
  errorText?: string
): TurnToolFailure | null {
  if (typeof errorText === "string" && errorText.trim()) {
    return {
      toolName,
      reason: errorText.trim().slice(0, 220),
      code: "tool_error",
    };
  }
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const obj = output as Record<string, unknown>;
  const status = typeof obj.status === "string" ? obj.status : "";
  const code = typeof obj.code === "string" ? obj.code : undefined;
  const message =
    typeof obj.message === "string" && obj.message.trim()
      ? obj.message.trim()
      : typeof obj.error === "string" && obj.error.trim()
        ? obj.error.trim()
        : "";

  if (obj.searchUnavailable === true) {
    return {
      toolName,
      reason:
        message ||
        "Live web search was unavailable and returned 0 results on this turn",
      code: code ?? "search_unavailable",
    };
  }
  if (
    status === "error" ||
    status === "connector_error" ||
    status === "reconnect_required" ||
    status === "setup_required" ||
    status === "blocked" ||
    status === "blocked_data_boundary"
  ) {
    return {
      toolName,
      reason: message || `Returned status "${status}"`,
      code: code ?? status,
    };
  }
  if (typeof obj.error === "string" && obj.error.trim()) {
    return {
      toolName,
      reason: obj.error.trim().slice(0, 220),
      code: code ?? "error",
    };
  }
  return null;
}

/**
 * Extracts failed tool calls from the latest assistant turn in persisted UI
 * messages so follow-up steps or turns never pretend the failed tool succeeded.
 */
export function extractFailedToolsFromMessages(
  messages: readonly { role: string; parts?: readonly unknown[] }[]
): TurnToolFailure[] {
  const failures: TurnToolFailure[] = [];
  const seen = new Set<string>();
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!lastAssistant || !Array.isArray(lastAssistant.parts)) {
    return failures;
  }
  for (const raw of lastAssistant.parts) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const part = raw as Record<string, unknown>;
    const rawType = typeof part.type === "string" ? part.type : "";
    if (!rawType.startsWith("tool-")) {
      continue;
    }
    const toolName =
      typeof part.toolName === "string" && part.toolName.trim()
        ? part.toolName.trim()
        : rawType.slice(5);
    const state = typeof part.state === "string" ? part.state : "";
    const errorText =
      state === "output-error"
        ? typeof part.errorText === "string"
          ? part.errorText
          : "Tool execution failed"
        : undefined;
    const hit = extractToolFailureFromOutput(toolName, part.output, errorText);
    if (hit) {
      const key = `${hit.toolName}:${hit.code ?? hit.reason}`;
      if (!seen.has(key)) {
        seen.add(key);
        failures.push(hit);
      }
    }
  }
  return failures;
}

/**
 * Extracts failed tool results from the current multi-step AI SDK `ModelMessage[]`
 * (since the latest user message) so `prepareStep` can inject exact failed-tool
 * facts into the next step's instructions.
 */
export function extractFailedToolsFromModelMessages(
  messages: readonly unknown[]
): TurnToolFailure[] {
  const failures: TurnToolFailure[] = [];
  const seen = new Set<string>();
  let startIdx = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string } | undefined;
    if (m?.role === "user") {
      startIdx = i + 1;
      break;
    }
  }
  for (let i = startIdx; i < messages.length; i += 1) {
    const m = messages[i] as
      | { role?: string; content?: readonly unknown[] }
      | undefined;
    if (m?.role !== "tool" || !Array.isArray(m.content)) {
      continue;
    }
    for (const raw of m.content) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const part = raw as Record<string, unknown>;
      const toolName =
        typeof part.toolName === "string" ? part.toolName : "tool";
      if (part.type === "tool-error") {
        const errMsg =
          typeof part.error === "string"
            ? part.error
            : part.error instanceof Error
              ? part.error.message
              : "Tool execution failed";
        const key = `${toolName}:${errMsg}`;
        if (!seen.has(key)) {
          seen.add(key);
          failures.push({ toolName, reason: errMsg, code: "tool_error" });
        }
        continue;
      }
      if (part.type !== "tool-result") {
        continue;
      }
      const out = part.output as
        | { type?: string; value?: unknown; reason?: string }
        | undefined;
      const value =
        out && typeof out === "object" && "value" in out ? out.value : out;
      const errorText =
        out?.type === "error-text" && typeof out.value === "string"
          ? out.value
          : out?.type === "error-json"
            ? typeof out.value === "string"
              ? out.value
              : JSON.stringify(out.value ?? "Tool returned an error")
            : undefined;
      const hit = extractToolFailureFromOutput(toolName, value, errorText);
      if (hit) {
        const key = `${hit.toolName}:${hit.code ?? hit.reason}`;
        if (!seen.has(key)) {
          seen.add(key);
          failures.push(hit);
        }
      }
    }
  }
  return failures;
}

export function formatTurnToolFailuresBlock(
  failures: readonly TurnToolFailure[]
): string {
  if (failures.length === 0) {
    return "";
  }
  const rows = failures.map(
    (f) =>
      `- tool=${f.toolName}${f.code ? ` | code=${f.code}` : ""} | reason="${f.reason.replace(/"/g, "'")}"`
  );
  return [
    "### Failed Tools On This Turn (Authoritative — Report Honestly)",
    ...rows,
    "- Mandatory honesty rule: One or more tools FAILED on this turn (listed above). Tell the user clearly and plainly (in their language) which tool failed and the real plain-language reason. NEVER claim that all features are active and working smoothly ('tüm özelliklerim aktif ve sorunsuz çalışıyor' / 'all features are active and working smoothly') and NEVER brush off a specific tool failure as a vague 'geçici teknik aksaklık'.",
  ].join("\n");
}

/**
 * Renders the authoritative Live Capability Manifest block injected into the
 * system prompt on every turn across all languages (Turkish, English, etc.).
 */
export function formatCapabilityManifestPrompt(
  manifest: CapabilityManifest,
  opts?: { turnToolFailures?: readonly TurnToolFailure[] }
): string {
  const connectedLabels: string[] = [];
  const unavailableLabels: string[] = [];
  const lines = manifest.entries.map((entry) => {
    const toolsPart =
      entry.tools.length > 0 ? ` | tools=${entry.tools.join(", ")}` : "";
    if (entry.state === "connected_and_healthy") {
      connectedLabels.push(entry.label);
      return `- [${entry.label}] state=connected_and_healthy${toolsPart} | setup=${entry.setupHref}`;
    }
    unavailableLabels.push(`${entry.label} (${entry.state})`);
    const connectPart = entry.connectHref
      ? ` | connect=${entry.connectHref}`
      : "";
    const retryPart = entry.retryable ? " | action=retry_or_reconnect" : "";
    return `- [${entry.label}] state=${entry.state} | cause="${entry.reason ?? "Unavailable"}" | fix=${entry.setupHref}${connectPart}${retryPart}${toolsPart}`;
  });

  const failuresBlock = opts?.turnToolFailures?.length
    ? `\n\n${formatTurnToolFailuresBlock(opts.turnToolFailures)}`
    : "";

  return (
    [
      "## Live App Capability Manifest (Authoritative — Apply in All Languages)",
      "Every connector, tool, and AI model wired into this app is listed below with its live status for THIS turn:",
      `Summary — Connected: ${connectedLabels.length > 0 ? connectedLabels.join(", ") : "none"}`,
      `Summary — Not connected / error: ${unavailableLabels.length > 0 ? unavailableLabels.join(", ") : "none"}`,
      ...lines,
      "",
      "### Mandatory Capability Rules (Apply in Turkish, English, and Every Language)",
      "1. **Connected & healthy (`state=connected_and_healthy`):** You HAVE live access right now. Use the matching tool directly whenever relevant, and NEVER claim 'no access', 'I cannot access', 'erişimim yok', 'not enabled', or 'bağlı değil' for any capability marked `connected_and_healthy`.",
      "2. **Not connected (`state=not_connected`):** When the user asks to use or asks about a capability marked `not_connected`, state clearly in plain words (in the user's language) that it is not connected yet, name the exact technical cause from `cause`, and give a clickable Markdown link to the exact owner Setup checklist item (`fix`, e.g. `[Setup checklist](/setup#setup-github)`) or one-tap Connect button (`connect`, e.g. `[Connect Google](/connect/google/start?returnTo=%2Fsetup%3Fconnected%3Dgoogle)`). NEVER direct users to Google Cloud Console (`console.cloud.google.com`), GCP project numbers, or raw API key pages.",
      "3. **Error (`state=error`):** When a capability is marked `error` (or a tool returns a retryable error), state in plain words (in the user's language) that the integration is wired in the app but currently experiencing an error, name the technical cause from `cause` (except `service_disabled`, where you output only the short neutral status line such as `'Gmail şu an kullanılamıyor, kurulum kontrol ediliyor'`), tell the user to retry or open the exact owner Setup checklist link (`fix`), and NEVER falsely claim the account is 'not connected' ('henüz bağlanmamış') or send users to Google Cloud Console.",
      "4. **Strict Honesty When Any Tool Fails (Never Fake All-Green Status):** Report REAL tool status honestly — name which tools are connected, which specific tool failed on this turn (or is disconnected/erroring), and the plain-language reason. NEVER claim 'tüm özelliklerim aktif ve sorunsuz çalışıyor' ('all my features are active and working smoothly') and NEVER hide a tool failure behind a vague 'geçici teknik aksaklık' ('temporary technical glitch') when any tool failed on this turn or any listed capability is not connected or in error.",
    ].join("\n") + failuresBlock
  );
}

const manifestCache = new Map<
  string,
  { manifest: CapabilityManifest; expiresAtMs: number }
>();
const MANIFEST_CACHE_TTL_MS = 5 * 60_000;

export function clearLiveCapabilityManifestCache(userId?: string): void {
  if (userId) {
    for (const key of manifestCache.keys()) {
      if (key === userId || key.startsWith(`${userId}:`)) {
        manifestCache.delete(key);
      }
    }
    return;
  }
  manifestCache.clear();
}

export async function resolveLiveCapabilityManifest(opts: {
  userId: string;
  isGuest: boolean;
  webSearchAvailable: boolean;
  vaultStore?: SecretVaultStore;
  forceRefresh?: boolean;
  /**
   * When true (used on latency-sensitive `/api/chat` & Live Voice session start),
   * uses cached Google health (`0ms` external HTTP latency) and triggers a
   * non-blocking background health refresh when uncached instead of blocking
   * first-token generation on 4 live Google API probes.
   */
  skipLiveProbe?: boolean;
}): Promise<CapabilityManifest> {
  const vertexReady = vertexEnabled();
  const dbReady = Boolean(process.env.POSTGRES_URL?.trim());
  const vaultReady = isVaultConfigured() && dbReady;
  const googleSignInReady = isGoogleSignInConfigured();
  const googleConnectorsEnabled = isGoogleConnectorsEnabled();
  const githubConnectorEnabled = isGithubConnectorEnabled();
  const cloudComputerConnected = isCloudComputerConfigured();
  const copilotTokenReady = isCopilotTokenConfigured();
  const macBridgeConnected = isMacBridgeConfigured();
  const firecrawlConnected = isFirecrawlConfigured();

  if (opts.isGuest) {
    return buildCapabilityManifestFromStatus({
      googleConnectorsEnabled: false,
      googleSignInReady,
      googleConnected: false,
      githubConnectorEnabled: false,
      githubConnected: false,
      firecrawlConnected: false,
      macBridgeConnected: false,
      cloudComputerConnected: false,
      voiceReady: false,
      imageReady: false,
      webSearchReady: opts.webSearchAvailable,
      memoryReady: false,
      routinesReady: false,
      vertexReady,
      copilotTokenReady,
    });
  }

  const envSig = [
    vertexReady ? "1" : "0",
    dbReady ? "1" : "0",
    vaultReady ? "1" : "0",
    firecrawlConnected ? "1" : "0",
    cloudComputerConnected ? "1" : "0",
    copilotTokenReady ? "1" : "0",
    macBridgeConnected ? "1" : "0",
    googleSignInReady ? "1" : "0",
    googleConnectorsEnabled ? "1" : "0",
    githubConnectorEnabled ? "1" : "0",
  ].join("");
  const cacheKey = `${opts.userId}:${opts.webSearchAvailable ? "1" : "0"}:${envSig}`;
  if (!opts.forceRefresh && !opts.vaultStore) {
    const hit = manifestCache.get(cacheKey);
    if (hit && hit.expiresAtMs > Date.now()) {
      return hit.manifest;
    }
  }

  const storedNames = new Set<string>();
  const store =
    opts.vaultStore ?? (vaultReady ? createPostgresVaultStore() : undefined);
  if (store) {
    try {
      const secrets = await store.listSecrets(opts.userId);
      for (const s of secrets) {
        storedNames.add(s.name);
      }
    } catch {
      /* ignore transient vault read blip */
    }
  }

  const googleConnected = hasStoredGoogleConnection(
    storedNames,
    googleSignInReady
  );
  let googleHealth: GoogleWorkspaceHealthResult | null = null;
  if (googleConnected && store) {
    if (opts.skipLiveProbe) {
      googleHealth = getCachedGoogleWorkspaceHealth(opts.userId);
      if (!googleHealth) {
        probeGoogleWorkspaceApiHealth({
          userId: opts.userId,
          vaultStore: store,
        })
          .then((result) => {
            if (result.status !== "ready") {
              clearLiveCapabilityManifestCache(opts.userId);
            }
          })
          .catch(() => null);
      }
    } else {
      googleHealth = await Promise.race([
        probeGoogleWorkspaceApiHealth({
          userId: opts.userId,
          vaultStore: store,
          forceRefresh: opts.forceRefresh,
        }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
      ]);
    }
  }

  const githubConnected =
    githubConnectorEnabled &&
    (Boolean(process.env.GITHUB_CONNECTOR_PAT?.trim()) ||
      storedNames.has(GITHUB_VAULT_SECRET_NAME));

  const hasGeminiKey =
    Boolean(process.env.GEMINI_API_KEY?.trim()) ||
    storedNames.has(VOICE_VAULT_SECRET_NAMES.geminiApiKey);
  const hasOpenAiVoiceKey = storedNames.has(
    VOICE_VAULT_SECRET_NAMES.openaiApiKey
  );

  const manifest = buildCapabilityManifestFromStatus({
    googleConnectorsEnabled,
    googleSignInReady,
    googleConnected,
    googleHealth,
    githubConnectorEnabled,
    githubConnected,
    firecrawlConnected,
    macBridgeConnected,
    cloudComputerConnected,
    voiceReady:
      isVoiceEnabled() && (vertexReady || hasGeminiKey || hasOpenAiVoiceKey),
    imageReady: isMediaStudioEnabled() && (vertexReady || hasGeminiKey),
    webSearchReady: opts.webSearchAvailable || vertexReady,
    memoryReady: dbReady && isMemoryToolsEnabled(),
    routinesReady: dbReady && isRoutinesEnabled(),
    vertexReady,
    copilotTokenReady,
  });

  if (!opts.vaultStore) {
    manifestCache.set(cacheKey, {
      manifest,
      expiresAtMs: Date.now() + MANIFEST_CACHE_TTL_MS,
    });
  }

  return manifest;
}
