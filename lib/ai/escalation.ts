import { HYDROGEN, LUNA, TERRA } from "./routing/catalog";

export type ActiveReasoningEffort = "low" | "medium" | "high";

const DEEP_RESEARCH_PATTERN =
  /\b(research|compare|comparison|versus|vs\.?|top\s+\d+|highest[- ]paid|top\s+earners?|annual\s+(?:pay|salary|compensation|earnings)|benchmark|analy[sz]e|in[- ]depth|comprehensive|breakdown|ranking|rank|araştır\p{L}*|karşılaştır\p{L}*|kıyasla\p{L}*|en\s+çok\s+kazanan\p{L}*|en\s+yüksek\s+(?:maaş|kazanç|gelir|ücret)\p{L}*|detaylı\s+(?:analiz|incele|rapor)\p{L}*|sıralama\p{L}*|yıllık\s+(?:maaş|kazanç|ücret|gelir)\p{L}*)\b/iu;

export function isResearchOrMultiSearchTurn(
  userText: string,
  requestedTools: readonly string[]
): { research: boolean; deepAnalytical: boolean } {
  const hasSearchOrDelegation =
    requestedTools.includes("webSearch") ||
    requestedTools.includes("delegateTask");
  const deepAnalytical =
    DEEP_RESEARCH_PATTERN.test(userText) || userText.trim().length >= 280;
  return {
    research: hasSearchOrDelegation || deepAnalytical,
    deepAnalytical,
  };
}

/**
 * Enforces the owner's research auto-escalation rule:
 * - Research and multi-search questions NEVER run on GPT-6 Luna or low effort,
 *   even if Luna was manually selected in the picker.
 * - Escalates to GPT-6.1 Terra (or Gemini 4 Hydrogen if Terra isn't listed on
 *   the Gateway) with medium or higher reasoning effort.
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
  const { research, deepAnalytical } = isResearchOrMultiSearchTurn(
    input.userText,
    input.requestedTools
  );

  const normalizedBase: ActiveReasoningEffort =
    input.baseEffort === "high"
      ? "high"
      : input.baseEffort === "medium"
        ? "medium"
        : input.selectedModelId === LUNA
          ? "low"
          : "medium";

  if (!research) {
    return {
      modelId: input.selectedModelId,
      reasoningEffort: normalizedBase,
      escalated: false,
    };
  }

  let targetModel = input.selectedModelId;
  let escalated = false;

  if (targetModel === LUNA) {
    if (input.availableModelIds.includes(TERRA)) {
      targetModel = TERRA;
      escalated = true;
    } else if (input.availableModelIds.includes(HYDROGEN)) {
      targetModel = HYDROGEN;
      escalated = true;
    }
  }

  // Medium effort on live webSearch loops keeps 4–8 search steps snappy while
  // meeting the >= medium floor; non-search deep research steps up to high.
  const targetEffort: ActiveReasoningEffort =
    deepAnalytical && !input.requestedTools.includes("webSearch")
      ? "high"
      : normalizedBase === "high"
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
