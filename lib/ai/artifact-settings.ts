import { estimateModelTokens } from "./context/budget";
import { premiumLaneEnabled } from "./routing/catalog";

/** Nested artifact calls must obey the same provider/privacy policy as chat. */
export function artifactSettings(
  instructions: string,
  prompt: string,
  signal?: AbortSignal
) {
  const premium = premiumLaneEnabled();
  const maxOutputTokens = premium ? 2048 : 768;
  if (
    estimateModelTokens({ instructions, prompt }) + maxOutputTokens + 350 >
    (premium ? 32_768 : 3400)
  ) {
    throw new Error("chat_context_budget");
  }
  return {
    instructions,
    prompt,
    maxOutputTokens,
    onError: () => {
      /* Ledger and UI handle safe errors; never log upstream request bodies. */
    },
    maxRetries: 0,
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(signal ? [signal] : []),
    ]),
    providerOptions: { openai: { reasoningEffort: "low" } },
    telemetry: { recordInputs: false, recordOutputs: false },
  };
}
