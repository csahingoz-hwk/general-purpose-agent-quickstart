import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { tool } from "ai";
import { z } from "zod";
import { resolveCloudFileUrls } from "@/components/chat/cloud-computer-card";
import { isExcalidrawPayload } from "@/components/chat/excalidraw-card";
import { isInfographicPayload } from "@/components/chat/infographic-card";
import {
  budgetModelMessages,
  DEFAULT_REPLY_TOKENS,
  estimateToolSchemaTokens,
  GROQ_TOOL_TURN_BUDGET,
} from "@/lib/ai/context/budget";
import {
  needsArtifactInstructions,
  selectToolsWithRanking,
} from "@/lib/ai/context/select-tools";
import {
  isVisualCreationTurn,
  resolveTurnModelAndEffort,
} from "@/lib/ai/escalation";
import {
  fetchGroundedNewsBriefing,
  isNewsPageOrBriefingTarget,
} from "@/lib/ai/grounded-news";
import { REGISTERED_APP_MODEL_IDS } from "@/lib/ai/models";
import { systemPrompt } from "@/lib/ai/prompts";
import { COPILOT_HAIKU, HYDROGEN, NEON } from "@/lib/ai/routing/catalog";
import {
  createUsageLedger,
  type Invocation,
  type UsageLedger,
} from "@/lib/ai/routing/ledger";
import { createRoutedModel } from "@/lib/ai/routing/model";
import type { InferenceSession } from "@/lib/ai/routing/session";
import { createExcalidrawDiagramTool } from "@/lib/ai/tools/excalidraw-diagram";
import { createFirecrawlTools } from "@/lib/ai/tools/firecrawl";
import {
  composeSingleFileHtmlDashboard,
  createVisualStudioTools,
  sanitizeSandboxedHtmlDocument,
} from "@/lib/ai/tools/visual-studio";
import {
  FIRECRAWL_KEY_CREATE_URL,
  FIRECRAWL_SETUP_HREF,
} from "@/lib/connectors/firecrawl";
import {
  validateAndNormalizeExcalidrawScene,
  validateMermaidCode,
} from "@/lib/excalidraw/schema";
import { buildPrivateFileHttpResponse } from "@/lib/files/http-response";
import { verifySignedFileToken } from "@/lib/files/signed-url";
import { createInMemoryPrivateFileStore } from "@/lib/files/store";
import { BUILT_IN_SKILLS } from "@/lib/skills/library";
import type { ChatMessage } from "@/lib/types";

const mkUserMsg = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

async function execTool<
  TTool extends {
    execute?: (...args: never[]) => unknown;
  },
>(
  toolObj: TTool,
  input: Parameters<NonNullable<TTool["execute"]>>[0],
  toolCallId = "tc-test"
): Promise<
  Exclude<
    Awaited<ReturnType<NonNullable<TTool["execute"]>>>,
    AsyncIterable<unknown>
  >
> {
  if (!toolObj.execute) {
    throw new Error("Missing tool execute handler");
  }
  const fn = toolObj.execute as unknown as (
    arg0: unknown,
    arg1: unknown
  ) => Promise<unknown>;
  const out = await fn(input, { toolCallId, messages: [], context: undefined });
  return out as Exclude<
    Awaited<ReturnType<NonNullable<TTool["execute"]>>>,
    AsyncIterable<unknown>
  >;
}

