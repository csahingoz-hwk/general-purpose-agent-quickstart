import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import {
  buildCapabilityManifestFromStatus,
  clearLiveCapabilityManifestCache,
  formatCapabilityManifestPrompt,
  resolveLiveCapabilityManifest,
} from "../../lib/ai/capability-manifest";
import {
  selectActiveTools,
  selectToolsWithRanking,
} from "../../lib/ai/context/select-tools";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import {
  chatModels,
  FALLBACK_CHAT_MODEL,
  REGISTERED_APP_MODEL_IDS,
} from "../../lib/ai/models";
import { systemPrompt } from "../../lib/ai/prompts";
import { ARGON, HYDROGEN } from "../../lib/ai/routing/catalog";
import { summarizeCallsByModel } from "../../lib/ai/routing/ledger";
import { createVertexGeminiAdapter } from "../../lib/ai/vertex-model";
import {
  clearVertexCloudBillingCacheForTests,
  getVertexCloudBillingStatus,
} from "../../lib/billing/vertex-cloud-usage";
import { clearGoogleWorkspaceHealthCache } from "../../lib/connectors/google-health";
import type { ChatMessage } from "../../lib/types";
import type { SecretVaultStore } from "../../lib/vault/secret-vault";
import { buildVoiceSystemInstruction } from "../../lib/voice/live-session";

const mkUser = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

