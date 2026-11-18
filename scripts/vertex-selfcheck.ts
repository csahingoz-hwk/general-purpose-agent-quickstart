import type { LanguageModelV4 } from "@ai-sdk/provider";
import { ARGON, HYDROGEN } from "../lib/ai/routing/catalog";
import {
  clearVertexTokenCacheForTests,
  getVertexProjectId,
  getVertexWifAccessToken,
  isVertexWifConfigured,
  resolveVercelOidcJwt,
} from "../lib/ai/vertex-auth";
import { createVertexGeminiAdapter } from "../lib/ai/vertex-model";

async function measureStreamTtft(
  adapter: LanguageModelV4,
  promptText: string,
  reasoningEffort: "low" | "medium"
): Promise<{ ttftMs: number; totalMs: number; chars: number }> {
  const t0 = performance.now();
  const { stream } = await adapter.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: promptText }] }],
    maxOutputTokens: 256,
    providerOptions: { openai: { reasoningEffort } },
    abortSignal: AbortSignal.timeout(25_000),
  });
  const reader = stream.getReader();
  let ttftMs: number | null = null;
  let chars = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.type === "text-delta" && value.delta.length > 0) {
      if (ttftMs === null) {
        ttftMs = Math.round(performance.now() - t0);
      }
      chars += value.delta.length;
    }
  }
  const totalMs = Math.round(performance.now() - t0);
  if (ttftMs === null || chars === 0) {
    throw new Error("Vertex Gemini stream probe returned zero text deltas");
  }
  return { ttftMs, totalMs, chars };
}

async function withRetry429<T>(fn: () => PromiseLike<T>): Promise<T> {
  let lastErr: unknown;
  for (const delayMs of [0, 3000, 7000, 14_000]) {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("429") && !msg.includes("503")) {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function main() {
  if (!isVertexWifConfigured()) {
    console.log(
      "Vertex WIF self-check: SKIPPED (GOOGLE_VERTEX_PROJECT_ID / GOOGLE_VERTEX_WORKLOAD_AUDIENCE not set)"
    );
    return;
  }

  const oidcJwt = resolveVercelOidcJwt();
  if (!oidcJwt) {
    console.log(
      "Vertex WIF self-check: SKIPPED (VERCEL_OIDC_TOKEN not present in local environment)"
    );
    return;
  }

  const savedGeminiKey = process.env.GEMINI_API_KEY;
  Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
  clearVertexTokenCacheForTests();

  try {
    const projectId = getVertexProjectId();
    const t0 = Date.now();
    const accessToken = await getVertexWifAccessToken();
    const stsMs = Date.now() - t0;
    if (!accessToken) {
      throw new Error("STS returned empty access token");
    }

    const hitHosts = new Set<string>();
    const recordingFetch: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const parsed = new URL(url);
      hitHosts.add(`${parsed.hostname}${parsed.pathname}`);
      return fetch(input, init);
    };

    const hydrogenAdapter = createVertexGeminiAdapter(HYDROGEN, {
      fetcher: recordingFetch,
      getAccessToken: () => Promise.resolve(accessToken),
    });
    const argonAdapter = createVertexGeminiAdapter(ARGON, {
      fetcher: recordingFetch,
      getAccessToken: () => Promise.resolve(accessToken),
    });

    // Warm TLS socket to aiplatform.googleapis.com before measuring steady-state TTFT
    await withRetry429(() =>
      hydrogenAdapter.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "OK" }] }],
        maxOutputTokens: 16,
        providerOptions: { openai: { reasoningEffort: "low" } },
        abortSignal: AbortSignal.timeout(15_000),
      })
    );

    const hydrogenPerf = await withRetry429(() =>
      measureStreamTtft(
        hydrogenAdapter,
        "Merhaba! Bugün Londra'da nasıl bir gün planlayabilirim? Tek cümleyle söyle.",
        "low"
      )
    );
    const argonPerf = await withRetry429(() =>
      measureStreamTtft(
        argonAdapter,
        "Compare PostgreSQL vs SQLite in two concise bullet points.",
        "medium"
      )
    );

    let kfCalls = 0;
    let kfBlocked = false;
    const kfProbeAdapter = createVertexGeminiAdapter(HYDROGEN, {
      fetcher: () => {
        kfCalls++;
        return Promise.reject(new Error("unexpected_network_call"));
      },
      getAccessToken: () => Promise.resolve(accessToken),
    });

    try {
      await kfProbeAdapter.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              { type: "text", text: "Summarize Korn Ferry SA90 EOSB accrual" },
            ],
          },
        ],
      });
    } catch (err) {
      kfBlocked = (err as Error).message === "model_work_boundary";
    }

    if (!kfBlocked || kfCalls !== 0) {
      throw new Error(
        `Korn Ferry firewall check failed: blocked=${kfBlocked} calls=${kfCalls}`
      );
    }

    console.log(
      `Vertex WIF self-check: PASS project=${projectId} auth=vercel-oidc-wif(${stsMs}ms) geminiApiKeyUsed=false endpoints=${[...hitHosts].length} hydrogenTtft=${hydrogenPerf.ttftMs}ms(total=${hydrogenPerf.totalMs}ms) argonTtft=${argonPerf.ttftMs}ms(total=${argonPerf.totalMs}ms) kfBlock=ok`
    );
  } finally {
    if (savedGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = savedGeminiKey;
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Vertex WIF self-check: FAIL", err);
    process.exit(1);
  });
