import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { asSchema } from "ai";
import type { CapabilityManifest } from "../../lib/ai/capability-manifest";
import { selectToolsWithRanking } from "../../lib/ai/context/select-tools";
import { ARGON, COPILOT_HAIKU, HYDROGEN } from "../../lib/ai/routing/catalog";
import { createUsageLedger } from "../../lib/ai/routing/ledger";
import { createRoutedModel } from "../../lib/ai/routing/model";
import { safeErrorDiagnostic } from "../../lib/ai/routing/policy";
import {
  type InferenceSession,
  inferenceSession,
} from "../../lib/ai/routing/session";
import { createExcalidrawDiagramTool } from "../../lib/ai/tools/excalidraw-diagram";
import {
  createMemoryTools,
  createMemoryTurnState,
  dedupeAssistantMemoryParts,
} from "../../lib/ai/tools/memory-tools";
import { createVisualStudioTools } from "../../lib/ai/tools/visual-studio";
import {
  buildVertexRequestBody,
  createVertexGeminiAdapter,
} from "../../lib/ai/vertex-model";
import {
  clearVertexCloudBillingCacheForTests,
  getVertexCloudBillingStatus,
} from "../../lib/billing/vertex-cloud-usage";
import { resetParitySchemaStateForTests } from "../../lib/db/ensure-parity-schema";
import { resolveSharedPostgresUrl } from "../../lib/db/shared-pool";
import {
  createInMemoryMemoryStore,
  createPostgresMemoryStore,
} from "../../lib/memory/store";
import type { ChatMessage } from "../../lib/types";
import {
  formatCloudBillingUnavailableReason,
  formatMemorySummaryStatus,
  uiCopy,
  validateBilingualDictionary,
} from "../../lib/ui-copy";

function mkUserMessage(text: string): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 9)}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatMessage;
}