test("Capability manifest lists all 14 wired capabilities, injects into chat & voice prompts in all languages, and never exposes Google Cloud Console URLs", () => {
  const manifest = buildCapabilityManifestFromStatus({
    googleConnected: true,
    googleHealth: { status: "ready" },
    githubConnected: false,
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

  const ids = manifest.entries.map((e) => e.id);
  assert.deepEqual(ids, [
    "gmail",
    "calendar",
    "drive",
    "github",
    "firecrawl",
    "mac_bridge",
    "cloud_computer",
    "voice",
    "image",
    "web_search",
    "memory",
    "routines",
    "model_hydrogen",
    "model_argon",
    "model_copilot_fallback",
  ]);

  const chatPrompt = systemPrompt({
    supportsTools: true,
    capabilityManifest: manifest,
  });
  const voicePrompt = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    capabilityManifest: manifest,
  });

  for (const prompt of [chatPrompt, voicePrompt]) {
    assert.match(prompt, /Live App Capability Manifest/);
    assert.match(prompt, /Apply in Turkish, English, and Every Language/);
    assert.match(
      prompt,
      /\[Gmail \(read & unsent drafts\)\] state=connected_and_healthy/
    );
    assert.match(prompt, /\[GitHub Pull Requests.*\] state=not_connected/);
    assert.match(prompt, /fix=\/setup#setup-github/);
    assert.match(prompt, /\[Mac mini Bridge.*\] state=not_connected/);
    assert.match(prompt, /fix=\/setup#setup-mac_bridge/);
    assert.match(
      prompt,
      /\[Model: Gemini 4 Hydrogen.*\] state=connected_and_healthy/
    );
    assert.match(
      prompt,
      /\[Model: Gemini 4 Argon.*\] state=connected_and_healthy/
    );
    assert.match(
      prompt,
      /\[Model: Claude Haiku 5\.5.*\] state=connected_and_healthy/
    );
    // Only warn against console.cloud.google.com in rule text, never provide a https://console.cloud.google.com link
    assert.doesNotMatch(prompt, /https?:\/\/console\.cloud\.google\.com/i);
  }

  // Verify every setupHref anchor corresponds to a real Setup checklist item or route
  const setupRouteSrc = readFileSync("app/api/setup-status/route.ts", "utf8");
  const setupPageSrc = readFileSync("app/(chat)/setup/page.tsx", "utf8");
  assert.match(setupPageSrc, /id=\{`setup-\$\{item\.id\}`\}/);
  for (const entry of manifest.entries) {
    if (entry.setupHref.startsWith("/setup#setup-")) {
      const itemId = entry.setupHref.slice("/setup#setup-".length);
      assert.match(
        setupRouteSrc,
        new RegExp(`id:\\s*"${itemId}"`),
        `Setup checklist missing item id="${itemId}" for capability ${entry.id}`
      );
    }
  }
});

test("Connected -> used: connected tools are offered by default (regexes only rank, never hide), stay on Hydrogen for everyday turns, and execute live", async () => {
  const allConnected = buildCapabilityManifestFromStatus({
    googleConnected: true,
    googleHealth: { status: "ready" },
    githubConnected: true,
    macBridgeConnected: true,
    cloudComputerConnected: true,
    voiceReady: true,
    imageReady: true,
    webSearchReady: true,
    memoryReady: true,
    routinesReady: true,
    vertexReady: true,
    copilotTokenReady: true,
  });

  // Unhinted Turkish prompt that matches ZERO connector regexes
  const unhinted = selectToolsWithRanking(
    [mkUser("Bugün gözden kaçırdığım acil bir konu var mı?")],
    true,
    true,
    { capabilityManifest: allConnected }
  );
  assert.deepEqual(unhinted.intentMatchedTools, []);
  for (const expectedTool of [
    "gmailReadMessages",
    "gmailCreateDraft",
    "calendarReadEvents",
    "calendarCreateDraftEvent",
    "driveReadFiles",
    "driveCreateDraftDoc",
    "githubReadPullRequests",
    "githubCreateDraftReview",
    "macExec",
    "macRunAgentCli",
    "cloudExec",
    "generateImageAsset",
    "recallMemories",
    "saveProfileFact",
    "listMySchedules",
    "scheduleTask",
  ] as const) {
    assert.ok(
      unhinted.activeTools.includes(expectedTool),
      `Expected connected tool ${expectedTool} to be offered by default even with 0 regex matches`
    );
  }

  // Everyday turn with passive connected operator tools must NOT escalate to Argon
  const turnRouting = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON],
    userText: "Bugün gözden kaçırdığım acil bir konu var mı?",
    requestedTools: unhinted.intentMatchedTools,
  });
  assert.equal(turnRouting.modelId, HYDROGEN);
  assert.equal(turnRouting.escalated, false);

  // Regex match ranks Calendar #1 while keeping Gmail/Drive/GitHub available
  const calendarRanked = selectToolsWithRanking(
    [mkUser("Bu hafta takvimimde neler var?")],
    true,
    true,
    { capabilityManifest: allConnected }
  );
  assert.equal(calendarRanked.activeTools[0], "calendarReadEvents");
  assert.ok(calendarRanked.activeTools.includes("gmailReadMessages"));
  assert.ok(calendarRanked.activeTools.includes("githubReadPullRequests"));

  // Simulated model execution on the unhinted prompt calls connected `gmailReadMessages` directly
  let step = 0;
  let gmailCalled = false;
  const vertexModel = createVertexGeminiAdapter(HYDROGEN, {
    projectId: "project-cd0bc64c-0025-446c-b41",
    getAccessToken: () => Promise.resolve("ya29.test"),
    fetcher: () => {
      step += 1;
      const payload =
        step === 1
          ? {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: {
                          id: "call_gm_live",
                          name: "gmailReadMessages",
                          args: { maxResults: 5 },
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            }
          : {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        text: "Gelen kutunu kontrol ettim; x.ai'den 1 yeni mesaj var.",
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            };
      return Promise.resolve(
        new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );
    },
  });

  const result = streamText({
    model: vertexModel,
    instructions: systemPrompt({
      supportsTools: true,
      capabilityManifest: allConnected,
    }),
    prompt: "Bugün gözden kaçırdığım acil bir konu var mı?",
    stopWhen: isStepCount(4),
    activeTools: ["gmailReadMessages"],
    tools: {
      gmailReadMessages: tool({
        inputSchema: z.object({ maxResults: z.number().optional() }),
        execute: () => {
          gmailCalled = true;
          return Promise.resolve({
            status: "ok",
            count: 1,
            messages: [{ id: "m1", subject: "x.ai update" }],
          });
        },
      }),
    },
  });

  const answer = await result.text;
  assert.equal(gmailCalled, true);
  assert.match(answer, /x\.ai/);
  assert.doesNotMatch(answer, /erişimim yok|no access/i);
});

