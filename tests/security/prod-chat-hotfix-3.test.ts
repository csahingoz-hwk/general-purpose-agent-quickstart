import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import {
  buildCapabilityManifestFromStatus,
  type CapabilityManifest,
  extractFailedToolsFromMessages,
  extractFailedToolsFromModelMessages,
  formatCapabilityManifestPrompt,
} from "../../lib/ai/capability-manifest";
import {
  selectToolsWithRanking,
  shouldOfferWebSearch,
} from "../../lib/ai/context/select-tools";
import { isRedundantVisualCloudErrorPart } from "../../lib/ai/conversation-state";
import { createCopilotHaikuVmAdapter } from "../../lib/ai/copilot-vm-model";
import {
  isResearchOrHardTurn,
  resolveTurnModelAndEffort,
} from "../../lib/ai/escalation";
import { operatorToolsPrompt, systemPrompt } from "../../lib/ai/prompts";
import {
  extractFocusedSearchQueries,
  runPublicWebSearch,
} from "../../lib/ai/public-web-search";
import {
  COPILOT_HAIKU,
  HYDROGEN,
  NEON,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai/routing/catalog";
import { createUsageLedger } from "../../lib/ai/routing/ledger";
import { createRoutedModel } from "../../lib/ai/routing/model";
import type { InferenceSession } from "../../lib/ai/routing/session";
import { createVisualStudioTools } from "../../lib/ai/tools/visual-studio";
import {
  buildVertexRequestBody,
  createVertexGeminiAdapter,
  resolveVertexLocation,
} from "../../lib/ai/vertex-model";
import {
  clearVertexCloudBillingCacheForTests,
  getVertexCloudBillingStatus,
} from "../../lib/billing/vertex-cloud-usage";
import { buildFirecrawlNotConnectedResult } from "../../lib/connectors/firecrawl";
import { createInMemoryPrivateFileStore } from "../../lib/files/store";
import type { ChatMessage } from "../../lib/types";
import {
  FIRECRAWL_KEY_CREATE_URL,
  formatSetupChecklistItemCopy,
  uiCopy,
  VERCEL_ENV_VARS_URL,
  validateBilingualDictionary,
} from "../../lib/ui-copy";
import { webSearchView } from "../../lib/web-search-sources";

const ROOT = resolve(import.meta.dirname, "../..");

function mkUserMessage(text: string): ChatMessage {
  return {
    id: `u-${Math.random().toString(36).slice(2, 9)}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatMessage;
}

const FULL_OWNER_MANIFEST: CapabilityManifest = {
  entries: [
    {
      id: "gmail",
      label: "Gmail",
      category: "connector",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-google_workspace",
      tools: ["gmailReadMessages", "gmailCreateDraft"],
    },
    {
      id: "cloud_computer",
      label: "Cloud Computer",
      category: "connector",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-cloud_computer",
      tools: [
        "cloudExec",
        "cloudWriteFile",
        "cloudReadFile",
        "cloudExportFileToChat",
        "cloudBrowseUrl",
      ],
    },
    {
      id: "web_search",
      label: "Web Search",
      category: "tool",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-core_ai",
      tools: ["webSearch"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Issue 1: Research routing to Gemini 4 Neon + mandatory live search (no asking permission)
// ---------------------------------------------------------------------------
test("Issue 1a: Turkish/English sourced analysis & current-stats prompts offer webSearch, escalate to gemini-4-neon (valid thinking_level & location), and keep everyday turns on Hydrogen", () => {
  const livePrompt =
    "2026'da Türkiye enflasyonu hakkında kaynaklı kısa bir analiz yap";
  const researchPrompts = [
    livePrompt,
    "Türkiye enflasyonu hakkında kaynaklı kısa bir analiz yap",
    "Merkez Bankası faiz oranları hakkında kaynaklı analiz yap",
    "Write a short sourced analysis of Turkey's inflation in 2026",
    "Current statistics and cited analysis on global inflation rates",
  ];

  for (const prompt of researchPrompts) {
    const normalized = prompt.toLocaleLowerCase("en").normalize("NFC");
    assert.equal(
      shouldOfferWebSearch(normalized, true),
      true,
      `Expected shouldOfferWebSearch=true for: ${prompt}`
    );

    const selected = selectToolsWithRanking(
      [mkUserMessage(prompt)],
      true,
      true,
      {
        capabilityManifest: FULL_OWNER_MANIFEST,
      }
    );
    assert.equal(
      selected.activeTools.includes("webSearch"),
      true,
      `Expected webSearch in activeTools for: ${prompt}`
    );
    assert.equal(
      selected.intentMatchedTools.includes("webSearch"),
      true,
      `Expected webSearch in intentMatchedTools for: ${prompt}`
    );

    const hard = isResearchOrHardTurn(prompt, selected.intentMatchedTools);
    assert.equal(
      hard.escalate,
      true,
      `Expected escalation for research prompt: ${prompt}`
    );
    assert.equal(hard.hardAnalytical, true);

    const resolved = resolveTurnModelAndEffort({
      selectedModelId: HYDROGEN,
      availableModelIds: [HYDROGEN, NEON],
      userText: prompt,
      requestedTools: selected.intentMatchedTools,
      baseEffort: "low",
    });
    assert.equal(
      resolved.modelId,
      NEON,
      `Expected gemini-4-neon for "${prompt}", got ${resolved.modelId}`
    );
    assert.equal(resolved.escalated, true);
    assert.equal(
      resolved.modelId.includes("3.8"),
      false,
      "Must never select Gemini 3.8 Flash"
    );
  }

  // Vertex request body for Neon must allow only LOW/MEDIUM/HIGH/XHIGH (never MINIMAL or thinking_budget)
  // and resolve location to global/us/eu (never europe-west2).
  assert.equal(resolveVertexLocation("europe-west2"), "global");
  for (const [effort, expectedLevel] of [
    ["minimal", "LOW"],
    ["none", "LOW"],
    ["low", "LOW"],
    ["medium", "MEDIUM"],
    ["high", "HIGH"],
    ["xhigh", "XHIGH"],
  ] as const) {
    const body = buildVertexRequestBody(NEON, {
      prompt: [{ role: "user", content: [{ type: "text", text: livePrompt }] }],
      tools: [
        {
          type: "provider",
          id: WEB_SEARCH_TOOL_ID,
          name: "webSearch",
          args: { count: 5, needContent: false },
        },
      ],
      providerOptions: { openai: { reasoningEffort: effort } },
    });
    const genCfg = body.generationConfig as {
      thinkingConfig: Record<string, unknown>;
    };
    assert.equal(genCfg.thinkingConfig.thinkingLevel, expectedLevel);
    assert.equal("thinkingBudget" in genCfg.thinkingConfig, false);
    assert.equal("thinking_budget" in genCfg.thinkingConfig, false);
    const vertexTools = body.tools as Record<string, unknown>[];
    assert.deepEqual(vertexTools, [{ googleSearch: {} }]);
  }

  // Everyday chat still stays on Hydrogen
  for (const everyday of [
    "Merhaba, nasılsın?",
    "Bugün İstanbul'da hava nasıl?",
    "Rewrite this to sound friendlier: 'Send me the report now.'",
  ]) {
    const sel = selectToolsWithRanking([mkUserMessage(everyday)], true, true, {
      capabilityManifest: FULL_OWNER_MANIFEST,
    });
    const res = resolveTurnModelAndEffort({
      selectedModelId: HYDROGEN,
      availableModelIds: [HYDROGEN, NEON],
      userText: everyday,
      requestedTools: sel.intentMatchedTools,
      baseEffort: "low",
    });
    assert.equal(
      res.modelId,
      HYDROGEN,
      `Everyday prompt should stay on Hydrogen: ${everyday}`
    );
  }

  // System prompt for webSearch turns must explicitly forbid asking permission before searching
  const searchSys = systemPrompt({
    supportsTools: true,
    includeWebSearch: true,
  });
  assert.match(searchSys, /Aramayı şimdi başlatmamı ister misiniz/i);
  assert.match(searchSys, /never ask permission/i);
});

test("Issue 1b: Primary Neon grounded search works end-to-end; when Neon fails (429), Copilot Haiku fallback also executes web search and answers with dated sources instead of asking permission", async () => {
  const livePrompt =
    "2026'da Türkiye enflasyonu hakkında kaynaklı kısa bir analiz yap";

  // 1) Primary Neon grounded search succeeds with dated sources
  const neonSession: InferenceSession = {
    ledger: createUsageLedger("owner-1", "req-neon-research"),
    available: [HYDROGEN, NEON, COPILOT_HAIKU],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    activeModelId: NEON,
  };
  let requestedNeonUrl = "";
  const neonRouted = createRoutedModel(
    NEON,
    neonSession,
    (id) => {
      assert.equal(id, NEON, "Primary research turn must stay on Neon");
      return createVertexGeminiAdapter(NEON, {
        projectId: "proj-neon-live",
        location: "europe-west2",
        getAccessToken: () => Promise.resolve("ya29.test"),
        fetcher: ((url) => {
          requestedNeonUrl = String(url);
          const sse = [
            `data: ${JSON.stringify({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        text: "2026 yılı itibarıyla Türkiye'de yıllık enflasyon TÜİK verilerine göre gerileme eğilimindedir (Ekim 2026, TÜİK).",
                      },
                    ],
                  },
                  groundingMetadata: {
                    webSearchQueries: ["2026 Türkiye enflasyon TÜİK"],
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://data.tuik.gov.tr/enflasyon-2026",
                          title: "TÜİK Tüketici Fiyat Endeksi, Ekim 2026",
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 45,
              },
            })}\n\n`,
            "data: [DONE]\n\n",
          ].join("");
          return Promise.resolve(
            new Response(sse, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            })
          );
        }) as typeof fetch,
      });
    },
    { gateway: false, vertexSearch: true }
  );

  const neonStream = await neonRouted.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: livePrompt }] }],
    tools: [
      {
        type: "provider",
        id: WEB_SEARCH_TOOL_ID,
        name: "webSearch",
        args: { count: 5, needContent: false },
      },
    ],
    providerOptions: { openai: { reasoningEffort: "medium" } },
  });
  const neonParts: LanguageModelV4StreamPart[] = [];
  const neonReader = neonStream.stream.getReader();
  for (;;) {
    const item = await neonReader.read();
    if (item.done) {
      break;
    }
    neonParts.push(item.value);
  }
  assert.match(
    requestedNeonUrl,
    /\/locations\/global\/publishers\/google\/models\/gemini-4-neon:streamGenerateContent/
  );
  assert.equal(neonSession.fallbackUsed, false);
  assert.equal(neonSession.activeModelId, NEON);
  assert.ok(
    neonParts.some(
      (p) =>
        p.type === "tool-result" &&
        (p as { toolName?: string }).toolName === "webSearch"
    ),
    "Expected grounded webSearch tool-result on Neon"
  );

  // 2) Fallback path: Neon returns 429 RESOURCE_EXHAUSTED -> Copilot Haiku runs search automatically
  const fallbackSession: InferenceSession = {
    ledger: createUsageLedger("owner-1", "req-neon-429-fallback"),
    available: [HYDROGEN, NEON, COPILOT_HAIKU],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    activeModelId: NEON,
  };
  let copilotPayloadSent: Record<string, unknown> | null = null;
  let searchRanQuery = "";

  const fallbackRouted = createRoutedModel(
    NEON,
    fallbackSession,
    (id) => {
      if (id === NEON) {
        return createVertexGeminiAdapter(NEON, {
          projectId: "proj-neon-live",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  error: { code: 429, status: "RESOURCE_EXHAUSTED" },
                }),
                { status: 429, headers: { "content-type": "application/json" } }
              )
            ),
        });
      }
      return createCopilotHaikuVmAdapter({
        relayUrl: "https://relay.example.run.app",
        hmacSecret: "0123456789abcdef0123456789abcdef",
        copilotToken: "synthetic-unit-test-copilot-token",
        searchWeb: (q) => {
          searchRanQuery = q;
          return Promise.resolve([
            {
              title: "TÜİK: Ekim 2026 yıllık enflasyon %29,4 oldu",
              url: "https://www.reuters.com/world/middle-east/turkey-inflation-oct-2026",
              snippet:
                "2026-11-03 · Reuters: Türkiye'de yıllık TÜFE Ekim 2026'da %29,4 olarak açıklandı.",
              publishedDate: "2026-11-03",
            },
          ]);
        },
        fetcher: ((_url, init) => {
          copilotPayloadSent = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          const sse = [
            `data: ${JSON.stringify({
              type: "text-delta",
              delta:
                "Ekim 2026 TÜİK verilerine göre (3 Kasım 2026, [Reuters](https://www.reuters.com/world/middle-east/turkey-inflation-oct-2026)) yıllık enflasyon %29,4 seviyesindedir.",
            })}\n\n`,
            `data: ${JSON.stringify({
              type: "finish",
              finishReason: "stop",
              model: COPILOT_HAIKU,
            })}\n\n`,
            "data: [DONE]\n\n",
          ].join("");
          return Promise.resolve(
            new Response(sse, {
              status: 200,
              headers: { "content-type": "text/event-stream; charset=utf-8" },
            })
          );
        }) as typeof fetch,
      });
    },
    { gateway: false, vertexSearch: true }
  );

  const fbStream = await fallbackRouted.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: livePrompt }] }],
    tools: [
      {
        type: "provider",
        id: WEB_SEARCH_TOOL_ID,
        name: "webSearch",
        args: { count: 5, needContent: false },
      },
      {
        type: "function",
        name: "recallMemories",
        description: "Recall saved personal memories.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      },
    ],
  });
  const fbParts: LanguageModelV4StreamPart[] = [];
  const fbReader = fbStream.stream.getReader();
  for (;;) {
    const item = await fbReader.read();
    if (item.done) {
      break;
    }
    fbParts.push(item.value);
  }

  assert.equal(fallbackSession.fallbackUsed, true);
  assert.equal(fallbackSession.activeModelId, COPILOT_HAIKU);
  assert.match(searchRanQuery, /enflasyon/i);
  assert.ok(copilotPayloadSent, "Expected Copilot bridge request payload");
  assert.match(
    String((copilotPayloadSent as Record<string, unknown>).prompt ?? ""),
    /reuters\.com\/world\/middle-east\/turkey-inflation-oct-2026/
  );
  assert.match(
    String((copilotPayloadSent as Record<string, unknown>).system ?? ""),
    /Aramayı şimdi başlatmamı ister misiniz/i
  );

  const fbSearchResult = fbParts.find(
    (p) =>
      p.type === "tool-result" &&
      (p as { toolName?: string }).toolName === "webSearch"
  ) as unknown as {
    result?: { results?: Array<{ url: string; title: string }> };
    providerExecuted?: boolean;
  };
  assert.ok(fbSearchResult, "Copilot fallback must emit webSearch tool-result");
  assert.equal(fbSearchResult.providerExecuted, true);
  assert.equal(fbSearchResult.result?.results?.length, 1);

  const fbText = fbParts
    .filter((p) => p.type === "text-delta")
    .map((p) => p.delta)
    .join("");
  assert.match(fbText, /2026/);
  assert.doesNotMatch(fbText, /Aramayı şimdi başlatmamı ister misiniz/i);
});

// ---------------------------------------------------------------------------
// Issue 2: No extra ENOENT Cloud Computer error card on visual/dashboard turns
// ---------------------------------------------------------------------------
test("Issue 2: Visual dashboard turn omits Cloud VM export/read tools, buildHtmlPageOrDashboard never exposes phantom /workspace path on VM miss, and UI suppresses redundant ENOENT error sub-cards", async () => {
  // 1) Pure visual dashboard prompt must NOT attach cloudExportFileToChat / cloudReadFile
  const visualSelected = selectToolsWithRanking(
    [
      mkUserMessage(
        "2026 satış performansı için etkileşimli bir HTML dashboard hazırla"
      ),
    ],
    true,
    true,
    { capabilityManifest: FULL_OWNER_MANIFEST }
  );
  assert.equal(
    visualSelected.activeTools.includes("buildHtmlPageOrDashboard"),
    true
  );
  assert.equal(
    visualSelected.activeTools.includes("cloudExportFileToChat"),
    false,
    "Pure visual dashboard turn must not expose cloudExportFileToChat"
  );
  assert.equal(
    visualSelected.activeTools.includes("cloudReadFile"),
    false,
    "Pure visual dashboard turn must not expose cloudReadFile"
  );
  assert.equal(
    visualSelected.activeTools.includes("cloudWriteFile"),
    false,
    "Pure visual dashboard turn must not expose cloudWriteFile"
  );

  // 2) buildHtmlPageOrDashboard when Cloud VM write fails (502 / sleeping):
  //    must STILL succeed via in-app private fileStore and must NOT return a phantom /workspace path
  const fileStore = createInMemoryPrivateFileStore({ secret: "a".repeat(64) });
  const visualTools = createVisualStudioTools({
    userId: "owner-1",
    fileStore,
    signingSecret: "b".repeat(64),
    relayUrl: "https://vm.example.internal",
    hmacSecret: "c".repeat(64),
    fetchImpl: (() =>
      Promise.resolve(
        new Response('{"error":"VM sleeping"}', { status: 503 })
      )) as typeof fetch,
  });

  const out = (await visualTools.buildHtmlPageOrDashboard.execute?.(
    {
      filename: "sales_dashboard_2026.html",
      title: "2026 Satış Paneli",
      kpis: [{ label: "Gelir", value: "$1.2M", tone: "positive" }],
    },
    { toolCallId: "vis-1", messages: [] } as never
  )) as Record<string, unknown>;

  assert.equal(out.status, "ok");
  assert.equal(out.savedToCloudWorkspace, false);
  assert.equal(
    out.path,
    undefined,
    "Failed VM mirror must NOT return a phantom /workspace/sales_dashboard_2026.html path"
  );
  assert.match(
    String(out.previewUrl),
    /^\/api\/files\/.+\?disposition=inline$/
  );
  assert.match(String(out.downloadUrl), /^\/api\/files\/.+/);

  // toModelOutput must NEVER leak a /workspace/... path and must forbid calling cloudExportFileToChat
  const modelOut = visualTools.buildHtmlPageOrDashboard.toModelOutput?.({
    input: { title: "2026 Satış Paneli" },
    output: out as never,
    toolCallId: "vis-1",
  }) as { type: string; value: Record<string, unknown> };
  assert.equal(
    "path" in modelOut.value,
    false,
    "toModelOutput must omit /workspace path so the model never tries to stat/export it"
  );
  assert.match(
    String(modelOut.value.note ?? ""),
    /Do NOT call cloudExportFileToChat/i
  );

  // Prompt rules also explicitly forbid calling cloudExportFileToChat after buildHtmlPageOrDashboard
  assert.match(
    operatorToolsPrompt,
    /Do NOT call `cloudExportFileToChat`.*buildHtmlPageOrDashboard/i
  );

  // 3) UI defense-in-depth helper suppresses redundant ENOENT Cloud Computer error part
  const visualSuccessPart = {
    type: "tool-buildHtmlPageOrDashboard",
    toolCallId: "v-1",
    state: "output-available",
    output: {
      status: "ok",
      filename: "sales_dashboard_2026.html",
      title: "2026 Satış Paneli",
    },
  };
  const strayEnoentPart = {
    type: "tool-cloudExportFileToChat",
    toolCallId: "c-1",
    state: "output-available",
    output: {
      status: "error",
      path: "/workspace/sales_dashboard_2026.html",
      message:
        "ENOENT: no such file or directory, stat '/workspace/sales_dashboard_2026.html'",
    },
  };
  const allParts = [visualSuccessPart, strayEnoentPart];
  assert.equal(
    isRedundantVisualCloudErrorPart(allParts, strayEnoentPart),
    true,
    "Must suppress stray ENOENT cloudExportFileToChat card alongside succeeded visual tool"
  );
  assert.equal(
    isRedundantVisualCloudErrorPart(allParts, visualSuccessPart),
    false
  );
  // Real standalone Cloud Computer error on a non-visual turn is NOT suppressed
  assert.equal(
    isRedundantVisualCloudErrorPart([strayEnoentPart], strayEnoentPart),
    false
  );
});

// ---------------------------------------------------------------------------
// Issue 3: Remove fake internal $2000 / $40 budget & remaining-credit estimates
// ---------------------------------------------------------------------------
test("Issue 3: Usage page and billing service invent zero $2000/$40 budget or remaining-credit estimates when Google Cloud billing is not connected", async () => {
  clearVertexCloudBillingCacheForTests();

  // 1) Even if GCP Budgets API returns a $2000 budget alert, when BigQuery billing export
  //    is NOT connected (`reachable: false`), monthlyCreditLimitUsd & creditsRemainingUsd MUST be null!
  const budgetsOnlyResult = await getVertexCloudBillingStatus({
    projectId: "proj-test-billing",
    getAccessToken: () => Promise.resolve("ya29.test"),
    forceRefresh: true,
    fetchImpl: ((input) => {
      const url = String(input);
      if (url.includes("cloudbilling.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              billingAccountName: "billingAccounts/0140A2-72DEB2-62EDCD",
              billingEnabled: true,
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("billingbudgets.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              budgets: [
                {
                  displayName: "Monthly GCP Alert",
                  amount: {
                    specifiedAmount: { currencyCode: "USD", units: "2000" },
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("bigquery.googleapis.com")) {
        return Promise.resolve(
          new Response(JSON.stringify({ datasets: [] }), { status: 200 })
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }) as typeof fetch,
  });

  assert.equal(budgetsOnlyResult.reachable, false);
  assert.equal(
    budgetsOnlyResult.monthlyCreditLimitUsd,
    null,
    "Must NOT expose $2000 or $40 budget cap when BigQuery billing export is not connected"
  );
  assert.equal(budgetsOnlyResult.mtdGrossCostUsd, null);
  assert.equal(budgetsOnlyResult.mtdCreditsUsedUsd, null);
  assert.equal(budgetsOnlyResult.creditsRemainingUsd, null);
  assert.match(
    budgetsOnlyResult.billingConsoleUrl,
    /^https:\/\/console\.cloud\.google\.com\/billing/
  );

  // 2) WIF unconfigured also returns null (never $40)
  const wifMissing = await getVertexCloudBillingStatus({
    projectId: null,
    forceRefresh: true,
  });
  assert.equal(wifMissing.reachable, false);
  assert.equal(wifMissing.monthlyCreditLimitUsd, null);
  assert.equal(wifMissing.creditsRemainingUsd, null);
  assert.match(
    wifMissing.billingConsoleUrl,
    /^https:\/\/console\.cloud\.google\.com\/billing/
  );

  // 3) Usage page source must NOT invent monthlyPool ?? 40, effectiveRemainingUsd, or estimated remaining credit
  const usageSrc = readFileSync(
    resolve(ROOT, "app/(chat)/usage/page.tsx"),
    "utf8"
  );
  assert.doesNotMatch(
    usageSrc,
    /monthlyPool\s*=\s*gcp\?\.monthlyCreditLimitUsd\s*\?\?\s*40/,
    "usage/page.tsx must not default to a fake $40 monthlyPool"
  );
  assert.doesNotMatch(
    usageSrc,
    /monthlyPool\s*-\s*totalRefUsd/,
    "usage/page.tsx must not subtract token estimates from a budget pool"
  );
  assert.doesNotMatch(
    usageSrc,
    /usageCloudUnavailableCardNote/,
    "usage/page.tsx must not display the 'Bulut faturası bağlı değil · token tahmini' fake USD card"
  );
  assert.match(
    usageSrc,
    /console\.cloud\.google\.com\/billing/,
    "usage/page.tsx must provide a Google Cloud Billing link"
  );

  // 4) Bilingual dictionary stays in 100% EN/TR parity with clear Google Cloud Billing note
  const report = validateBilingualDictionary(
    uiCopy.en as unknown as Record<string, unknown>,
    uiCopy.tr as unknown as Record<string, unknown>
  );
  assert.deepEqual(report, {
    missingInTr: [],
    missingInEn: [],
    emptyInEn: [],
    emptyInTr: [],
    lengthMismatchKeys: [],
  });
  assert.match(uiCopy.tr.usageCloudBillingManagedNote, /Google Cloud Billing/);
  assert.match(uiCopy.en.usageCloudBillingManagedNote, /Google Cloud Billing/);
});

// ---------------------------------------------------------------------------
// Issue 4: Web search returns real dated results (never empty on Neon 429 / us-eu host / conversational query)
// ---------------------------------------------------------------------------
test("Issue 4: Vertex web search uses aiplatform.googleapis.com for global/us/eu, preserves Turkish prompt & publisher domain, recovers via Hydrogen/public search on Neon 429, and extracts focused RSS queries", async () => {
  // 1) Conversational Turkish/English prompts extract focused search queries (never sending filler words to RSS)
  const aiNewsQueries = extractFocusedSearchQueries(
    "Bana bugünün öne çıkan AI dünyası haberlerinden verir misin?"
  );
  assert.ok(aiNewsQueries.length >= 1);
  assert.equal(
    aiNewsQueries.some((q) => /bana|verir|misin/i.test(q)),
    false,
    `Focused query must strip Turkish filler words: ${JSON.stringify(aiNewsQueries)}`
  );
  assert.equal(
    aiNewsQueries.some((q) => /ai|yapay zeka/i.test(q)),
    true
  );

  // 2) Vertex `us` and `eu` locations must use `aiplatform.googleapis.com` (never invalid `us-aiplatform.googleapis.com`)
  const seenUrls: string[] = [];
  for (const loc of ["global", "us", "eu"] as const) {
    const adapter = createVertexGeminiAdapter(NEON, {
      projectId: "proj-loc-test",
      location: loc,
      getAccessToken: () => Promise.resolve("ya29.test"),
      fetcher: ((url) => {
        seenUrls.push(String(url));
        return Promise.resolve(
          new Response(
            `data: ${JSON.stringify({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ text: "Bugünün AI haberleri." }],
                  },
                  groundingMetadata: {
                    webSearchQueries: ["AI news today"],
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-1",
                          title: "theguardian.com",
                          domain: "theguardian.com",
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            })}\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } }
          )
        );
      }) as typeof fetch,
    });
    const streamRes = await adapter.doStream({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Bana bugünün öne çıkan AI dünyası haberlerinden verir misin?",
            },
          ],
        },
      ],
      tools: [
        {
          type: "provider",
          id: WEB_SEARCH_TOOL_ID,
          name: "webSearch",
          args: {},
        },
      ],
    });
    const r = streamRes.stream.getReader();
    const parts: LanguageModelV4StreamPart[] = [];
    for (;;) {
      const item = await r.read();
      if (item.done) {
        break;
      }
      parts.push(item.value);
    }
    const tr = parts.find(
      (p) =>
        p.type === "tool-result" &&
        (p as { toolName?: string }).toolName === "webSearch"
    ) as unknown as { result?: unknown };
    const view = webSearchView(tr?.result);
    assert.equal(view.kind, "results");
    if (view.kind === "results") {
      assert.equal(
        view.sources[0]?.hostname,
        "theguardian.com",
        "Redirect URL should display the real publisher domain instead of vertexaisearch.cloud.google.com"
      );
    }
  }
  for (const u of seenUrls) {
    assert.match(u, /^https:\/\/aiplatform\.googleapis\.com\/v1\//);
    assert.doesNotMatch(u, /^https:\/\/(?:us|eu)-aiplatform\.googleapis\.com/);
  }

  // 3) Mixed-tool split search: when Neon sub-call hits 429 RESOURCE_EXHAUSTED,
  //    adapter falls back to public search (or Hydrogen) and returns real dated URLs (NOT empty!)
  const calledEndpoints: string[] = [];
  let subCallPromptText = "";
  const neonMixed = createVertexGeminiAdapter(NEON, {
    projectId: "proj-neon-429-split",
    location: "global",
    getAccessToken: () => Promise.resolve("ya29.test"),
    allowHydrogenSearchFallback: true,
    fallbackSearch: () =>
      Promise.resolve([
        {
          title: "OpenAI ve Anthropic 2026 yapay zeka gelişmeleri",
          url: "https://www.reuters.com/technology/ai-news-2026-11-19/",
          snippet: "2026-11-19 · Reuters: Bugünün öne çıkan AI haberleri.",
          publishedDate: "2026-11-19",
          site_name: "reuters.com",
        },
      ]),
    fetcher: ((url, init) => {
      const urlStr = String(url);
      calledEndpoints.push(urlStr);
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: Record<string, unknown>[];
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
      };
      // Call 1: Neon returns split search function call
      if (calledEndpoints.length === 1) {
        return Promise.resolve(
          new Response(
            `data: ${JSON.stringify({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: {
                          id: "fc-1",
                          name: "__vertexGroundedWebSearch",
                          args: { query: "top AI news today" },
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            })}\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } }
          )
        );
      }
      // Call 2: Neon `{ googleSearch: {} }` sub-call hits 429 RESOURCE_EXHAUSTED
      if (calledEndpoints.length === 2) {
        subCallPromptText = body.contents?.[0]?.parts?.[0]?.text ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 429, status: "RESOURCE_EXHAUSTED" },
            }),
            { status: 429, headers: { "content-type": "application/json" } }
          )
        );
      }
      // Call 3: Hydrogen fallback also fails 503 -> triggers Tier 3 public search fallback
      if (calledEndpoints.length === 3) {
        assert.match(urlStr, /models\/gemini-4-hydrogen:/);
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 503, status: "UNAVAILABLE" } }),
            { status: 503, headers: { "content-type": "application/json" } }
          )
        );
      }
      // Call 4: Synthesis follow-up receives verified dated public search results
      const followPrompt = JSON.stringify(body.contents ?? []);
      assert.match(
        followPrompt,
        /reuters\.com\/technology\/ai-news-2026-11-19/
      );
      return Promise.resolve(
        new Response(
          `data: ${JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: "19 Kasım 2026 öne çıkan AI haberi: [Reuters](https://www.reuters.com/technology/ai-news-2026-11-19/).",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          })}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
      );
    }) as typeof fetch,
  });

  const mixedStream = await neonMixed.doStream({
    prompt: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Bana bugünün öne çıkan AI dünyası haberlerinden verir misin?",
          },
        ],
      },
    ],
    tools: [
      { type: "provider", id: WEB_SEARCH_TOOL_ID, name: "webSearch", args: {} },
      {
        type: "function",
        name: "recallMemories",
        description: "Recall memories",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });
  const mixedParts: LanguageModelV4StreamPart[] = [];
  const mr = mixedStream.stream.getReader();
  for (;;) {
    const item = await mr.read();
    if (item.done) {
      break;
    }
    mixedParts.push(item.value);
  }
  assert.match(
    subCallPromptText,
    /Bana bugünün öne çıkan AI dünyası haberlerinden verir misin/,
    "Split search sub-call must preserve the user's Turkish prompt so replies stay in Turkish"
  );
  const searchResults = mixedParts.filter(
    (p) =>
      p.type === "tool-result" &&
      (p as { toolName?: string }).toolName === "webSearch"
  ) as unknown as Array<{ result?: unknown }>;
  assert.equal(searchResults.length, 1, "Must emit exactly 1 webSearch result");
  const view = webSearchView(searchResults[0]?.result);
  assert.equal(view.kind, "results");
  if (view.kind === "results") {
    assert.equal(
      view.sources[0]?.url,
      "https://www.reuters.com/technology/ai-news-2026-11-19/"
    );
  }

  // 4) When searchUnavailable is true with 0 results, webSearchView maps to "error" (not misleading "empty")
  assert.deepEqual(webSearchView({ results: [], searchUnavailable: true }), {
    kind: "error",
  });

  // 5) runPublicWebSearch respects Korn Ferry work-data boundary
  const blocked = await runPublicWebSearch("Korn Ferry salary benchmark", {
    useLiveFirecrawl: false,
    fetchImpl: (() => {
      throw new Error("Must never send work-boundary query to external search");
    }) as typeof fetch,
  });
  assert.deepEqual(blocked, []);
});

