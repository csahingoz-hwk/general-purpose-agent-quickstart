import { ARGON, HYDROGEN } from "./routing/catalog";

export type ActiveReasoningEffort = "low" | "medium" | "high";

const HARD_OR_RESEARCH_PATTERN =
  /(?<![\p{L}\p{N}])(?:research|compare|comparison|versus|vs\.?|top\s+\d+|highest[- ]paid|top\s+earners?|annual\s+(?:pay|salary|compensation|earnings)|benchmark|analy[sz]e|analysis|in[- ]depth|comprehensive|breakdown|ranking|rank|prove|theorem|architect(?:ure)?|trade[- ]?offs?|root\s+cause|debug|reconcil\p{L}*|araştır\p{L}*|karşılaştır\p{L}*|kıyasla\p{L}*|en\s+çok\s+kazanan\p{L}*|en\s+yüksek\s+(?:maaş|kazanç|gelir|ücret)\p{L}*|detaylı\s+(?:analiz|incele|rapor)\p{L}*|sıralama\p{L}*|yıllık\s+(?:maaş|kazanç|ücret|gelir)\p{L}*|derinlemesine|kapsamlı|mimari|nedenini\s+bul)(?![\p{L}\p{N}])/iu;

const SYNTHETIC_DEMO_GUARD_PATTERN =
  /\b(demo|mock|fictional|sample|synthetic|test inbox)\b|hayal[iî]|örnek|sahte/iu;

const VISUAL_CREATE_VERB_PATTERN =
  /(?<![\p{L}\p{N}])(?:draw|sketch|build|create|make|generate|design|render|produce|plot|write|çiz\p{L}*|oluştur\p{L}*|hazırla\p{L}*|yap\p{L}*|üret\p{L}*|tasarla\p{L}*)(?![\p{L}\p{N}])/iu;

const VISUAL_CREATION_NOUN_PATTERN =
  /(?<![\p{L}\p{N}])(?:dashboard\p{L}*|echarts|single[- ]file\s+html|html\s+(?:page|dashboard|report|briefing|card)\b|excalidraw|diagram\p{L}*|flowchart\p{L}*|flow\s+chart\p{L}*|sequence\s+diagram|architecture\s+diagram|system\s+diagram|er\s+diagram|org\s+chart|state\s+diagram|swimlane|infographic\p{L}*|info-graphic\p{L}*|diyagram\p{L}*|akış\s+şema\p{L}*|mimari\s+şema\p{L}*|organizasyon\s+şema\p{L}*|sistem\s+şema\p{L}*|gösterge\s+paneli|veri\s+paneli|infografik\p{L}*|bilgi\s+grafi[ğg]\p{L}*|tek\s+dosya(?:lık)?\s+html|html\s+(?:sayfa\p{L}*|panel\p{L}*|rapor\p{L}*))(?![\p{L}\p{N}])/iu;

export function isVisualCreationTurn(
  userText: string,
  requestedTools: readonly string[]
): boolean {
  if (
    requestedTools.includes("buildHtmlPageOrDashboard") ||
    requestedTools.includes("createExcalidrawDiagram") ||
    requestedTools.includes("generateInfographic")
  ) {
    return true;
  }
  if (SYNTHETIC_DEMO_GUARD_PATTERN.test(userText)) {
    return false;
  }
  if (/\b(?:excalidraw|echarts|single[- ]file\s+html)\b/iu.test(userText)) {
    return true;
  }
  return (
    VISUAL_CREATION_NOUN_PATTERN.test(userText) &&
    VISUAL_CREATE_VERB_PATTERN.test(userText)
  );
}

export function isResearchOrHardTurn(
  userText: string,
  requestedTools: readonly string[]
): { escalate: boolean; hardAnalytical: boolean; visualCreation?: boolean } {
  // Never escalate solely because webSearch is in requestedTools, or because a
  // chitchat/everyday prompt has two "?" marks or >240 characters. Escalate only
  // on heavy operator/CLI execution, visual creation (dashboards, diagrams,
  // infographics, single-file HTML pages), or genuine analytical/research intent.
  const hasHeavyOperatorTool =
    requestedTools.includes("delegateTask") ||
    requestedTools.includes("cloudExec") ||
    requestedTools.includes("macRunAgentCli");
  const visualCreation = isVisualCreationTurn(userText, requestedTools);
  const hardAnalytical = HARD_OR_RESEARCH_PATTERN.test(userText);
  return {
    escalate: hasHeavyOperatorTool || visualCreation || hardAnalytical,
    hardAnalytical,
    visualCreation,
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