const CONNECTED_OWNER_MANIFEST: CapabilityManifest = {
  entries: [
    {
      id: "gmail",
      label: "Gmail",
      category: "connector",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-google",
      tools: ["gmailReadMessages", "gmailCreateDraft"],
    },
    {
      id: "calendar",
      label: "Google Calendar",
      category: "connector",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-google",
      tools: ["calendarReadEvents", "calendarCreateDraftEvent"],
    },
    {
      id: "drive",
      label: "Google Drive",
      category: "connector",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-google",
      tools: ["driveReadFiles", "driveCreateDraftDoc"],
    },
    {
      id: "github",
      label: "GitHub",
      category: "connector",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-github",
      tools: ["githubReadPullRequests", "githubCreateDraftReview"],
    },
    {
      id: "memory",
      label: "Memory",
      category: "tool",
      state: "connected_and_healthy",
      setupHref: "/setup#setup-memory",
      tools: ["saveProfileFact", "addJournalEntry", "recallMemories"],
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
  ],
};

// ---------------------------------------------------------------------------
// Fix 1: Visual tools excluded from ownerSelfService on non-visual turns
// ---------------------------------------------------------------------------
test("Fix 1: owner 'merhaba' turn excludes buildHtmlPageOrDashboard, createExcalidrawDiagram, and generateInfographic unless visual intent matches", () => {
  const visualToolNames = [
    "buildHtmlPageOrDashboard",
    "createExcalidrawDiagram",
    "generateInfographic",
  ] as const;

  for (const greeting of [
    "merhaba",
    "Merhaba!",
    "hello",
    "Bugün hava nasıl?",
  ]) {
    const selected = selectToolsWithRanking(
      [mkUserMessage(greeting)],
      true,
      true,
      { capabilityManifest: CONNECTED_OWNER_MANIFEST }
    );
    for (const toolName of visualToolNames) {
      assert.equal(
        selected.activeTools.includes(toolName),
        false,
        `Expected ${toolName} NOT to be attached on "${greeting}", got [${selected.activeTools.join(", ")}]`
      );
      assert.equal(selected.intentMatchedTools.includes(toolName), false);
    }
  }

  // Visual intent matchers still attach the matching visual tool
  const dashTurn = selectToolsWithRanking(
    [mkUserMessage("Build an interactive ECharts sales dashboard")],
    true,
    true,
    { capabilityManifest: CONNECTED_OWNER_MANIFEST }
  );
  assert.equal(dashTurn.activeTools.includes("buildHtmlPageOrDashboard"), true);

  const diagTurn = selectToolsWithRanking(
    [mkUserMessage("Draw a system architecture diagram in Excalidraw")],
    true,
    true,
    { capabilityManifest: CONNECTED_OWNER_MANIFEST }
  );
  assert.equal(diagTurn.activeTools.includes("createExcalidrawDiagram"), true);

  const infoTurn = selectToolsWithRanking(
    [mkUserMessage("Hazırla bir infografik poster")],
    true,
    true,
    { capabilityManifest: CONNECTED_OWNER_MANIFEST }
  );
  assert.equal(infoTurn.activeTools.includes("generateInfographic"), true);
});

// ---------------------------------------------------------------------------
// Fix 2: Vertex-safe inputSchemas on all 3 visual tools
// ---------------------------------------------------------------------------
function collectSchemaViolations(node: unknown, pathPrefix = "$"): string[] {
  if (!node || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child, idx) =>
      collectSchemaViolations(child, `${pathPrefix}[${idx}]`)
    );
  }
  const obj = node as Record<string, unknown>;
  const violations: string[] = [];

  if ("anyOf" in obj) {
    violations.push(`${pathPrefix}.anyOf`);
  }
  if ("oneOf" in obj) {
    violations.push(`${pathPrefix}.oneOf`);
  }
  if ("propertyNames" in obj) {
    violations.push(`${pathPrefix}.propertyNames`);
  }
  if ("additionalItems" in obj) {
    violations.push(`${pathPrefix}.additionalItems`);
  }
  if ("items" in obj && Array.isArray(obj.items)) {
    violations.push(`${pathPrefix}.items(tuple)`);
  }
  if ("additionalProperties" in obj) {
    const ap = obj.additionalProperties;
    if (ap !== false) {
      violations.push(
        `${pathPrefix}.additionalProperties(${JSON.stringify(ap)})`
      );
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === "additionalProperties") {
      continue;
    }
    violations.push(...collectSchemaViolations(v, `${pathPrefix}.${k}`));
  }
  return violations;
}

test("Fix 2: buildVertexRequestBody with buildHtmlPageOrDashboard, createExcalidrawDiagram, and generateInfographic yields functionDeclarations with zero anyOf or unconstrained additionalProperties", () => {
  const visualStudio = createVisualStudioTools({ userId: "owner-1" });
  const excalidraw = createExcalidrawDiagramTool();

  const rawToolEntries = [
    ["buildHtmlPageOrDashboard", visualStudio.buildHtmlPageOrDashboard],
    ["createExcalidrawDiagram", excalidraw],
    ["generateInfographic", visualStudio.generateInfographic],
  ] as const;

  const v4Tools = rawToolEntries.map(([name, t]) => {
    const rawJsonSchema = asSchema(t.inputSchema as never).jsonSchema;
    const rawViolations = collectSchemaViolations(rawJsonSchema, name);
    assert.deepEqual(
      rawViolations,
      [],
      `Raw JSON schema for ${name} had Vertex-unsafe constructs: ${rawViolations.join(", ")}`
    );
    return {
      type: "function" as const,
      name,
      description: typeof t.description === "string" ? t.description : "",
      inputSchema: rawJsonSchema,
    };
  });

  const vertexBody = buildVertexRequestBody(HYDROGEN, {
    prompt: [{ role: "user", content: [{ type: "text", text: "merhaba" }] }],
    tools: v4Tools,
  });

  const toolsArr = vertexBody.tools as Array<{
    functionDeclarations?: Array<{
      name: string;
      parametersJsonSchema: Record<string, unknown>;
    }>;
  }>;
  assert.equal(Array.isArray(toolsArr), true);
  const decls = toolsArr[0]?.functionDeclarations ?? [];
  assert.equal(decls.length, 3);

  for (const decl of decls) {
    assert.equal("$schema" in decl.parametersJsonSchema, false);
    const violations = collectSchemaViolations(
      decl.parametersJsonSchema,
      `vertex.${decl.name}`
    );
    assert.deepEqual(
      violations,
      [],
      `Vertex functionDeclaration ${decl.name} had violations: ${violations.join(", ")}`
    );
  }
});