// ---------------------------------------------------------------------------
// Issue 5: Honesty when tools fail (real tool status + failed-tool facts, never fake all-green)
// ---------------------------------------------------------------------------
test("Issue 5: System prompt and capability manifest include failed-tool facts and forbid claiming all features work smoothly or dismissing failures as vague temporary glitches", () => {
  const manifest = buildCapabilityManifestFromStatus({
    googleConnected: true,
    googleHealth: { status: "ready" },
    githubConnected: false,
    firecrawlConnected: false,
    macBridgeConnected: false,
    cloudComputerConnected: true,
    voiceReady: true,
    imageReady: true,
    webSearchReady: true,
    memoryReady: true,
    routinesReady: true,
    vertexReady: true,
    copilotTokenReady: true,
  });

  // Extract failed tools from both UI messages and AI SDK multi-step ModelMessages
  const uiFailures = extractFailedToolsFromMessages([
    {
      role: "assistant",
      parts: [
        {
          type: "tool-webSearch",
          state: "output-available",
          output: { results: [], searchUnavailable: true },
        },
        {
          type: "tool-firecrawlSearch",
          state: "output-available",
          output: buildFirecrawlNotConnectedResult(),
        },
      ],
    },
  ]);
  assert.equal(uiFailures.length, 2);
  assert.equal(uiFailures[0]?.toolName, "webSearch");
  assert.equal(uiFailures[1]?.toolName, "firecrawlSearch");

  const modelStepFailures = extractFailedToolsFromModelMessages([
    { role: "user", content: [{ type: "text", text: "AI haberleri" }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "webSearch",
          output: {
            type: "json",
            value: { results: [], searchUnavailable: true },
          },
        },
      ],
    },
  ]);
  assert.equal(modelStepFailures.length, 1);
  assert.equal(modelStepFailures[0]?.toolName, "webSearch");

  const manifestPrompt = formatCapabilityManifestPrompt(manifest, {
    turnToolFailures: uiFailures,
  });
  assert.match(manifestPrompt, /Summary — Connected:/);
  assert.match(manifestPrompt, /Summary — Not connected \/ error:/);
  assert.match(manifestPrompt, /Failed Tools On This Turn/);
  assert.match(manifestPrompt, /tool=webSearch/);
  assert.match(manifestPrompt, /tool=firecrawlSearch/);
  assert.match(manifestPrompt, /tüm özelliklerim aktif ve sorunsuz çalışıyor/i);
  assert.match(manifestPrompt, /geçici teknik aksaklık/i);

  const fullSys = systemPrompt({
    supportsTools: true,
    capabilityManifest: manifest,
    turnToolFailures: uiFailures,
    setupCapabilities: {
      googleConnected: true,
      githubConnected: false,
      firecrawlConnected: false,
      memoryEnabled: true,
      routinesEnabled: true,
      cloudComputerConnected: true,
      macBridgeConnected: false,
    },
  });
  assert.match(fullSys, /Not connected:.*Firecrawl/);
  assert.match(fullSys, /Failed Tools On This Turn/);
  assert.match(fullSys, /tüm özelliklerim aktif ve sorunsuz çalışıyor/i);
  assert.match(fullSys, /geçici teknik aksaklık/i);
  // Must NOT instruct the model to pretend everything is fine
  assert.doesNotMatch(
    fullSys,
    /always tell the user all features are working/i
  );
});