const SAMPLE_1X1_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// ---------------------------------------------------------------------------
// Item 9: Firecrawl tools, Setup checklist, Firecrawl skill, & news grounding
// ---------------------------------------------------------------------------
test("Item 9a: Missing FIRECRAWL_API_KEY returns plain-language not-connected guidance pointing to Setup + Firecrawl API keys link, with no hardcoded key", async () => {
  const prevKey = process.env.FIRECRAWL_API_KEY;
  Reflect.deleteProperty(process.env, "FIRECRAWL_API_KEY");
  try {
    const tools = createFirecrawlTools({ apiKey: null });

    const searchOut = await execTool(tools.firecrawlSearch, {
      query: "latest open source AI releases",
      limit: 3,
    });
    const scrapeOut = await execTool(tools.firecrawlScrape, {
      url: "https://example.com/docs",
    });
    const mapOut = await execTool(tools.firecrawlCrawlMap, {
      url: "https://example.com",
      mode: "map",
      limit: 10,
    });

    for (const out of [searchOut, scrapeOut, mapOut]) {
      assert.equal(out.status, "setup_required");
      if (out.status === "setup_required") {
        assert.equal(out.connectProvider, "firecrawl");
        assert.equal(out.setupHref, FIRECRAWL_SETUP_HREF);
        assert.equal(out.externalKeyUrl, FIRECRAWL_KEY_CREATE_URL);
        assert.match(out.message, /not connected/i);
        assert.match(out.message, /\/setup#setup-firecrawl/);
        assert.match(
          out.message,
          /https:\/\/www\.firecrawl\.dev\/app\/api-keys/
        );
      }
    }

    // Ensure no actual FIRECRAWL_API_KEY secret was committed to env files
    for (const envFile of [".env", ".env.local", ".env.production"]) {
      if (existsSync(envFile)) {
        const raw = readFileSync(envFile, "utf8");
        assert.doesNotMatch(raw, /^FIRECRAWL_API_KEY=fc-[A-Za-z0-9]+/m);
      }
    }
  } finally {
    if (prevKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = prevKey;
    }
  }
});

test("Item 9b: Connected Firecrawl search, scrape, and map/crawl return fenced dated Markdown, enforce SSRF & KF guards, and power Setup + Skills + Fix 8 news", async () => {
  const tools = createFirecrawlTools({
    apiKey: "fc-test-mock-key-only",
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/search")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  title: "Apache ECharts 6 Released",
                  url: "https://echarts.apache.org/en/changelog.html",
                  description: "New dark/light theme system and jitter layout.",
                  markdown: "## ECharts 6\nPublished 2026-11-15.",
                  metadata: { publishedTime: "2026-11-15" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      if (url.endsWith("/v1/scrape")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                markdown: "# Documentation\nClean extracted Markdown table.",
                metadata: {
                  title: "Example Docs",
                  sourceURL: "https://docs.example.com/guide",
                  publishedTime: "2026-11-10T09:00:00Z",
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      if (url.endsWith("/v1/map")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              links: [
                "https://docs.example.com/intro",
                "https://docs.example.com/api",
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      if (url.endsWith("/v1/crawl")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: "crawl-job-42" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }
      if (url.endsWith("/v1/crawl/crawl-job-42")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "completed",
              data: [
                {
                  markdown: "# Intro Page\nBody text",
                  metadata: {
                    title: "Intro",
                    sourceURL: "https://docs.example.com/intro",
                    publishedTime: "2026-11-12",
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }) as typeof fetch,
  });

  const searchRes = await execTool(tools.firecrawlSearch, {
    query: "Apache ECharts 6 release",
    limit: 3,
  });
  assert.equal(searchRes.status, "ok");
  if (searchRes.status === "ok") {
    assert.equal(searchRes.results[0]?.publishedDate, "2026-11-15");
    assert.equal(
      searchRes.results[0]?.url,
      "https://echarts.apache.org/en/changelog.html"
    );
    assert.match(
      searchRes.results[0]?.fencedMarkdown ?? "",
      /untrusted_content/
    );
  }

  const scrapeRes = await execTool(tools.firecrawlScrape, {
    url: "https://docs.example.com/guide",
    onlyMainContent: true,
  });
  assert.equal(scrapeRes.status, "ok");
  if (scrapeRes.status === "ok") {
    assert.equal(scrapeRes.publishedDate, "2026-11-10");
    assert.match(scrapeRes.fencedMarkdown, /Clean extracted Markdown table/);
    assert.match(scrapeRes.fencedMarkdown, /untrusted_content/);
  }

  // SSRF & Korn Ferry boundary checks
  const ssrfBlocked = await execTool(tools.firecrawlScrape, {
    url: "http://169.254.169.254/latest/meta-data",
  });
  assert.equal(ssrfBlocked.status, "error");
  if (ssrfBlocked.status === "error") {
    assert.match(ssrfBlocked.message, /Blocked internal or metadata address/i);
  }

  const kfBlocked = await execTool(tools.firecrawlSearch, {
    query: "Korn Ferry Hay Group internal fee schedule",
  });
  assert.equal(kfBlocked.status, "blocked_data_boundary");

  // Map + Crawl modes
  const mapRes = await execTool(tools.firecrawlCrawlMap, {
    url: "https://docs.example.com",
    mode: "map",
    limit: 10,
  });
  assert.equal(mapRes.status, "ok");
  if (mapRes.status === "ok" && mapRes.mode === "map") {
    assert.deepEqual(mapRes.links, [
      "https://docs.example.com/intro",
      "https://docs.example.com/api",
    ]);
  }

  const crawlRes = await execTool(tools.firecrawlCrawlMap, {
    url: "https://docs.example.com",
    mode: "crawl",
    limit: 2,
  });
  assert.equal(crawlRes.status, "ok");
  if (crawlRes.status === "ok" && crawlRes.mode === "crawl") {
    assert.equal(crawlRes.pages?.length, 1);
    assert.equal(crawlRes.pages?.[0]?.publishedDate, "2026-11-12");
  }

  // Setup checklist + Firecrawl skill playbook + Fix 8 grounded news integration
  const setupSrc = readFileSync("app/api/setup-status/route.ts", "utf8");
  assert.match(setupSrc, /id:\s*"firecrawl"/);
  assert.match(setupSrc, /externalUrl:\s*FIRECRAWL_KEY_CREATE_URL/);
  assert.equal(
    FIRECRAWL_KEY_CREATE_URL,
    "https://www.firecrawl.dev/app/api-keys"
  );

  const firecrawlSkill = BUILT_IN_SKILLS.find((s) => s.slug === "firecrawl");
  assert.ok(firecrawlSkill, "Built-in Firecrawl skill must exist");
  assert.match(firecrawlSkill.instructions, /When to Search/i);
  assert.match(firecrawlSkill.instructions, /When to Scrape/i);
  assert.match(firecrawlSkill.instructions, /YYYY-MM-DD/);

  const groundedViaFirecrawl = await fetchGroundedNewsBriefing(
    "AI infrastructure news",
    {
      firecrawlApiKey: "fc-test-mock-key-only",
      now: new Date("2026-11-18T12:00:00Z"),
      fetcher: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  title: "Cloud AI Chip Benchmark Published",
                  url: "https://www.reuters.com/technology/ai-chip-2026-11-17/",
                  description: "Independent latency numbers released.",
                  metadata: { publishedTime: "2026-11-17" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )) as typeof fetch,
    }
  );
  assert.equal(groundedViaFirecrawl.ok, true);
  assert.match(groundedViaFirecrawl.promptContext, /2026-11-17/);
  assert.match(
    groundedViaFirecrawl.sources[0]?.url ?? "",
    /^https:\/\/www\.reuters\.com\//
  );
});

// ---------------------------------------------------------------------------
// Item 10: Single-file HTML pages & ECharts dashboards (sandboxed + iPhone Safari)
// ---------------------------------------------------------------------------
test("Item 10: buildHtmlPageOrDashboard produces single-file ECharts HTML (dark/light), strips top-nav, saves to Cloud Computer, and renders in strict sandboxed iframe", async () => {
  const composed = composeSingleFileHtmlDashboard({
    title: "Monthly Revenue & Margin",
    subtitle: "FY26 Q3 Executive Snapshot",
    kpis: [
      {
        label: "Revenue",
        value: "$1.42M",
        delta: "+14% YoY",
        tone: "positive",
      },
      {
        label: "Net Margin",
        value: "28.4%",
        delta: "+2.1 pp",
        tone: "positive",
      },
    ],
    charts: [
      {
        title: "Monthly Revenue ($K)",
        option: {
          xAxis: { type: "category", data: ["Aug", "Sep", "Oct", "Nov"] },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: [310, 340, 365, 405] }],
        },
      },
    ],
  });
  assert.match(composed, /echarts@6/i);
  assert.match(composed, /prefers-color-scheme:\s*dark/);
  assert.match(composed, /ResizeObserver/);
  assert.match(composed, /themeToggle/);

  const sanitized = sanitizeSandboxedHtmlDocument(
    '<base target="_top"><script>window.top.location = "https://evil.example"; parent.location.href = "https://evil.example";</script>'
  );
  assert.doesNotMatch(sanitized, /target\s*=\s*["']?_top/i);
  assert.doesNotMatch(sanitized, /top\.location|parent\.location/i);

  const fileStore = createInMemoryPrivateFileStore({ secret: "d".repeat(64) });
  let writtenWorkspacePath = "";
  const visualTools = createVisualStudioTools({
    userId: "owner-visual",
    fileStore,
    signingSecret: "e".repeat(64),
    relayUrl: "https://cloud-vm.internal.example",
    hmacSecret: "f".repeat(64),
    fetchImpl: ((url, init) => {
      const u = String(url);
      if (u.endsWith("/files/write")) {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          path: string;
        };
        writtenWorkspacePath = parsed.path;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ok",
              path: parsed.path,
              bytesWritten: 512,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch,
  });

  const out = await execTool(visualTools.buildHtmlPageOrDashboard, {
    title: "Q3 Revenue Dashboard",
    filename: "q3_dashboard.html",
    kpis: [{ label: "ARR", value: "$4.8M", delta: "+18%", tone: "positive" }],
    charts: [
      {
        title: "ARR Trend",
        optionJson: JSON.stringify({
          xAxis: { type: "category", data: ["Q1", "Q2", "Q3"] },
          yAxis: { type: "value" },
          series: [{ type: "line", data: [3.8, 4.3, 4.8] }],
        }),
      },
    ],
  });

  assert.equal(out.status, "ok");
  if (out.status === "ok") {
    assert.equal(writtenWorkspacePath, "/workspace/q3_dashboard.html");
    assert.equal(out.autoOpenPreview, true);
    assert.match(out.previewUrl, /^\/api\/files\/.+\?disposition=inline$/);
    assert.match(out.downloadUrl, /^\/api\/files\/.+/);
    const resolvedUrls = resolveCloudFileUrls(out);
    assert.match(resolvedUrls.downloadUrl ?? "", /disposition=attachment/);
    assert.match(resolvedUrls.previewUrl ?? "", /disposition=inline/);
    const rawToken = decodeURIComponent(
      out.previewUrl.replace(/^\/api\/files\//, "").split("?")[0] ?? ""
    );
    const verified = verifySignedFileToken(rawToken, {
      secret: "e".repeat(64),
    });
    assert.equal(verified.valid, true);
    if (verified.valid) {
      const storedBytes = await fileStore.read({
        userId: "owner-visual",
        fileId: verified.payload.fid,
        contentType: verified.payload.ct,
        storageRef: verified.payload.ref,
      });
      assert.ok(storedBytes);
      const inlineResp = buildPrivateFileHttpResponse({
        bytes: storedBytes,
        contentType: verified.payload.ct,
        filename: verified.payload.name,
        disposition: "inline",
      });
      assert.match(
        inlineResp.headers.get("Content-Security-Policy") ?? "",
        /sandbox allow-scripts/
      );
      assert.doesNotMatch(
        inlineResp.headers.get("Content-Security-Policy") ?? "",
        /allow-same-origin|allow-top-navigation/
      );
    }
  }

  // Verify CloudComputerCard iframe sandbox strictly omits allow-same-origin & allow-top-navigation
  const cardSrc = readFileSync(
    "components/chat/cloud-computer-card.tsx",
    "utf8"
  );
  const sandboxMatches = [...cardSrc.matchAll(/sandbox="([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(sandboxMatches.length >= 2, "Expected inline + fullscreen iframes");
  for (const sb of sandboxMatches) {
    assert.doesNotMatch(sb, /allow-same-origin/);
    assert.doesNotMatch(sb, /allow-top-navigation/);
  }
  assert.match(cardSrc, /cloud-file-fullscreen/);
  assert.match(cardSrc, /cloud-file-download/);
});

// ---------------------------------------------------------------------------
// Item 11: Interactive Excalidraw diagrams + Mermaid fallback
// ---------------------------------------------------------------------------
test("Item 11: createExcalidrawDiagram validates Excalidraw scene JSON, expands bound labels, supports Mermaid fallback, and lazy-loads editable canvas with PNG/SVG/.excalidraw exports", async () => {
  const diagramTool = createExcalidrawDiagramTool();

  const validOut = await execTool(diagramTool, {
    title: "Event-Driven Order Pipeline",
    elementsJson: JSON.stringify([
      {
        id: "api_gw",
        type: "rectangle",
        x: 80,
        y: 120,
        width: 200,
        height: 80,
        backgroundColor: "#dbeafe",
        label: "API Gateway",
      },
      {
        id: "worker_q",
        type: "rectangle",
        x: 380,
        y: 120,
        width: 200,
        height: 80,
        backgroundColor: "#dcfce7",
        label: "Order Worker",
      },
      {
        id: "edge_1",
        type: "arrow",
        x: 280,
        y: 160,
        points: [
          [0, 0],
          [100, 0],
        ],
        startBinding: { elementId: "api_gw" },
        endBinding: { elementId: "worker_q" },
        label: "enqueue",
      },
    ]),
    mermaidFallback:
      "flowchart LR\n  A[API Gateway] -->|enqueue| B[Order Worker]",
  });

  assert.equal(validOut.status, "ok");
  assert.equal(isExcalidrawPayload(validOut), true);
  if (validOut.status === "ok") {
    assert.equal(validOut.mode, "excalidraw");
    assert.ok(validOut.scene);
    // 3 base elements + 3 expanded bound text elements = 6 elements
    assert.equal(validOut.scene.elements.length, 6);
    const boundLabel = validOut.scene.elements.find(
      (e) => e.id === "api_gw_label"
    );
    assert.equal(boundLabel?.containerId, "api_gw");
    assert.equal(boundLabel?.text, "API Gateway");
    assert.match(validOut.mermaidFallback ?? "", /^flowchart LR/);
  }

  // Invalid scene schema rejected cleanly when no Mermaid fallback is supplied
  const badSchema = validateAndNormalizeExcalidrawScene({ elements: [] });
  assert.equal(badSchema.valid, false);
  assert.equal(validateMermaidCode("not a valid diagram"), null);

  // Simple-flow Mermaid fallback works cleanly
  const mermaidOnly = await execTool(diagramTool, {
    title: "Simple Login Flow",
    mode: "mermaid",
    mermaidFallback:
      "sequenceDiagram\n  User->>App: Sign in\n  App-->>User: 200 OK",
  });
  assert.equal(mermaidOnly.status, "ok");
  if (mermaidOnly.status === "ok") {
    assert.equal(mermaidOnly.mode, "mermaid");
    assert.equal(mermaidOnly.scene, null);
    assert.match(mermaidOnly.mermaidFallback ?? "", /^sequenceDiagram/);
  }

  // Verify lazy client-only dynamic import (`ssr: false`) and PNG/SVG/.excalidraw export controls
  const exCardSrc = readFileSync("components/chat/excalidraw-card.tsx", "utf8");
  assert.match(
    exCardSrc,
    /dynamic\(\s*\(\)\s*=>\s*import\("\.\/excalidraw-canvas-inner"\)/
  );
  assert.match(exCardSrc, /ssr:\s*false/);
  assert.match(exCardSrc, /excalidraw-export-png/);
  assert.match(exCardSrc, /excalidraw-export-svg/);
  assert.match(exCardSrc, /excalidraw-download-scene/);
});

// ---------------------------------------------------------------------------
// Item 12: Infographics rendered via Cloud Chromium + optional Vertex-only hero
// ---------------------------------------------------------------------------
test("Item 12: generateInfographic renders PNG on Cloud Computer via headless Chromium, uses ONLY Vertex Ultra credit for optional hero illustration, and exposes Full screen + Download", async () => {
  const prevProject = process.env.GOOGLE_VERTEX_PROJECT_ID;
  const prevAudience = process.env.GOOGLE_VERTEX_WORKLOAD_AUDIENCE;
  const prevOidc = process.env.VERCEL_OIDC_TOKEN;
  process.env.GOOGLE_VERTEX_PROJECT_ID = "project-cd0bc64c-0025-446c-b41";
  process.env.GOOGLE_VERTEX_WORKLOAD_AUDIENCE =
    "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/v";
  process.env.VERCEL_OIDC_TOKEN = [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url"
    ),
    Buffer.from(
      JSON.stringify({
        iss: "https://oidc.vercel.com",
        sub: "owner:test:project:test:environment:production",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: "infographic-test-jti",
      })
    ).toString("base64url"),
    "sig",
  ].join(".");

  const calledUrls: string[] = [];
  let chromiumExecCommand = "";
  const fileStore = createInMemoryPrivateFileStore({ secret: "1".repeat(64) });
  const reservedCalls: Invocation[] = [];
  const ledger: UsageLedger = {
    reserve: (call) => {
      reservedCalls.push(call);
      return Promise.resolve("inv-ultra-0");
    },
    settle: () => Promise.resolve(),
  };

  try {
    const visualTools = createVisualStudioTools({
      userId: "owner-infographic",
      fileStore,
      ledger,
      signingSecret: "2".repeat(64),
      relayUrl: "https://cloud-vm.internal.example",
      hmacSecret: "3".repeat(64),
      fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calledUrls.push(url);

        if (url.includes("sts.googleapis.com")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "ya29.mock-vertex-ultra-token",
                expires_in: 3600,
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }

        if (url.includes("aiplatform.googleapis.com")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                predictions: [{ bytesBase64Encoded: SAMPLE_1X1_PNG_BASE64 }],
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        if (url.endsWith("/files/write")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: "ok",
                path: "/workspace/infographics/x.html",
                bytesWritten: 512,
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        if (url.endsWith("/exec")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            command: string;
          };
          chromiumExecCommand = body.command;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: "ok",
                exitCode: 0,
                stdout: "rendered",
                stderr: "",
                cwd: "/workspace",
                durationMs: 95,
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        if (url.endsWith("/files/read")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: "ok",
                path: "/workspace/infographics/x.png",
                sizeBytes: 68,
                base64: SAMPLE_1X1_PNG_BASE64,
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }) as typeof fetch,
    });

    const out = await execTool(visualTools.generateInfographic, {
      title: "2026 Renewable Energy Snapshot",
      subtitle: "Global capacity additions & grid storage",
      palette: "emerald",
      stats: [
        { label: "Solar Additions", value: "590 GW", caption: "+29% YoY" },
        { label: "Battery Storage", value: "142 GWh", caption: "+64% YoY" },
      ],
      sections: [
        {
          heading: "Key Drivers",
          bullets: [
            "Utility-scale LCOE fell 14% year over year",
            "4-hour grid batteries smoothed evening peaks",
          ],
        },
      ],
      heroIllustrationPrompt:
        "Minimalist editorial illustration of solar panels and wind turbines at sunrise",
    });

    assert.equal(out.status, "ok");
    assert.equal(isInfographicPayload(out), true);
    if (out.status === "ok") {
      assert.equal(out.mediaType, "image/png");
      assert.equal(out.renderedVia, "cloud_chromium");
      assert.equal(out.usedVertexHeroImage, true);
      assert.match(out.imageUrl, /disposition=inline/);
      assert.match(out.downloadUrl, /disposition=attachment/);
    }
    assert.match(chromiumExecCommand, /--headless/);
    assert.match(chromiumExecCommand, /--screenshot=/);
    // Hero illustration used ONLY Vertex AI on the Ultra credit ($0 cash spend)
    assert.ok(calledUrls.some((u) => u.includes("aiplatform.googleapis.com")));
    assert.equal(
      calledUrls.some(
        (u) =>
          u.includes("api.openai.com") ||
          u.includes("replicate.com") ||
          u.includes("fal.run")
      ),
      false
    );
    assert.equal(reservedCalls.length, 1);
    assert.equal(reservedCalls[0]?.reserveUsd, 0);

    const infoCardSrc = readFileSync(
      "components/chat/infographic-card.tsx",
      "utf8"
    );
    assert.match(infoCardSrc, /infographic-fullscreen-btn/);
    assert.match(infoCardSrc, /infographic-download-btn/);
  } finally {
    if (prevProject === undefined) {
      Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_PROJECT_ID");
    } else {
      process.env.GOOGLE_VERTEX_PROJECT_ID = prevProject;
    }
    if (prevAudience === undefined) {
      Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_WORKLOAD_AUDIENCE");
    } else {
      process.env.GOOGLE_VERTEX_WORKLOAD_AUDIENCE = prevAudience;
    }
    if (prevOidc === undefined) {
      Reflect.deleteProperty(process.env, "VERCEL_OIDC_TOKEN");
    } else {
      process.env.VERCEL_OIDC_TOKEN = prevOidc;
    }
  }
});

// ---------------------------------------------------------------------------
// Visual Routing: Hydrogen -> Neon escalation -> Copilot Haiku fallback (NEVER 3.x)
// ---------------------------------------------------------------------------
test("Visual Routing: dashboard, diagram, infographic, and HTML page intents (EN + TR) escalate to gemini-4-neon, fall back to claude-haiku-5.5, and never touch Gemini 3.x", async () => {
  const cases: Array<{
    prompt: string;
    expectedTool:
      | "buildHtmlPageOrDashboard"
      | "createExcalidrawDiagram"
      | "generateInfographic";
  }> = [
    {
      prompt: "Build an interactive revenue dashboard with ECharts",
      expectedTool: "buildHtmlPageOrDashboard",
    },
    {
      prompt: "Bana aylık gelir gider için tek sayfalık bir dashboard yap",
      expectedTool: "buildHtmlPageOrDashboard",
    },
    {
      prompt: "Create a single-file HTML page summarizing our product roadmap",
      expectedTool: "buildHtmlPageOrDashboard",
    },
    {
      prompt: "Draw a microservice architecture diagram in Excalidraw",
      expectedTool: "createExcalidrawDiagram",
    },
    {
      prompt: "Sipariş sistemi için bir akış şeması diyagram çiz",
      expectedTool: "createExcalidrawDiagram",
    },
    {
      prompt: "Create an infographic summarizing healthy sleep habits",
      expectedTool: "generateInfographic",
    },
    {
      prompt: "Yenilenebilir enerji verileriyle bir infografik hazırla",
      expectedTool: "generateInfographic",
    },
  ];

  for (const c of cases) {
    const selected = selectToolsWithRanking([mkUserMsg(c.prompt)], true, true);
    assert.ok(
      selected.intentMatchedTools.includes(c.expectedTool),
      `Expected ${c.expectedTool} in intentMatchedTools for "${c.prompt}", got [${selected.intentMatchedTools.join(", ")}]`
    );
    assert.equal(
      isVisualCreationTurn(c.prompt, selected.intentMatchedTools),
      true
    );

    const routing = resolveTurnModelAndEffort({
      selectedModelId: HYDROGEN,
      availableModelIds: [HYDROGEN, NEON],
      userText: c.prompt,
      requestedTools: selected.intentMatchedTools,
    });
    assert.equal(
      routing.modelId,
      NEON,
      `Expected ${NEON} for visual prompt "${c.prompt}"`
    );
    assert.equal(routing.escalated, true);
    assert.equal(routing.reasoningEffort, "medium");
  }

  // Verify no 3.x model exists anywhere in registered models
  for (const modelId of REGISTERED_APP_MODEL_IDS) {
    assert.doesNotMatch(modelId, /3\./);
  }

  // Verify automatic fallback from gemini-4-neon -> claude-haiku-5.5 when Vertex fails before exposure
  const fallbackEvents: Array<{ fromModel: string; toModel: string }> = [];
  const session: InferenceSession = {
    ledger: createUsageLedger("owner-1", "turn-vis-fallback"),
    available: [HYDROGEN, NEON, COPILOT_HAIKU],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    activeModelId: NEON,
    onFallback: ({ fromModel, toModel }) => {
      fallbackEvents.push({ fromModel, toModel });
    },
  };

  const routed = createRoutedModel(
    NEON,
    session,
    (id) =>
      ({
        specificationVersion: "v4",
        provider: "test",
        modelId: id,
        supportedUrls: {},
        doGenerate: () => {
          if (id === NEON) {
            const err = Object.assign(new Error("Vertex 503"), {
              statusCode: 503,
            });
            return Promise.reject(err);
          }
          return Promise.resolve({
            content: [
              { type: "text", text: "Rendered via Copilot Haiku fallback" },
            ],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 20,
                noCache: 20,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
            warnings: [],
          });
        },
        doStream: () => Promise.reject(new Error("unused")),
      }) as unknown as LanguageModelV4
  );

  const generated = await routed.doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Build a dashboard" }] },
    ],
  });
  assert.equal(session.fallbackUsed, true);
  assert.equal(session.activeModelId, COPILOT_HAIKU);
  assert.deepEqual(fallbackEvents, [
    { fromModel: NEON, toModel: COPILOT_HAIKU },
  ]);
  assert.equal(
    generated.content[0]?.type === "text" ? generated.content[0].text : "",
    "Rendered via Copilot Haiku fallback"
  );

  // Verify synthetic SDK 7 artifact turn ("Create a document about a synthetic test.") fits comfortably
  // under GROQ_TOOL_TURN_BUDGET while news prompts still inject GROUNDED_NEWS_PAGE_RULES
  const synthText = "Create a document about a synthetic test.";
  const synthSelected = selectToolsWithRanking([mkUserMsg(synthText)], true);
  assert.deepEqual(synthSelected.activeTools, ["createDocument"]);
  const synthSys = systemPrompt({
    supportsTools: true,
    includeArtifacts: needsArtifactInstructions(synthSelected.activeTools),
    includeGroundedNews: isNewsPageOrBriefingTarget({ userText: synthText }),
    context: "Current date: Wednesday, 18 November 2026, 22:00 UTC.",
  });
  const createDocStubTools = {
    createDocument: tool({
      description:
        "Create a document for a writing or content creation activities.",
      inputSchema: z.object({
        title: z.string(),
        kind: z.enum(["text", "code", "sheet"]),
      }),
    }),
  };
  const schemaTokens = await estimateToolSchemaTokens(
    createDocStubTools as never,
    ["createDocument"]
  );
  const budgeted = budgetModelMessages({
    messages: [{ role: "user", content: synthText }],
    system: synthSys,
    toolCount: 1,
    toolSchemaTokens: schemaTokens,
    maxOutputTokens: DEFAULT_REPLY_TOKENS,
    requestBudget: GROQ_TOOL_TURN_BUDGET,
  });
  assert.equal(budgeted.tooLarge, false);

  const newsSys = systemPrompt({
    supportsTools: true,
    includeGroundedNews: isNewsPageOrBriefingTarget({
      userText: "Build a latest AI news HTML page",
    }),
  });
  assert.match(newsSys, /News Pages & Current-Events Briefings/);
});
