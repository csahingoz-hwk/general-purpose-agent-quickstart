import type { UIMessage } from "ai";
import {
  type ChatModel,
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
  FALLBACK_CHAT_MODEL,
  getModelDisplayName,
} from "@/lib/ai/models";
import { getCopy, type UiLocale } from "@/lib/ui-copy";

export const AUTO_ROUTING_MODEL_ID = "auto" as const;

export type ModelPickerOption = {
  id: string;
  name: string;
  description: string;
  isAuto: boolean;
};

export type RoutedModelSummary = {
  modelId: string;
  modelName: string;
  shortName: string;
};

export function isVertexAutoRoutingPair(models: readonly ChatModel[]): boolean {
  return (
    models.some((model) => model.id === DEFAULT_CHAT_MODEL) &&
    models.some((model) => model.id === ESCALATED_RESEARCH_MODEL)
  );
}

export function isAutoRoutingSelection(
  selectedModelId: string,
  models: readonly ChatModel[]
): boolean {
  if (selectedModelId === AUTO_ROUTING_MODEL_ID) {
    return true;
  }
  return (
    isVertexAutoRoutingPair(models) && selectedModelId === DEFAULT_CHAT_MODEL
  );
}

export function getShortRoutedModelName(modelId: string): string {
  if (modelId === ESCALATED_RESEARCH_MODEL) {
    return "Neon";
  }
  if (modelId === DEFAULT_CHAT_MODEL) {
    return "Hydrogen";
  }
  if (modelId === FALLBACK_CHAT_MODEL) {
    return "Haiku";
  }
  return getModelDisplayName(modelId);
}

export function getLatestRoutedModelFromMessages(
  messages: readonly UIMessage[] | undefined
): RoutedModelSummary | null {
  if (!messages || messages.length === 0) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant" || !Array.isArray(msg.parts)) {
      continue;
    }
    for (let j = msg.parts.length - 1; j >= 0; j -= 1) {
      const part = msg.parts[j] as {
        type?: string;
        data?: { modelId?: string; modelName?: string };
      };
      if (part?.type === "data-model-used" && part.data?.modelId) {
        const modelId = part.data.modelId;
        const modelName = part.data.modelName || getModelDisplayName(modelId);
        return {
          modelId,
          modelName,
          shortName: getShortRoutedModelName(modelId),
        };
      }
    }
  }
  return null;
}

export function resolveModelPickerOptions(
  models: readonly ChatModel[],
  locale: UiLocale = "en"
): ModelPickerOption[] {
  const copy = getCopy(locale);
  if (!isVertexAutoRoutingPair(models)) {
    return models.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      isAuto: false,
    }));
  }

  return models.map((model) => {
    if (model.id === DEFAULT_CHAT_MODEL) {
      return {
        id: model.id,
        name: copy.modelAutoName,
        description: copy.modelAutoDescription,
        isAuto: true,
      };
    }
    if (model.id === ESCALATED_RESEARCH_MODEL) {
      return {
        id: model.id,
        name: model.name,
        description: copy.modelNeonDescription,
        isAuto: false,
      };
    }
    return {
      id: model.id,
      name: model.name,
      description: model.description,
      isAuto: false,
    };
  });
}

export function resolveModelPickerTriggerState(opts: {
  selectedModelId: string;
  models: readonly ChatModel[];
  messages?: readonly UIMessage[];
  locale?: UiLocale;
}): {
  label: string;
  ariaLabel: string;
  isAuto: boolean;
  routed: RoutedModelSummary | null;
} | null {
  const locale = opts.locale ?? "en";
  const copy = getCopy(locale);
  const options = resolveModelPickerOptions(opts.models, locale);
  const effectiveId =
    opts.selectedModelId === AUTO_ROUTING_MODEL_ID
      ? DEFAULT_CHAT_MODEL
      : opts.selectedModelId;
  const selected = options.find((opt) => opt.id === effectiveId);
  if (!selected) {
    return null;
  }

  const routed = selected.isAuto
    ? getLatestRoutedModelFromMessages(opts.messages)
    : null;
  const label =
    selected.isAuto && routed
      ? `${copy.modelAutoName} · ${routed.shortName}`
      : selected.name;

  return {
    label,
    ariaLabel: `${copy.modelMenuLabel}: ${label}`,
    isAuto: selected.isAuto,
    routed,
  };
}
