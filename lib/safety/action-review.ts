import { createHash } from "node:crypto";
import { detectPromptInjection } from "./untrusted-content";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ActionReviewResult = {
  toolName: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  digest: string;
  reasons: string[];
};

const READ_ONLY_TOOLS = new Set([
  "getWeather",
  "getCurrentTime",
  "getFixtures",
  "demoInbox",
  "listMySchedules",
  "recallMemories",
  "askUserQuestion",
  "webSearch",
  "gmailReadMessages",
  "driveReadFiles",
  "calendarReadEvents",
  "githubReadPullRequests",
]);

const INTERNAL_WRITE_TOOLS = new Set([
  "setHomeLocation",
  "setSoul",
  "createDocument",
  "editDocument",
  "updateDocument",
  "requestSuggestions",
  "saveProfileFact",
  "addJournalEntry",
]);

const ROUTINE_WRITE_TOOLS = new Set([
  "scheduleTask",
  "cancelSchedule",
  "enqueueBackgroundTask",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const sorted: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      sorted[k] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

export function computeActionDigest(toolName: string, input: unknown): string {
  const payload = JSON.stringify({
    tool: toolName,
    input: canonicalize(input),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function reviewActionRisk({
  toolName,
  input,
  hasUntrustedContext = false,
}: {
  toolName: string;
  input: unknown;
  hasUntrustedContext?: boolean;
}): ActionReviewResult {
  const digest = computeActionDigest(toolName, input);
  const serialized = JSON.stringify(input ?? {});
  const injection = detectPromptInjection(serialized);

  if (READ_ONLY_TOOLS.has(toolName)) {
    return {
      toolName,
      riskLevel: "low",
      requiresApproval: false,
      digest,
      reasons: ["Read-only lookup without external side effects."],
    };
  }

  if (INTERNAL_WRITE_TOOLS.has(toolName)) {
    if (hasUntrustedContext || injection.suspicious) {
      return {
        toolName,
        riskLevel: "high",
        requiresApproval: true,
        digest,
        reasons: [
          "Modifies stored assistant state while untrusted or suspicious content is present.",
        ],
      };
    }
    return {
      toolName,
      riskLevel: "medium",
      requiresApproval: false,
      digest,
      reasons: ["Updates owner-private workspace state."],
    };
  }

  if (ROUTINE_WRITE_TOOLS.has(toolName)) {
    return {
      toolName,
      riskLevel:
        hasUntrustedContext || injection.suspicious ? "critical" : "high",
      requiresApproval: true,
      digest,
      reasons: [
        "Changes recurring schedule or background task configuration.",
        ...(hasUntrustedContext
          ? ["Untrusted external content is present in this turn."]
          : []),
      ],
    };
  }

  const isCritical = hasUntrustedContext || injection.suspicious;
  return {
    toolName,
    riskLevel: isCritical ? "critical" : "high",
    requiresApproval: true,
    digest,
    reasons: [
      "External or outbound action requires explicit owner review before execution.",
      ...(hasUntrustedContext
        ? ["Untrusted external content is present in this turn."]
        : []),
      ...(injection.suspicious
        ? [
            `Suspicious payload pattern detected (${injection.signals.join(", ")}).`,
          ]
        : []),
    ],
  };
}
