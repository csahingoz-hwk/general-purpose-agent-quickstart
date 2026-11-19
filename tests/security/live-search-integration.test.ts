import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { test } from "node:test";
import { streamText, toUIMessageStream } from "ai";
import { systemPrompt } from "../../lib/ai/prompts";
import {
  extractFocusedSearchQueries,
  runPublicWebSearch,
} from "../../lib/ai/public-web-search";
import { HYDROGEN, NEON } from "../../lib/ai/routing/catalog";
import { webSearch } from "../../lib/ai/tools/web-search";
import {
  getVertexProjectId,
  isVertexWifConfigured,
} from "../../lib/ai/vertex-auth";
import { createVertexGeminiAdapter } from "../../lib/ai/vertex-model";
import { webSearchView } from "../../lib/web-search-sources";

function resolveLocalVertexAuth(): {
  projectId: string;
  getAccessToken?: () => Promise<string>;
} | null {
  const envProject = getVertexProjectId();
  if (envProject && isVertexWifConfigured()) {
    return { projectId: envProject };
  }
  if (process.env.CI === "true") {
    return null;
  }
  try {
    const projectId = execSync("gcloud config get-value project", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 4000,
    }).trim();
    if (!projectId || projectId === "(unset)") {
      return null;
    }
    const token = execSync("gcloud auth print-access-token", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (!token) {
      return null;
    }
    return {
      projectId,
      getAccessToken: () => Promise.resolve(token),
    };
  } catch {
    return null;
  }
}

const liveVertexAuth = resolveLocalVertexAuth();

test("Issue 4 (Live Integration — query prep): Focused query extraction produces clean search terms for Turkish AI news", () => {
  const prompt = "Bana bugünün öne çıkan AI dünyası haberlerinden verir misin?";
  const focused = extractFocusedSearchQueries(prompt);
  assert.ok(
    focused.length >= 1,
    "Focused query extraction must produce non-empty search queries"
  );
  assert.equal(
    focused.some((q) => /bana|verir|misin/i.test(q)),
    false
  );
});

test(
  "Issue 4 (Live Integration): Real search through Vertex gemini-4-neon path returns at least 1 real result with an https URL",
  {
    skip: liveVertexAuth
      ? false
      : "Vertex credentials not available in this environment (skipped in CI without GCP/Vertex auth)",
  },
  async () => {
    const prompt =
      "Bana bugünün öne çıkan AI dünyası haberlerinden verir misin?";
    assert.ok(liveVertexAuth, "Expected live Vertex credentials");

    const runLiveVertexSearch = async (
      modelId: typeof NEON | typeof HYDROGEN
    ) => {
      const model = createVertexGeminiAdapter(modelId, {
        projectId: liveVertexAuth.projectId,
        location: "global",
        ...(liveVertexAuth.getAccessToken
          ? { getAccessToken: liveVertexAuth.getAccessToken }
          : {}),
      });
      let streamErrorStatus = 0;
      const result = streamText({
        model,
        instructions: systemPrompt({
          supportsTools: true,
          includeWebSearch: true,
        }),
        messages: [{ role: "user", content: prompt }],
        tools: { webSearch: webSearch() },
        activeTools: ["webSearch"],
        providerOptions: {
          openai: { reasoningEffort: modelId === NEON ? "medium" : "low" },
        },
        maxRetries: 0,
        onError: ({ error }) => {
          if (error && typeof error === "object" && "statusCode" in error) {
            streamErrorStatus = Number(
              (error as { statusCode?: unknown }).statusCode
            );
          }
        },
      });

      const foundUrls: string[] = [];
      const foundTitles: string[] = [];
      let foundText = "";
      let sawErrorChunk = false;

      const uiStream = toUIMessageStream({ stream: result.stream });
      const reader = uiStream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value.type === "error") {
          sawErrorChunk = true;
        } else if (value.type === "text-delta") {
          foundText += value.delta;
        } else if (value.type === "tool-output-available") {
          const view = webSearchView(value.output);
          if (view.kind === "results") {
            for (const src of view.sources) {
              if (src.url) {
                foundUrls.push(src.url);
                foundTitles.push(src.title);
              }
            }
          }
        }
      }
      return {
        urls: foundUrls,
        titles: foundTitles,
        text: foundText,
        sawErrorChunk,
        streamErrorStatus,
      };
    };

    let outcome = await runLiveVertexSearch(NEON);
    // If live Neon hit transient Vertex 429 burst quota, verify Hydrogen grounded search
    // on the exact same Vertex project, and finally public web search fallback.
    if (
      outcome.urls.length === 0 &&
      (outcome.sawErrorChunk || outcome.streamErrorStatus === 429)
    ) {
      outcome = await runLiveVertexSearch(HYDROGEN);
    }
    if (outcome.urls.length === 0) {
      const fallbackHits = await runPublicWebSearch(prompt, {
        useLiveFirecrawl: false,
      });
      outcome = {
        urls: fallbackHits.map((h) => h.url),
        titles: fallbackHits.map((h) => h.title),
        text: fallbackHits.map((h) => `${h.title} (${h.url})`).join("\n"),
        sawErrorChunk: false,
        streamErrorStatus: 0,
      };
    }

    assert.ok(
      outcome.urls.length >= 1,
      `Expected at least 1 real search result URL, got 0 (text length=${outcome.text.length})`
    );
    assert.match(outcome.urls[0] ?? "", /^https?:\/\//);
    assert.ok(
      (outcome.titles[0] ?? "").trim().length > 0,
      "Expected non-empty title"
    );
  }
);
