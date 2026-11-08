import { generateText } from "ai";
import { createGroqModel } from "./groq-model";
import { chatModels } from "./models";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export type Verification = {
  status: "not_configured" | "verification_failed" | "ready";
  modelIds: string[];
  checkedAt: string | null;
  diagnostic?: string;
};
export const unconfigured: Verification = {
  status: "not_configured",
  modelIds: [],
  checkedAt: null,
};

/** One bounded synthetic probe per candidate at build time. No user data or logs. */
export async function verifyGroqModels(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<Verification> {
  if (!apiKey?.trim()) {
    return { ...unconfigured };
  }
  const failed: Verification = {
    status: "verification_failed",
    modelIds: [],
    checkedAt: new Date().toISOString(),
  };
  const headers = {
    authorization: `Bearer ${apiKey.trim()}`,
    "content-type": "application/json",
  };
  try {
    const response = await fetcher(`${GROQ_BASE_URL}/models`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ...failed, diagnostic: `catalog_http_${response.status}` };
    }
    const data = await response.json();
    const listed = new Set(
      (data.data ?? []).map((model: { id: string }) => model.id)
    );
    const modelIds: string[] = [];
    let diagnostic = "no_supported_models";
    for (const model of chatModels) {
      if (!listed.has(model.id)) {
        continue;
      }
      try {
        const result = await generateText({
          model: createGroqModel(apiKey.trim(), model.id, fetcher),
          prompt: "Return only these two greetings: Merhaba Hello",
          maxOutputTokens: 128,
          maxRetries: 0,
          telemetry: { isEnabled: false },
          providerOptions: { openai: { reasoningEffort: "low" } },
          abortSignal: AbortSignal.timeout(15_000),
        });
        if (result.text.trim()) {
          modelIds.push(model.id);
        } else {
          diagnostic = "empty_response";
        }
      } catch (error) {
        const status =
          error && typeof error === "object" && "statusCode" in error
            ? error.statusCode
            : null;
        diagnostic =
          typeof status === "number" ? `probe_http_${status}` : "probe_failed";
        if (status === 401 || status === 403 || status === 429) {
          break;
        }
      }
    }
    return {
      ...failed,
      status: modelIds.length ? "ready" : "verification_failed",
      modelIds,
      ...(modelIds.length ? {} : { diagnostic }),
    };
  } catch {
    return { ...failed, diagnostic: "request_failed" };
  }
}

export function parseVerification(value: string | undefined): Verification {
  try {
    const data = JSON.parse(value ?? "{}");
    const ids = chatModels.map((model) => model.id);
    if (
      data.status !== "ready" ||
      !Array.isArray(data.modelIds) ||
      typeof data.checkedAt !== "string"
    ) {
      return { ...unconfigured };
    }
    const modelIds = data.modelIds.filter(
      (id: unknown): id is string => typeof id === "string" && ids.includes(id)
    );
    return {
      status: modelIds.length ? "ready" : "verification_failed",
      modelIds,
      checkedAt: data.checkedAt,
    };
  } catch {
    return { ...unconfigured };
  }
}
