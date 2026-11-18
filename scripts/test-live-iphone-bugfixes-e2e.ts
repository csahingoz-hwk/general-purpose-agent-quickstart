import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { HYDROGEN } from "../lib/ai/routing/catalog";
import { createVertexGeminiAdapter } from "../lib/ai/vertex-model";
import {
  createResilientChunkMergeRunner,
  mergeMemoryExports,
} from "../lib/memory/multi-source-merge";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3129;
const origin = `http://127.0.0.1:${port}`;
const owner = "owner@example.test";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";

async function waitForServer(url: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) {
        return;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function buildSseBody(chunks: Record<string, unknown>[]): string {
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
}

function buildRealistic31kMixedClaudeExport(): string {
  const blocks: string[] = [
    "# Claude Memory Export (Mixed TR/EN)",
    "Exported: 2026-11-18",
    "",
    "## Rules & Preferences",
    "Never use pay-per-use API models without asking first. Everyday chat must route through Gemini 4 Hydrogen on Google AI Ultra credit, deep research escalates to Gemini 4 Argon, and GitHub Copilot SDK Claude Haiku 5.5 is the sole fallback via the Cloud VM bridge.",
    "- Onayım olmadan asla kullandıkça öde API modeli kullanma ve yedek model devreye girdiğinde gerçek model adını arayüzde göster.",
    "- Never use pay-per-use API models without asking first.",
    "- Wi-Fi password is SecretVault9988! and Visa 4532 1111 2222 3333",
    "- Home address: 221B Baker Street, London NW1 6XE",
    "- Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, and Turkey; reconciles SA90 EOSB GL 239300.",
    "",
    "## Family, Projects & Daily Context",
  ];

  let i = 1;
  while (blocks.join("\n\n").length < 30_800) {
    blocks.push(
      `Çağlar builds personal AI assistant module #${i} in TypeScript and Next.js with strict 390px iPhone viewport checks in London. Daughter Ece studies Edexcel GCSE History Medicine in Britain unit #${i} with bilingual revision notes. Tercih #${i}: Karşılaştırma ve e-posta özetlerinde ham JSON hata metni yerine her zaman temiz kartlar ve özet tablolar gösterilmelidir.`
    );
    if (i % 12 === 0) {
      blocks.push(
        `- Çağlar builds personal AI assistant module #${i} in TypeScript and Next.js with strict 390px iPhone viewport checks in London.`
      );
    }
    i += 1;
  }

  return blocks.join("\n\n");
}

test("Live Vertex 30k-char TR/EN Memory Merge + 390x844 iPhone E2E (Bug 1 chunked merge + partial-chunk save, Bug 2 Gmail Reconnect card, Collapsed Tool Accordion + Details)", async () => {
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    "/Users/caglar/.gemini/antigravity-cli/brain/dd9cadeb-6946-44ae-87cb-364a999ae07b/scratch";
  mkdirSync(scratchDir, { recursive: true });

  const export31k = buildRealistic31kMixedClaudeExport();
  assert.ok(
    export31k.length >= 30_000,
    `Expected >=30k chars, got ${export31k.length}`
  );

  let liveMergeResult: Awaited<ReturnType<typeof mergeMemoryExports>>;

  if (process.env.SKIP_LIVE_VERTEX === "1") {
    liveMergeResult = await mergeMemoryExports({
      sources: [
        { source: "claude", exportedAt: "2026-11-18", rawText: export31k },
      ],
      existingFacts: [],
      runner: ({ candidates }) =>
        Promise.resolve({
          modelUsed: "gemini-4-hydrogen",
          payload: {
            items: candidates.map((c) => ({
              status: "new" as const,
              fact: c.text.endsWith(".") ? c.text : `${c.text}.`,
              category: c.headingHint ?? "projects",
              candidateIndices: [c.idx],
              existingFactId: null,
            })),
          },
        }),
    });
  } else {
    // 1) REAL Vertex AI (`gemini-4-hydrogen` on `project-cd0bc64c-0025-446c-b41`) end-to-end run on the 31k-char mixed TR/EN export!
    const gcloudToken = execSync("gcloud auth print-access-token", {
      encoding: "utf8",
    }).trim();
    assert.ok(gcloudToken.length > 20, "Expected live gcloud access token");

    const liveRunner = createResilientChunkMergeRunner({
      hasVertex: true,
      hasCopilot: false,
      createVertexModel: (modelId, opts) =>
        createVertexGeminiAdapter(modelId, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve(gcloudToken),
          timeoutMs: opts.timeoutMs,
        }),
    });

    const liveStart = Date.now();
    const progressLog: string[] = [];
    liveMergeResult = await mergeMemoryExports({
      sources: [
        {
          source: "claude",
          exportedAt: "2026-11-18",
          rawText: export31k,
        },
      ],
      existingFacts: [],
      runner: liveRunner,
      onProgress: (ev) => {
        progressLog.push(`${ev.completedChunks}/${ev.totalChunks}`);
      },
    });
    const liveElapsedMs = Date.now() - liveStart;

    console.log(
      `LIVE_VERTEX_30K_MERGE: PASS chars=${export31k.length} chunks=${liveMergeResult.chunksSucceeded}/${liveMergeResult.chunksTotal} items=${liveMergeResult.items.length} merged=${liveMergeResult.counts.mergedCount} skippedSensitive=${liveMergeResult.counts.skippedSensitiveCount} model=${liveMergeResult.modelUsed} elapsed=${liveElapsedMs}ms`
    );
  }

  assert.ok(
    (liveMergeResult.chunksTotal ?? 0) >= 4,
    `Expected >=4 chunks, got ${liveMergeResult.chunksTotal}`
  );
  assert.equal(
    liveMergeResult.chunksSucceeded,
    liveMergeResult.chunksTotal,
    "All live Vertex chunks must succeed"
  );
  assert.equal(liveMergeResult.failedChunks, undefined);
  assert.ok(
    liveMergeResult.items.length >= 40,
    `Expected >=40 merged facts from 31k export, got ${liveMergeResult.items.length}`
  );
  assert.ok(liveMergeResult.counts.skippedSensitiveCount >= 3);

  // 2) 390x844 iPhone Playwright E2E
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });

  const server = spawn(
    "npx",
    ["next", "dev", "--turbo", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        AUTH_SECRET: secret,
        APP_OWNER_EMAIL: owner,
        PLAYWRIGHT: "True",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    }
  );
  server.unref();

  try {
    await waitForServer(origin);

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    });

    const authCookie = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: authCookie, url: origin },
    ]);

    const page = await context.newPage();
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C = window.V_C || []; window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/models*", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: HYDROGEN,
          models: [
            {
              id: HYDROGEN,
              name: "Gemini 4 Hydrogen",
              provider: "google",
              description: "Default · fast ~1s responses via Vertex AI",
            },
          ],
        },
      })
    );
    await page.route("**/api/voice/readiness*", (route) =>
      route.fulfill({ json: { liveReady: true, sttReady: true } })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/vote*", (route) => route.fulfill({ json: [] }));

    // =========================================================================
    // SCENARIO A: /memory at 390x844 — 31k-char mixed TR/EN Claude export, NDJSON progress, partial-chunk banner, and 1-tap save retaining retryText
    // =========================================================================
    let savedFactsState: Record<string, unknown>[] = [];
    let batchSavedCount = 0;

    await page.route("**/api/memory", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            status: "ready",
            toolsEnabled: true,
            profileFacts: savedFactsState,
            journalEntries: [],
          },
        });
        return;
      }
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}") as {
          items?: Record<string, unknown>[];
        };
        const incoming = body.items ?? [];
        batchSavedCount = incoming.length;
        savedFactsState = incoming.slice(0, 20).map((it, idx) => ({
          id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
          userId,
          category: it.category ?? "projects",
          key: it.key ?? `k_${idx}`,
          value: it.value ?? "",
          source: it.source ?? "claude",
          pinned: Boolean(it.pinned),
          learnedAt: "2026-11-18T00:00:00.000Z",
          updatedAt: "2026-11-18T00:00:00.000Z",
          sharedAcrossBots: true,
          botSlug: null,
        }));
        await route.fulfill({
          status: 201,
          json: {
            savedCount: incoming.length,
            skippedDuplicates: 0,
            skippedSensitive: 0,
            facts: savedFactsState,
          },
        });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/memory/merge", async (route) => {
      // Stream real NDJSON progress + the real live Vertex 31k merge result (plus 1 simulated failed chunk to verify partial-chunk UI recovery!)
      const total = liveMergeResult.chunksTotal ?? 8;
      const ndjsonLines = [
        JSON.stringify({
          type: "progress",
          completedChunks: 2,
          totalChunks: total,
          activeChunk: 3,
        }),
        JSON.stringify({
          type: "result",
          data: {
            ...liveMergeResult,
            chunksTotal: total,
            chunksSucceeded: total - 1,
            failedChunks: [
              {
                chunkNumber: total,
                totalChunks: total,
                lineCount: 4,
                preview:
                  "Extra notes section that timed out on simulated chunk",
                retryText:
                  "- Retryable line 1 from final section.\n- Retryable line 2 from final section.",
                error: "vertex_timeout",
              },
            ],
          },
        }),
      ];
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        body: `${ndjsonLines.join("\n")}\n`,
      });
    });

    await page.goto(`${origin}/memory`, { waitUntil: "networkidle" });
    await page.getByTestId("memory-source-select-0").selectOption("claude");
    await page.getByTestId("memory-bulk-textarea").fill(export31k);
    await page.getByTestId("memory-preview-button").click();

    await expect(page.getByTestId("memory-import-preview")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("memory-merge-model")).toContainText(
      "Gemini 4 Hydrogen · Vertex"
    );
    await expect(page.getByTestId("memory-failed-chunks-banner")).toBeVisible();
    await expect(page.getByTestId("memory-failed-chunks-banner")).toContainText(
      "1 section could not be merged"
    );

    const memScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(memScrollW <= 390, `Memory scrollWidth ${memScrollW} <= 390`);

    await page
      .getByTestId("memory-import-preview")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(scratchDir, "verify-bug1-memory-30k-390.png"),
      fullPage: false,
    });

    // Tap Approve & save -> saves all successful chunks AND retains failed chunk retryText in paste box!
    await page.getByTestId("memory-confirm-save").click();
    await expect(page.getByTestId("memory-import-preview")).toBeHidden({
      timeout: 10_000,
    });
    assert.ok(
      batchSavedCount >= 40,
      `Expected >=40 facts saved in 1 tap, got ${batchSavedCount}`
    );
    const retainedText = await page
      .getByTestId("memory-bulk-textarea")
      .inputValue();
    assert.match(retainedText, /Retryable line 1 from final section/);

    // =========================================================================
    // SCENARIO B: Chat at 390x844 — Gmail `gmailReadMessages({})` -> friendly Reconnect Google card (zero raw JSON)
    // =========================================================================
    let chatTurn = 0;
    await page.route("**/api/chat", async (route) => {
      chatTurn += 1;
      if (chatTurn === 1) {
        const sse = buildSseBody([
          { type: "start", messageId: "msg-gmail-1" },
          {
            type: "tool-input-start",
            toolCallId: "tc-gmail-1",
            toolName: "gmailReadMessages",
          },
          {
            type: "tool-input-available",
            toolCallId: "tc-gmail-1",
            toolName: "gmailReadMessages",
            input: {},
          },
          {
            type: "tool-output-available",
            toolCallId: "tc-gmail-1",
            output: {
              status: "reconnect_required",
              code: "scope_missing",
              connectProvider: "google",
              message:
                "Gmail read permission isn't granted yet. Tap Reconnect Google and allow Gmail access.",
              messages: [],
            },
          },
          { type: "text-start", id: "txt-gmail-1" },
          {
            type: "text-delta",
            id: "txt-gmail-1",
            delta:
              "Please tap **Reconnect Google** above to grant read-only Gmail access so I can show your latest 10 inbox messages.",
          },
          { type: "text-end", id: "txt-gmail-1" },
          { type: "finish", finishReason: "stop" },
        ]);
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: sse,
        });
        return;
      }

      // Turn 2: Generic tool error (`tool-getCurrentTime` / custom tool) -> collapsed by default + Details disclosure!
      const sse = buildSseBody([
        { type: "start", messageId: "msg-tool-err-2" },
        {
          type: "tool-input-start",
          toolCallId: "tc-diag-2",
          toolName: "lookupExternalFeed",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-diag-2",
          toolName: "lookupExternalFeed",
          input: { source: "rss", limit: 10 },
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-diag-2",
          output: {
            status: "error",
            code: "E_FEED_503",
            message: "External feed is temporarily unreachable.",
            rawTrace: "RAW_SECRET_JSON_TRACE_MARKER",
          },
        },
        { type: "text-start", id: "txt-tool-2" },
        {
          type: "text-delta",
          id: "txt-tool-2",
          delta:
            "That external feed is temporarily unreachable — please try again shortly.",
        },
        { type: "text-end", id: "txt-tool-2" },
        { type: "finish", finishReason: "stop" },
      ]);
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: sse,
      });
    });

    await page.goto(origin, { waitUntil: "networkidle" });
    const composer = page.getByTestId("multimodal-input");
    await composer.fill("Can you fetch my emails from my Gmail account?");
    await page.getByTestId("send-button").click();

    const reconnectCard = page.getByTestId("connector-connect-card");
    await expect(reconnectCard).toBeVisible({ timeout: 10_000 });
    await expect(reconnectCard).toContainText(
      "Reconnect Google to read your Gmail"
    );
    const reconnectBtn = reconnectCard.getByRole("button", {
      name: "Reconnect Google",
    });
    await expect(reconnectBtn).toBeVisible();
    const rcBox = await reconnectBtn.boundingBox();
    assert.ok(rcBox && rcBox.height >= 44, "Reconnect Google button >= 44px");

    const gmailDomText = await page.locator("main").innerText();
    assert.equal(
      gmailDomText.includes('"status"'),
      false,
      "Zero raw JSON in Gmail reconnect view"
    );
    const gmailScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(gmailScrollW <= 390, `Gmail scrollWidth ${gmailScrollW} <= 390`);

    await page.screenshot({
      path: join(scratchDir, "verify-bug2-gmail-reconnect-390.png"),
      fullPage: false,
    });

    // =========================================================================
    // SCENARIO C: Generic Tool Accordion — collapsed by default + raw PARAMETERS/RESULT JSON hidden behind "Details"
    // =========================================================================
    await composer.fill("Check the external RSS feed");
    await page.getByTestId("send-button").click();

    const toolHeaderBtn = page.getByRole("button", {
      name: /lookupExternalFeed/i,
    });
    await expect(toolHeaderBtn).toBeVisible({ timeout: 10_000 });
    assert.equal(
      await toolHeaderBtn.getAttribute("data-state"),
      "closed",
      "Tool accordion must be collapsed by default"
    );
    await expect(page.getByTestId("tool-error-details")).toBeHidden();

    // Expand the tool accordion -> friendly message visible, raw JSON STILL hidden behind closed <details> ("Details" & "Parameter details")!
    await toolHeaderBtn.click();
    const detailsEl = page.getByTestId("tool-error-details");
    await expect(detailsEl).toBeVisible();
    assert.equal(
      await detailsEl.evaluate((el) => (el as HTMLDetailsElement).open),
      false,
      "Raw error RESULT JSON must remain hidden behind closed 'Details'"
    );
    const inputDetailsEl = page.getByTestId("tool-input-details");
    await expect(inputDetailsEl).toBeVisible();
    assert.equal(
      await inputDetailsEl.evaluate((el) => (el as HTMLDetailsElement).open),
      false,
      "Raw error PARAMETERS JSON must remain hidden behind closed 'Parameter details'"
    );

    const accordionScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(
      accordionScrollW <= 390,
      `Accordion scrollWidth ${accordionScrollW} <= 390`
    );

    await detailsEl.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    await page.screenshot({
      path: join(scratchDir, "verify-bug2-tool-accordion-390.png"),
      fullPage: false,
    });
  } finally {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
    await browser.close();
  }
});
