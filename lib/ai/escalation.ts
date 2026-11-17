import { ARGON, HYDROGEN, TERRA } from "./routing/catalog";

export type ActiveReasoningEffort = "low" | "medium" | "high";

const HARD_OR_RESEARCH_PATTERN =
  /\b(research|compare|comparison|versus|vs\.?|top\s+\d+|highest[- ]paid|top\s+earners?|annual\s+(?:pay|salary|compensation|earnings)|benchmark|analy[sz]e|analysis|in[- ]depth|comprehensive|breakdown|ranking|rank|prove|theorem|architect(?:ure)?|trade[- ]?offs?|root\s+cause|debug|reconcil\p{L}*|araştır\p{L}*|karşılaştır\p{L}*|kıyasla\p{L}*|en\s+çok\s+kazanan\p{L}*|en\s+yüksek\s+(?:maaş|kazanç|gelir|ücret)\p{L}*|detaylı\s+(?:analiz|incele|rapor)\p{L}*|sıralama\p{L}*|yıllık\s+(?:maaş|kazanç|ücret|gelir)\p{L}*|derinlemesine|kapsamlı|mimari|nedenini\s+bul)\b/iu;

export function isResearchOrHardTurn(
  userText: string,
  requestedTools: readonly string[]
): { escalate: boolean; hardAnalytical: boolean } {
  const hasResearchOrOperatorTool =
    requestedTools.includes("webSearch") ||
    requestedTools.includes("delegateTask") ||
    requestedTools.includes("cloudExec") ||
    requestedTools.includes("macRunAgentCli");
  const multiQuestion = (userText.match(/\?/g)?.length ?? 0) >= 2;
  const hardAnalytical =
    HARD_OR_RESEARCH_PATTERN.test(userText) ||
    userText.trim().length >= 240 ||
    multiQuestion;
  return {
    escalate: hasResearchOrOperatorTool || hardAnalytical,
    hardAnalytical,
  };
}

/**
 * Owner Vertex + Ultra routing rule:
 * - Default everyday chat runs on `gemini-4-hydrogen` via Vertex AI (Ultra credit).
 * - Research, multi-search, and hard questions automatically escalate to
 *   `gemini-4-argon` via the same zero-key Vertex AI route (or `gpt-6.1-terra`
 *   if Vertex Argon isn't in `availableModelIds`).
 * - Never selects or escalates to Luna or Gemini 3.8 Flash.
 */
export function resolveTurnModelAndEffort(input: {
  selectedModelId: string;
  availableModelIds: readonly string[];
  userText: string;
  requestedTools: readonly string[];
  baseEffort?: "none" | "minimal" | "low" | "medium" | "high";
}): {
  modelId: string;
  reasoningEffort: ActiveReasoningEffort;
  escalated: boolean;
} {
  const { escalate, hardAnalytical } = isResearchOrHardTurn(
    input.userText,
    input.requestedTools
  );

  const normalizedBase: ActiveReasoningEffort =
    input.baseEffort === "high"
      ? "high"
      : input.baseEffort === "low"
        ? "low"
        : "medium";

  if (!escalate) {
    return {
      modelId: input.selectedModelId,
      reasoningEffort:
        input.selectedModelId === ARGON ? "high" : normalizedBase,
      escalated: false,
    };
  }

  let targetModel = input.selectedModelId;
  let escalated = false;

  if (targetModel === HYDROGEN) {
    if (input.availableModelIds.includes(ARGON)) {
      targetModel = ARGON;
      escalated = true;
    } else if (input.availableModelIds.includes(TERRA)) {
      targetModel = TERRA;
      escalated = true;
    }
  }

  const targetEffort: ActiveReasoningEffort =
    hardAnalytical && !input.requestedTools.includes("webSearch")
      ? "high"
      : targetModel === ARGON && hardAnalytical
        ? "high"
        : "medium";

  if (targetEffort !== normalizedBase) {
    escalated = true;
  }

  return {
    modelId: targetModel,
    reasoningEffort: targetEffort,
    escalated,
  };
}