// ---------------------------------------------------------------------------
// Fix 3: Primary failure diagnostic logging before fallback (zero secrets)
// ---------------------------------------------------------------------------
test("Fix 3: createRoutedModel logs safe { kind, statusCode, code, name } for primary failure before fallback and strips secrets", async () => {
  const capturedLogs: Array<{ args: unknown[] }> = [];
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedLogs.push({ args });
  };

  try {
    const session: InferenceSession = {
      ledger: createUsageLedger("owner-1", "req-diag-test"),
      available: [HYDROGEN, ARGON, COPILOT_HAIKU],
      exposed: false,
      toolBoundary: false,
      fallbackUsed: false,
      activeModelId: HYDROGEN,
    };

    const secretBearer = "ya29.a0AfH6SM_SUPER_SECRET_GOOGLE_ACCESS_TOKEN";
    const secretApiKey = "sk-proj-SUPER_SECRET_KEY_123456789";

    const routed = createRoutedModel(HYDROGEN, session, (modelId) => {
      if (modelId === HYDROGEN) {
        return createVertexGeminiAdapter(HYDROGEN, {
          projectId: "proj-test-123",
          getAccessToken: () => Promise.resolve(secretBearer),
          fetcher: (() =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  error: {
                    code: 400,
                    message: `Invalid schema near secret ${secretApiKey} and token ${secretBearer}`,
                    status: "INVALID_ARGUMENT",
                  },
                }),
                { status: 400, headers: { "content-type": "application/json" } }
              )
            )) as unknown as typeof fetch,
        });
      }
      return {
        specificationVersion: "v4",
        provider: "copilot.mock",
        modelId: COPILOT_HAIKU,
        supportedUrls: {},
        doGenerate: () => Promise.reject(new Error("unused")),
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream<LanguageModelV4StreamPart>({
              start(c) {
                c.enqueue({ type: "stream-start", warnings: [] });
                c.enqueue({ type: "text-start", id: "t1" });
                c.enqueue({
                  type: "text-delta",
                  id: "t1",
                  delta: "Merhaba! Size nasıl yardımcı olabilirim?",
                });
                c.enqueue({ type: "text-end", id: "t1" });
                c.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: {
                      total: 10,
                      noCache: 10,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: { total: 8, text: 8, reasoning: 0 },
                  },
                });
                c.close();
              },
            }),
          }),
      } as unknown as LanguageModelV4;
    });

    const streamRes = await routed.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "merhaba" }] }],
    });
    const reader = streamRes.stream.getReader();
    let fullText = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.type === "text-delta") {
        fullText += value.delta;
      }
    }

    assert.equal(fullText, "Merhaba! Size nasıl yardımcı olabilirim?");
    assert.equal(session.fallbackUsed, true);
    assert.equal(session.activeModelId, COPILOT_HAIKU);

    const routingLog = capturedLogs.find(
      (entry) => entry.args[0] === "[routing] model attempt failed"
    );
    assert.ok(routingLog, "Expected [routing] model attempt failed log");
    const payload = routingLog.args[1] as Record<string, unknown>;
    assert.equal(payload.model, HYDROGEN);
    assert.equal(payload.role, "primary");
    assert.equal(payload.kind, "unavailable");
    assert.equal(payload.statusCode, 400);
    assert.equal(payload.code, "INVALID_ARGUMENT");
    assert.equal(payload.name, "VertexHttpError");

    const serializedLogs = JSON.stringify(capturedLogs);
    assert.equal(serializedLogs.includes(secretBearer), false);
    assert.equal(serializedLogs.includes(secretApiKey), false);

    // Verify safeErrorDiagnostic strips secret-shaped tokens if ever placed in .code
    const poisoned = Object.assign(new Error("upstream failure"), {
      name: "AuthError",
      statusCode: 401,
      code: secretBearer,
    });
    const sanitized = safeErrorDiagnostic(poisoned);
    assert.equal(sanitized.kind, "auth");
    assert.equal(sanitized.statusCode, 401);
    assert.equal(sanitized.code, null);
    assert.equal(sanitized.name, "AuthError");
  } finally {
    console.error = origConsoleError;
  }
});