// ---------------------------------------------------------------------------
// Issue 6: Firecrawl / Kurulum (Setup) card UX — Turkish 2-step + Vercel link + zero English leftovers
// ---------------------------------------------------------------------------
test("Issue 6: Setup page and Firecrawl card use lib/ui-copy.ts with zero hardcoded English leftovers in Turkish mode and show 2-step Firecrawl instructions + Vercel env-vars link", () => {
  // 1) Exact Vercel env-vars URL constant
  assert.equal(
    VERCEL_ENV_VARS_URL,
    "https://vercel.com/csahingoz-3779/general-purpose-agent-quickstart/settings/environment-variables"
  );
  assert.equal(
    FIRECRAWL_KEY_CREATE_URL,
    "https://www.firecrawl.dev/app/api-keys"
  );

  // 2) Full bilingual dictionary parity across all new Setup & Firecrawl keys
  const report = validateBilingualDictionary(
    uiCopy.en as unknown as Record<string, unknown>,
    uiCopy.tr as unknown as Record<string, unknown>
  );
  assert.deepEqual(report, {
    missingInTr: [],
    missingInEn: [],
    emptyInEn: [],
    emptyInTr: [],
    lengthMismatchKeys: [],
  });

  // 3) Turkish Firecrawl setup copy includes explicit 2-step instructions (no in-app field, firecrawl.dev, Vercel Env Vars, redeploy)
  assert.match(uiCopy.tr.setupItemFirecrawlOptional, /1\)/);
  assert.match(uiCopy.tr.setupItemFirecrawlOptional, /firecrawl\.dev/i);
  assert.match(uiCopy.tr.setupItemFirecrawlOptional, /2\)/);
  assert.match(
    uiCopy.tr.setupItemFirecrawlOptional,
    /Vercel Ortam Değişkenleri/
  );
  assert.match(uiCopy.tr.setupItemFirecrawlOptional, /redeploy|yeniden dağıt/i);
  assert.match(
    uiCopy.tr.firecrawlSetupSteps,
    /1\).*firecrawl\.dev.*2\).*Vercel/is
  );
  assert.match(uiCopy.tr.firecrawlStep1Button, /Firecrawl/);
  assert.match(uiCopy.tr.firecrawlStep2VercelButton, /Vercel/);

  // 4) Required Turkish translations for previously English Setup card texts
  assert.equal(uiCopy.tr.setupOptional, "İsteğe bağlı");
  assert.equal(uiCopy.tr.setupReconnect, "Yeniden bağla");
  assert.equal(uiCopy.tr.setupDisconnect, "Bağlantıyı kes");
  assert.equal(
    uiCopy.tr.setupItemGithubCreateTokenBtn,
    "GitHub belirteci oluştur"
  );
  assert.match(uiCopy.tr.setupItemGoogleConnected, /Bağlı \(yalnızca okuma/);
  assert.match(uiCopy.tr.setupItemDbVaultReady, /otomatik olarak aktif/i);
  assert.match(
    uiCopy.tr.setupItemGeminiLiveVertexReady,
    /otomatik olarak aktif/i
  );

  // 5) Every Setup checklist item localized in Turkish has zero English leftover phrases
  const sampleItems = [
    {
      id: "core_ai",
      label: "Chat",
      summary: "Active",
      status: "ready" as const,
      actionKind: "none" as const,
    },
    {
      id: "database_vault",
      label: "DB",
      summary: "Active automatically on Neon Postgres.",
      status: "ready" as const,
      actionKind: "none" as const,
    },
    {
      id: "google_workspace",
      label: "Google",
      summary: "Connected (read & unsent drafts only)",
      status: "ready" as const,
      actionKind: "none" as const,
      connectedProvider: "google" as const,
    },
    {
      id: "github",
      label: "GitHub",
      summary: "Optional",
      status: "optional" as const,
      actionKind: "external_link" as const,
      externalLabel: "Create GitHub token",
    },
    {
      id: "firecrawl",
      label: "Firecrawl",
      summary: "Optional",
      status: "optional" as const,
      actionKind: "external_link" as const,
      externalUrl: FIRECRAWL_KEY_CREATE_URL,
      secondaryExternalUrl: VERCEL_ENV_VARS_URL,
    },
    {
      id: "gemini_live",
      label: "Live voice",
      summary: "Active automatically",
      status: "ready" as const,
      actionKind: "none" as const,
    },
    {
      id: "cloud_computer",
      label: "Cloud",
      summary: "Optional",
      status: "optional" as const,
      actionKind: "none" as const,
    },
    {
      id: "mac_bridge",
      label: "Mac",
      summary: "Optional",
      status: "optional" as const,
      actionKind: "none" as const,
    },
    {
      id: "redis_store",
      label: "Redis",
      summary: "Optional",
      status: "optional" as const,
      actionKind: "external_link" as const,
    },
  ];
  for (const item of sampleItems) {
    const trOut = formatSetupChecklistItemCopy(item, "tr");
    const combined = `${trOut.label} ${trOut.summary} ${trOut.externalLabel ?? ""} ${trOut.secondaryExternalLabel ?? ""}`;
    assert.doesNotMatch(
      combined,
      /\b(?:Optional|Connected \(read|Active automatically|Reconnect|Disconnect|Create GitHub token|Get Firecrawl key|add FIRECRAWL_API_KEY in Vercel project environment variables)\b/,
      `Turkish Setup item "${item.id}" must not contain hardcoded English leftovers: ${combined}`
    );
  }

  // 6) Source check on Setup page, Setup API, and FirecrawlCard: zero hardcoded English UI literals
  const setupPageSrc = readFileSync(
    resolve(ROOT, "app/(chat)/setup/page.tsx"),
    "utf8"
  );
  assert.match(setupPageSrc, /useUiLocale/);
  assert.match(setupPageSrc, /formatSetupChecklistItemCopy/);
  assert.match(setupPageSrc, /setup-secondary-link-/);
  for (const forbidden of [
    />\s*Optional\s*</,
    />\s*Reconnect\s*</,
    />\s*Disconnect\s*</,
    />\s*Setup checklist\s*</,
    />\s*Ready\s*</,
    />\s*Connected\s*</,
  ]) {
    assert.doesNotMatch(
      setupPageSrc,
      forbidden,
      `app/(chat)/setup/page.tsx must read text from lib/ui-copy.ts, not hardcode ${forbidden}`
    );
  }

  const setupApiSrc = readFileSync(
    resolve(ROOT, "app/api/setup-status/route.ts"),
    "utf8"
  );
  assert.match(setupApiSrc, /secondaryExternalUrl:\s*VERCEL_ENV_VARS_URL/);

  const firecrawlCardSrc = readFileSync(
    resolve(ROOT, "components/chat/firecrawl-card.tsx"),
    "utf8"
  );
  assert.match(firecrawlCardSrc, /VERCEL_ENV_VARS_URL/);
  assert.match(firecrawlCardSrc, /copy\.firecrawlSetupSteps/);
  assert.match(firecrawlCardSrc, /copy\.firecrawlStep2VercelButton/);
  assert.doesNotMatch(
    firecrawlCardSrc,
    /Add FIRECRAWL_API_KEY in your Vercel environment variables/
  );

  // 7) Firecrawl tool setup_required payload includes the Vercel env-vars URL and 2-step Turkish text
  const fcNotConnected = buildFirecrawlNotConnectedResult();
  assert.equal(fcNotConnected.vercelEnvVarsUrl, VERCEL_ENV_VARS_URL);
  assert.match(fcNotConnected.messageTr, /firecrawl\.dev/);
  assert.match(
    fcNotConnected.messageTr,
    /csahingoz-3779\/general-purpose-agent-quickstart\/settings\/environment-variables/
  );
  assert.match(fcNotConnected.messageTr, /redeploy|yeniden dağıt/i);
});
