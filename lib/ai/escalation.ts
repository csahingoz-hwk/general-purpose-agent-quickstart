import { ARGON, HYDROGEN } from "./routing/catalog";

export type ActiveReasoningEffort = "low" | "medium" | "high";

const HARD_OR_RESEARCH_PATTERN =
  /(?<![\p{L}\p{N}])(?:research|compare|comparison|versus|vs\.?|top\s+\d+|highest[- ]paid|top\s+earners?|annual\s+(?:pay|salary|compensation|earnings)|benchmark|analy[sz]e|analysis|in[- ]depth|comprehensive|breakdown|ranking|rank|prove|theorem|architect(?:ure)?|trade[- ]?offs?|root\s+cause|debug|reconcil\p{L}*|araştır\p{L}*|karşılaştır\p{L}*|kıyasla\p{L}*|en\s+çok\s+kazanan\p{L}*|en\s+yüksek\s+(?:maaş|kazanç|gelir|ücret)\p{L}*|detaylı\s+(?:analiz|incele|rapor)\p{L}*|sıralama\p{L}*|yıllık\s+(?:maaş|kazanç|ücret|gelir)\p{L}*|derinlemesine|kapsamlı|mimari|nedenini\s+bul)(?![\p{L}\p{N}])/iu;

export function isResearchOrHardTurn(
  userText: string,
  requestedTools: readonly string[]
): { escalate: boolean; hardAnalytical: boolean } {
  // Never escalate solely because webSearch is in requestedTools, or because a
  // chitchat/everyday prompt has two "?" marks or >240 characters. Escalate only
  // on heavy operator/CLI execution or genuine analytical/research intent.
  const hasHeavyOperatorTool =
    requestedTools.includes("delegateTask") ||
    requestedTools.includes("cloudExec") ||
    requestedTools.includes("macRunAgentCli");
  const hardAnalytical = HARD_OR_RESEARCH_PATTERN.test(userText);
  return {
    escalate: hasHeavyOperatorTool || hardAnalytical,
    hardAnalytical,
  };
}

const DEEP_PROOF_PATTERN =
  /(?<![\p{L}\p{N}])(?:prove|theorem|formal\s+proof|root\s+cause|kanıtla|teorem|nedenini\s+bul)(?![\p{L}\p{N}])/iu;

/**
 * Owner Vertex + Ultra routing rule:
 * - Default everyday chat runs on `gemini-4-hydrogen` with `low` effort (~1s first token)
 *   via Vertex AI (Ultra credit).
 * - Research, multi-search, comparisons, and hard questions automatically escalate to
 *   `gemini-4-argon` with `medium` effort (~2.5-3.5s first token) or `high` effort on
 *   deep proofs/root-cause tasks, via the same zero-key Vertex AI route.
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
  const { escalate } = isResearchOrHardTurn(
    input.userText,
    input.requestedTools
  );

  const normalizedBase: ActiveReasoningEffort =
    input.baseEffort === "high"
      ? "high"
      : input.baseEffort === "low" ||
          input.baseEffort === "minimal" ||
          input.baseEffort === "none"
        ? "low"
        : "medium";

  if (!escalate) {
    const everydayEffort: ActiveReasoningEffort =
      input.selectedModelId === HYDROGEN && !input.baseEffort
        ? "low"
        : normalizedBase;
    return {
      modelId: input.selectedModelId,
      reasoningEffort: everydayEffort,
      escalated: false,
    };
  }

  let targetModel = input.selectedModelId;
  let escalated = false;

  if (targetModel === HYDROGEN && input.availableModelIds.includes(ARGON)) {
    targetModel = ARGON;
    escalated = true;
  }

  const needsHighEffort =
    DEEP_PROOF_PATTERN.test(input.userText) &&
    !input.requestedTools.includes("webSearch");

  const targetEffort: ActiveReasoningEffort = needsHighEffort
    ? "high"
    : input.baseEffort === "high"
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