// ---------------------------------------------------------------------------
// Fix 4: Vertex grounded-search sub-call failure does NOT kill the whole turn
// ---------------------------------------------------------------------------
function sseResponse(payloads: unknown[]): Response {
  const body = `${payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("Fix 4: Vertex grounded-search sub-call failure (HTTP 503 or network error) falls back cleanly to non-search follow-up without killing the turn", async () => {
  for (const failureMode of ["http_503", "network_throw"] as const) {
    let callIndex = 0;
    const adapter = createVertexGeminiAdapter(HYDROGEN, {
      projectId: "proj-search-resilience",
      getAccessToken: () => Promise.resolve("mock-token"),
      fetcher: ((_url, init) => {
        callIndex += 1;
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
          tools?: Record<string, unknown>[];
        };
        if (callIndex === 1) {
          // Step 1: mixed tools -> model requests __vertexGroundedWebSearch
          return Promise.resolve(
            sseResponse([
              {
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          functionCall: {
                            id: "fc-search-1",
                            name: "__vertexGroundedWebSearch",
                            args: { query: "latest exchange rate" },
                          },
                        },
                      ],
                    },
                    finishReason: "STOP",
                  },
                ],
              },
            ])
          );
        }
        if (callIndex === 2) {
          // Step 2: dedicated `{ googleSearch: {} }` sub-call FAILS
          assert.ok(parsedBody.tools?.[0]?.googleSearch !== undefined);
          if (failureMode === "network_throw") {
            const abortErr = new Error("upstream socket hang up");
            abortErr.name = "TimeoutError";
            return Promise.reject(abortErr);
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: 503, status: "UNAVAILABLE" },
              }),
              { status: 503, headers: { "content-type": "application/json" } }
            )
          );
        }
        // Step 3: recovery follow-up without googleSearch completes the turn
        return Promise.resolve(
          sseResponse([
            {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        text: "Canlı web aramasına şu an ulaşılamadı, ancak genel bilgiyle yardımcı olabilirim.",
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
            },
          ])
        );
      }) as typeof fetch,
    });

    const res = await adapter.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Dolar kuru nedir?" }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "webSearch",
          description: "Search web",
          inputSchema: { type: "object", properties: {} },
        },
        {
          type: "function",
          name: "getCurrentTime",
          description: "Get current time",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const parts: LanguageModelV4StreamPart[] = [];
    const reader = res.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
    }

    const textOut = parts
      .filter(
        (p): p is Extract<LanguageModelV4StreamPart, { type: "text-delta" }> =>
          p.type === "text-delta"
      )
      .map((p) => p.delta)
      .join("");
    assert.match(textOut, /Canlı web aramasına şu an ulaşılamadı/);

    const finishPart = parts.find((p) => p.type === "finish");
    assert.ok(finishPart, `Expected clean finish part on ${failureMode}`);

    const searchResultPart = parts.find(
      (p) =>
        p.type === "tool-result" &&
        (p as { toolName?: string }).toolName === "webSearch"
    ) as unknown as {
      result?: { results?: unknown[]; searchUnavailable?: boolean };
    };
    assert.ok(searchResultPart);
    assert.deepEqual(searchResultPart.result?.results, []);
    assert.equal(searchResultPart.result?.searchUnavailable, true);
  }
});

// ---------------------------------------------------------------------------
// Fix 5: Memory cross-attempt dedupe + setup_required status + shared-pool facts
// ---------------------------------------------------------------------------
test("Fix 5: Memory saves at most once across primary + fallback attempts, Settings never shows setup_required as 0 items, and shared-pool store lists existing profile facts", async () => {
  const baseStore = createInMemoryMemoryStore();
  let upsertWriteCount = 0;
  const wrappedStore = {
    ...baseStore,
    upsertProfileFact: (
      ...args: Parameters<typeof baseStore.upsertProfileFact>
    ) => {
      upsertWriteCount += 1;
      return baseStore.upsertProfileFact(...args);
    },
  };

  const session: InferenceSession = {
    ledger: createUsageLedger("owner-1", "mem-cross-attempt"),
    available: [HYDROGEN, COPILOT_HAIKU],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    memoryTurnState: createMemoryTurnState(null),
  };

  await inferenceSession.run(session, async () => {
    // Primary attempt saves memory
    const primaryMemTools = createMemoryTools({
      userId: "owner-1",
      store: wrappedStore,
      dedupePerTurn: true,
    });
    const first = (await primaryMemTools.saveProfileFact.execute?.(
      {
        category: "preferences",
        key: "coffee_preference",
        value: "Sade Türk kahvesi seviyorum",
        sharedAcrossBots: true,
      },
      { toolCallId: "m-primary", messages: [] } as never
    )) as { saved: boolean; deduplicated?: boolean; fact?: { id: string } };
    assert.equal(first.saved, true);
    assert.equal(first.deduplicated, undefined);

    // Fallback attempt instantiates memory tools again and rewords key + value
    session.fallbackUsed = true;
    const fallbackMemTools = createMemoryTools({
      userId: "owner-1",
      store: wrappedStore,
      dedupePerTurn: true,
    });
    const second = (await fallbackMemTools.saveProfileFact.execute?.(
      {
        category: "preferences",
        key: "plain_coffee",
        value: "Kullanıcı şekersiz kahve tercih ediyor",
        sharedAcrossBots: true,
      },
      { toolCallId: "m-fallback", messages: [] } as never
    )) as { saved: boolean; deduplicated?: boolean; fact?: { id: string } };
    assert.equal(second.saved, true);
    assert.equal(second.deduplicated, true);

    const thirdJournal = (await fallbackMemTools.addJournalEntry.execute?.(
      {
        title: "Kahve",
        body: "Sade kahve",
        tags: ["pref"],
      },
      { toolCallId: "m-journal", messages: [] } as never
    )) as { logged: boolean; deduplicated?: boolean };
    assert.equal(thirdJournal.deduplicated, true);

    const uiParts = dedupeAssistantMemoryParts([
      { type: "tool-saveProfileFact", output: first },
      { type: "tool-saveProfileFact", output: second },
    ]);
    assert.equal(uiParts.length, 1);
  });

  assert.equal(
    upsertWriteCount,
    1,
    "Expected exactly 1 DB write across primary + fallback"
  );
  const storedFacts = await baseStore.listProfileFacts({ userId: "owner-1" });
  assert.equal(storedFacts.length, 1);

  // Settings / Usage must NOT render setup_required, loading, or error as "0 saved memories" / "0 items"
  const setupEn = formatMemorySummaryStatus(
    { status: "setup_required", profileFacts: [] },
    { locale: "en" }
  );
  const setupTr = formatMemorySummaryStatus(
    { status: "setup_required", profileFacts: [] },
    { locale: "tr" }
  );
  assert.doesNotMatch(setupEn, /\b0\b/);
  assert.doesNotMatch(setupTr, /\b0\b/);
  assert.match(setupEn, /Setup required/i);
  assert.match(setupTr, /Kurulum gerekli/i);

  assert.equal(
    formatMemorySummaryStatus(null, { loading: true, locale: "en" }),
    "Checking…"
  );
  assert.match(
    formatMemorySummaryStatus(null, { hasError: true, locale: "tr" }),
    /ulaşılamıyor/
  );
  assert.match(
    formatMemorySummaryStatus(
      { status: "ready", toolsEnabled: true, profileFacts: [{}, {}, {}] },
      { locale: "en" }
    ),
    /^3 saved memories/
  );

  // Confirm shared-pool + createPostgresMemoryStore lists existing profile facts (including legacy rows)
  resetParitySchemaStateForTests();
  let ranMigrationForLegacyColumns = false;
  const mockSql = Object.assign(
    (strings: TemplateStringsArray) => {
      const q = strings.join(" ");
      if (q.includes("to_regclass")) {
        return Promise.resolve([
          {
            pf: "PrivateFile",
            rt: "RoutineTrigger",
            cb: "ChatBotBinding",
            mpf: "MemoryProfileFact",
            oas: "OwnerAssistantSettings",
            rtpe: "RoutineTriggerProcessedEvent",
            mpf_legacy: true,
          },
        ]);
      }
      if (q.includes('FROM "MemoryProfileFact"')) {
        return Promise.resolve([
          {
            id: "fact-legacy-1",
            userId: "owner-1",
            category: "identity",
            key: "home_city",
            value: "Lives in London (Europe/London).",
            source: "chatgpt",
            updatedAt: "2026-11-15T10:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    },
    {
      unsafe: () => {
        ranMigrationForLegacyColumns = true;
        return Promise.resolve();
      },
    }
  ) as unknown as NonNullable<Parameters<typeof createPostgresMemoryStore>[0]>;

  const pgStore = createPostgresMemoryStore(mockSql);
  const listed = await pgStore.listProfileFacts({ userId: "owner-1" });
  assert.equal(ranMigrationForLegacyColumns, true);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, "fact-legacy-1");
  assert.equal(listed[0]?.category, "about_me");
  assert.equal(listed[0]?.sharedAcrossBots, true);
  assert.equal(listed[0]?.pinned, false);
  assert.equal(listed[0]?.learnedAt, "2026-11-15T10:00:00.000Z");

  assert.equal(
    resolveSharedPostgresUrl("  postgres://user:pass@host:5432/db  "),
    "postgres://user:pass@host:5432/db"
  );
});

// ---------------------------------------------------------------------------
// Fix 6: Remaining English UI strings -> dictionary + no module-scope getCopy()
// ---------------------------------------------------------------------------
test("Fix 6: Bilingual UI dictionary covers all 17+ remaining UI strings in EN & TR and zero chat components freeze getCopy() at module scope", () => {
  const report = validateBilingualDictionary(
    uiCopy.en as unknown as Record<string, unknown>,
    uiCopy.tr as unknown as Record<string, unknown>
  );
  assert.deepEqual(report.missingInTr, []);
  assert.deepEqual(report.missingInEn, []);
  assert.deepEqual(report.emptyInEn, []);
  assert.deepEqual(report.emptyInTr, []);
  assert.deepEqual(report.lengthMismatchKeys, []);

  assert.equal(uiCopy.en.composerPlaceholder, "Ask…");
  assert.equal(uiCopy.en.attachFile, "Attach a file");
  assert.equal(uiCopy.en.dictateMessage, "Dictate message");
  assert.equal(uiCopy.en.send, "Send");
  assert.equal(uiCopy.en.edit, "Edit");
  assert.equal(uiCopy.en.copy, "Copy");
  assert.equal(uiCopy.en.upvoteResponse, "Upvote Response");
  assert.equal(uiCopy.en.downvoteResponse, "Downvote Response");
  assert.equal(uiCopy.en.toggleDarkMode, "Toggle dark mode");
  assert.equal(uiCopy.en.toggleLightMode, "Toggle light mode");
  assert.equal(uiCopy.en.accountLabel, "Account");
  assert.equal(uiCopy.en.newChat, "New chat");
  assert.equal(uiCopy.en.memory, "Memory");
  assert.equal(uiCopy.en.mascot, "Mascot");
  assert.equal(uiCopy.en.homeLabel, "Home");
  assert.equal(uiCopy.en.noCitySaved, "No city saved");
  assert.equal(uiCopy.en.save, "Save");
  assert.equal(uiCopy.en.useCurrentLocation, "Use my current location");
  assert.equal(uiCopy.en.homeCityPlaceholder, "e.g. London, Istanbul");

  const requiredTranslatedKeys: Array<keyof typeof uiCopy.en> = [
    "composerPlaceholder",
    "attachFile",
    "dictateMessage",
    "send",
    "edit",
    "copy",
    "upvoteResponse",
    "downvoteResponse",
    "toggleDarkMode",
    "toggleLightMode",
    "accountLabel",
    "newChat",
    "memory",
    "mascot",
    "homeLabel",
    "noCitySaved",
    "save",
    "useCurrentLocation",
    "homeCityPlaceholder",
  ];
  for (const key of requiredTranslatedKeys) {
    assert.notEqual(
      uiCopy.tr[key],
      uiCopy.en[key],
      `Expected Turkish translation for ${String(key)} to differ from English`
    );
  }

  // Ensure no component in components/chat freezes `const copy = getCopy()` at module scope
  const chatDir = path.join(process.cwd(), "components/chat");
  for (const file of readdirSync(chatDir)) {
    if (!file.endsWith(".tsx") && !file.endsWith(".ts")) {
      continue;
    }
    const src = readFileSync(path.join(chatDir, file), "utf8");
    assert.doesNotMatch(
      src,
      /^const\s+copy\s*=\s*getCopy\(\s*\)/m,
      `${file} must use useUiLocale() instead of module-scope getCopy()`
    );
  }
});

// ---------------------------------------------------------------------------
// Fix 7: Usage page shows clear EN/TR reason instead of "—" when Cloud figures unavailable
// ---------------------------------------------------------------------------
test("Fix 7: Usage page eliminates '—' placeholders and renders clear EN/TR Cloud-unavailable reasons", async () => {
  const usageSrc = readFileSync(
    path.join(process.cwd(), "app/(chat)/usage/page.tsx"),
    "utf8"
  );
  assert.doesNotMatch(
    usageSrc,
    /:\s*"—"/,
    "usage/page.tsx must not fall back to raw '—' placeholders"
  );
  assert.match(usageSrc, /formatCloudBillingUnavailableReason/);
  assert.match(usageSrc, /formatMemorySummaryStatus/);

  clearVertexCloudBillingCacheForTests();
  const wifMissing = await getVertexCloudBillingStatus({
    projectId: null,
    forceRefresh: true,
  });
  assert.equal(wifMissing.reachable, false);
  assert.equal(wifMissing.missingCode, "wif_not_configured");

  const enReason = formatCloudBillingUnavailableReason(wifMissing, "en");
  const trReason = formatCloudBillingUnavailableReason(wifMissing, "tr");
  assert.match(enReason, /Workload Identity Federation.*not configured/i);
  assert.match(trReason, /Workload Identity Federation.*tanımlı değil/i);

  const bqMissingEn = formatCloudBillingUnavailableReason(
    { missingCode: "bigquery_export_missing" },
    "en"
  );
  const bqMissingTr = formatCloudBillingUnavailableReason(
    { missingCode: "bigquery_export_missing" },
    "tr"
  );
  assert.match(bqMissingEn, /BigQuery standard cost export.*not enabled/i);
  assert.match(bqMissingTr, /BigQuery standart maliyet dışa aktarımı/i);
});