test("Disconnected -> precise guidance with Setup link (and Connect link when applicable), never Google Cloud Console", async () => {
  const disconnectedManifest = buildCapabilityManifestFromStatus({
    googleConnected: false,
    googleSignInReady: true,
    githubConnected: false,
    macBridgeConnected: false,
    cloudComputerConnected: false,
    voiceReady: true,
    imageReady: true,
    webSearchReady: true,
    memoryReady: true,
    routinesReady: true,
    vertexReady: true,
    copilotTokenReady: false,
  });

  const active = selectActiveTools(
    [mkUser("Merhaba, açık konuları özetle")],
    true,
    true,
    { capabilityManifest: disconnectedManifest }
  );
  // Disconnected tools are NOT offered by default on unhinted prompts, while connected Memory/Image ARE offered
  assert.equal(active.includes("githubReadPullRequests"), false);
  assert.equal(active.includes("macExec"), false);
  assert.equal(active.includes("recallMemories"), true);
  assert.equal(active.includes("generateImageAsset"), true);

  const formatted = formatCapabilityManifestPrompt(disconnectedManifest);
  assert.match(
    formatted,
    /\[Gmail \(read & unsent drafts\)\] state=not_connected \| cause="Google account OAuth credentials are not linked in the encrypted Vault yet" \| fix=\/setup#setup-google_workspace \| connect=\/connect\/google\/start/
  );
  assert.match(
    formatted,
    /\[GitHub Pull Requests \(read & draft reviews\)\] state=not_connected \| cause="GitHub account or personal token is not connected in the Vault yet" \| fix=\/setup#setup-github/
  );
  assert.match(
    formatted,
    /\[Mac mini Bridge \(private Tailscale SSH tmux\)\] state=not_connected \| cause="Tailscale SSH bridge environment \(MAC_BRIDGE_RELAY_URL \/ host\) is not configured yet" \| fix=\/setup#setup-mac_bridge/
  );
  assert.doesNotMatch(formatted, /https?:\/\/console\.cloud\.google\.com/i);

  // Verify the exact instructions sent to the model contain the Setup link & cause so the model guides the owner accurately
  let capturedSystemInstruction = "";
  const vertexModel = createVertexGeminiAdapter(HYDROGEN, {
    projectId: "project-cd0bc64c-0025-446c-b41",
    getAccessToken: () => Promise.resolve("ya29.test"),
    fetcher: (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
      };
      capturedSystemInstruction =
        parsed.systemInstruction?.parts?.map((p) => p.text ?? "").join("\n") ??
        "";
      const reply = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: "GitHub entegrasyonu henüz bağlı değil (Vault içinde GitHub hesabı veya kişisel belirteç tanımlanmamış). Bağlamak için [Kurulum kontrol listesi](/setup#setup-github) öğesini açabilirsin.",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      };
      return Promise.resolve(
        new Response(`data: ${JSON.stringify(reply)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );
    },
  });

  const res = streamText({
    model: vertexModel,
    instructions: systemPrompt({
      supportsTools: true,
      capabilityManifest: disconnectedManifest,
    }),
    prompt: "GitHub PR'larımı kontrol eder misin?",
  });
  const text = await res.text;
  assert.match(capturedSystemInstruction, /fix=\/setup#setup-github/);
  assert.match(text, /\/setup#setup-github/);
  assert.doesNotMatch(text, /console\.cloud\.google\.com/i);
});

test("Erroring -> records exact technical cause + retry/reconnect action + Setup link while keeping unaffected sibling connectors healthy", async () => {
  clearGoogleWorkspaceHealthCache();
  clearLiveCapabilityManifestCache();

  // 1. Partial Google API failure: Gmail disabled (`service_disabled`), Calendar & Drive healthy
  const partialDisabled = buildCapabilityManifestFromStatus({
    googleConnected: true,
    googleHealth: {
      status: "service_disabled",
      disabledServices: ["Gmail"],
      projectNumber: "297951472081",
      enableApiUrl:
        "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com",
    },
    githubConnected: true,
    macBridgeConnected: false,
    cloudComputerConnected: false,
    voiceReady: true,
    imageReady: true,
    webSearchReady: true,
    memoryReady: true,
    routinesReady: true,
    vertexReady: true,
    copilotTokenReady: false,
  });

  const gmailEntry = partialDisabled.entries.find((e) => e.id === "gmail");
  const calEntry = partialDisabled.entries.find((e) => e.id === "calendar");
  assert.equal(gmailEntry?.state, "error");
  assert.equal(gmailEntry?.retryable, true);
  assert.equal(gmailEntry?.setupHref, "/setup#setup-google_workspace");
  assert.equal(calEntry?.state, "connected_and_healthy");

  const partialPrompt = formatCapabilityManifestPrompt(partialDisabled);
  // Even when `googleHealth.enableApiUrl` contains console.cloud.google.com, the prompt NEVER leaks it
  assert.doesNotMatch(partialPrompt, /https?:\/\/console\.cloud\.google\.com/i);
  assert.match(partialPrompt, /action=retry_or_reconnect/);

  // 2. Live resolver with expired refresh token (`auth_error`)
  const expiredVault: SecretVaultStore = {
    upsertSecret: () => Promise.reject(new Error("unused")),
    listSecrets: () =>
      Promise.resolve([
        {
          id: "s1",
          name: "GOOGLE_CONNECTOR_REFRESH_TOKEN",
          provider: "google",
          keyHint: "...1234",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "s2",
          name: "GOOGLE_CONNECTOR_CLIENT_ID",
          provider: "google",
          keyHint: "...apps",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "s3",
          name: "GOOGLE_CONNECTOR_CLIENT_SECRET",
          provider: "google",
          keyHint: "...sec",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    deleteSecret: () => Promise.resolve(false),
    resolveSecret: ({ name }) => {
      if (name === "GOOGLE_CONNECTOR_REFRESH_TOKEN") {
        return Promise.resolve("revoked-refresh");
      }
      if (name === "GOOGLE_CONNECTOR_CLIENT_ID") {
        return Promise.resolve("297951472081-abc.apps.googleusercontent.com");
      }
      if (name === "GOOGLE_CONNECTOR_CLIENT_SECRET") {
        return Promise.resolve("GOCSPX-test");
      }
      return Promise.resolve(null);
    },
  };

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
    )) as typeof fetch;
  try {
    const liveManifest = await resolveLiveCapabilityManifest({
      userId: "owner-expired-test",
      isGuest: false,
      webSearchAvailable: true,
      vaultStore: expiredVault,
      forceRefresh: true,
    });
    const liveGmail = liveManifest.entries.find((e) => e.id === "gmail");
    assert.equal(liveGmail?.state, "error");
    assert.equal(liveGmail?.retryable, true);
    assert.match(liveGmail?.reason ?? "", /expired|revoked/i);
    assert.equal(liveGmail?.setupHref, "/setup#setup-google_workspace");
  } finally {
    globalThis.fetch = prevFetch;
    clearGoogleWorkspaceHealthCache();
    clearLiveCapabilityManifestCache();
  }
});

test("Model registry contains only Vertex (Hydrogen/Argon) and Copilot Haiku", () => {
  assert.deepEqual(
    chatModels.map((m) => m.id),
    ["gemini-4-hydrogen", "gemini-4-argon"]
  );
  assert.equal(FALLBACK_CHAT_MODEL, "claude-haiku-5.5");
  assert.deepEqual(REGISTERED_APP_MODEL_IDS, [
    "gemini-4-hydrogen",
    "gemini-4-argon",
    "claude-haiku-5.5",
  ]);
});

test("Google Cloud Vertex billing reports MTD cost vs remaining credit (1h cached) or falls back cleanly to per-model token logs + exact Setup diagnostic", async () => {
  clearVertexCloudBillingCacheForTests();

  // 1. Live Google Cloud Billing + Budgets + BigQuery Export path
  const liveBilling = await getVertexCloudBillingStatus({
    projectId: "project-cd0bc64c-0025-446c-b41",
    getAccessToken: () => Promise.resolve("ya29.wif-test"),
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("cloudbilling.googleapis.com/v1/projects/")) {
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
                  displayName: "Ultra Monthly Credit",
                  amount: {
                    specifiedAmount: { currencyCode: "USD", units: "40" },
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/datasets?maxResults=25")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              datasets: [{ datasetReference: { datasetId: "billing_export" } }],
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("/datasets/billing_export/tables")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tables: [
                {
                  tableReference: {
                    tableId: "gcp_billing_export_v1_0140A2_72DEB2_62EDCD",
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/queries")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              rows: [
                {
                  f: [{ v: "3.25" }, { v: "-3.25" }, { v: "USD" }],
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }) as typeof fetch,
  });

  assert.equal(liveBilling.reachable, true);
  assert.equal(liveBilling.mtdGrossCostUsd, 3.25);
  assert.equal(liveBilling.mtdCreditsUsedUsd, 3.25);
  assert.equal(liveBilling.creditsRemainingUsd, 36.75);
  assert.equal(liveBilling.monthlyCreditLimitUsd, 40);

  // 2. Unreachable (403 missing roles/billing.viewer) -> exact Turkish diagnostic + one-click link + per-model token table
  const missingRoleBilling = await getVertexCloudBillingStatus({
    projectId: "project-cd0bc64c-0025-446c-b41",
    getAccessToken: () => Promise.resolve("ya29.wif-test"),
    fetchImpl: (() =>
      Promise.resolve(
        new Response("Permission denied", { status: 403 })
      )) as typeof fetch,
  });
  assert.equal(missingRoleBilling.reachable, false);
  assert.match(
    missingRoleBilling.missingReason ?? "",
    /roles\/billing\.viewer/
  );
  assert.match(
    missingRoleBilling.setupActionUrl,
    /https:\/\/console\.cloud\.google\.com\/billing\//
  );

  const perModel = summarizeCallsByModel([
    { model: "gemini-4-hydrogen", inputTokens: 100_000, outputTokens: 20_000 },
    { model: "gemini-4-argon", inputTokens: 40_000, outputTokens: 10_000 },
    { model: "claude-haiku-5.5", inputTokens: 15_000, outputTokens: 5000 },
  ]);
  assert.equal(perModel.length, 3);
  assert.equal(perModel[0]?.model, "gemini-4-hydrogen");
  assert.equal(perModel[0]?.totalTokens, 120_000);
  assert.ok((perModel[0]?.referenceCostUsd ?? 0) > 0);
  assert.equal(perModel[2]?.model, "claude-haiku-5.5");
  assert.equal(perModel[2]?.referenceCostUsd, 0);

  // Verify Setup checklist exposes `gcp_billing` anchor and Usage page never renders raw stuck "Loading…"
  const setupSrc = readFileSync("app/api/setup-status/route.ts", "utf8");
  assert.match(setupSrc, /id:\s*"gcp_billing"/);
  const usageSrc = readFileSync("app/(chat)/usage/page.tsx", "utf8");
  assert.doesNotMatch(usageSrc, /Loading…/);
  assert.match(usageSrc, /data-testid="vertex-finance-table"/);
});
