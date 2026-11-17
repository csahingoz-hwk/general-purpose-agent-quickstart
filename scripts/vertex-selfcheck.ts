import { ARGON, HYDROGEN } from "../lib/ai/routing/catalog";
import {
  clearVertexTokenCacheForTests,
  getVertexProjectId,
  getVertexWifAccessToken,
  isVertexWifConfigured,
  resolveVercelOidcJwt,
} from "../lib/ai/vertex-auth";
import { createVertexGeminiAdapter } from "../lib/ai/vertex-model";

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

    const [hydrogenRes, argonRes] = await Promise.all([
      hydrogenAdapter.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Reply with exact word OK." }],
          },
        ],
        maxOutputTokens: 64,
        providerOptions: { openai: { reasoningEffort: "low" } },
        abortSignal: AbortSignal.timeout(20_000),
      }),
      argonAdapter.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Reply with exact word OK." }],
          },
        ],
        maxOutputTokens: 64,
        providerOptions: { openai: { reasoningEffort: "medium" } },
        abortSignal: AbortSignal.timeout(20_000),
      }),
    ]);

    if (hydrogenRes.content.length === 0 || argonRes.content.length === 0) {
      throw new Error(
        `Vertex Gemini probe returned empty content (hydrogenFinish=${hydrogenRes.finishReason.raw}, argonFinish=${argonRes.finishReason.raw})`
      );
    }

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
      `Vertex WIF self-check: PASS project=${projectId} auth=vercel-oidc-wif(${stsMs}ms) geminiApiKeyUsed=false endpoints=${[...hitHosts].length} hydrogen=ok argon=ok kfBlock=ok`
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
