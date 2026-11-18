import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleConnectorTools } from "../../lib/ai/tools/google-connectors";
import { isSetupRequiredOutput } from "../../lib/connectors/card-state";
import {
  GOOGLE_VAULT_SECRET_NAMES,
  resolveGoogleAccessTokenFromVault,
} from "../../lib/connectors/google-vault-auth";
import {
  createResilientChunkMergeRunner,
  DEFAULT_MERGE_CHUNK_CHARS,
  mergeMemoryExports,
  type VertexMergeRunner,
} from "../../lib/memory/multi-source-merge";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import { createInMemoryVaultStore } from "../../lib/vault/secret-vault";

const MASTER_KEY = "0123456789abcdef0123456789abcdef-vault-master";

function build30kMixedClaudeExport(): string {
  const sections: string[] = [
    "# Claude Memory Export",
    "Exported: 2026-11-17",
    "",
    "## Rules & Guardrails",
    "Never use pay-per-use API models without asking first. Always route everyday chat through Gemini 4 Hydrogen on Google AI Ultra credit and escalate deep research to Gemini 4 Argon. Keep GitHub Copilot SDK Claude Haiku 5.5 as the sole fallback on the Cloud VM bridge.",
    "- Onayım olmadan asla kullandıkça öde API modeli kullanma ve her zaman gerçek model adını arayüzde göster.",
    // Intentional exact duplicate to verify local pre-dedupe before model calls:
    "- Never use pay-per-use API models without asking first.",
    // Intentional sensitive + KF lines to verify local stripping across 30k chars:
    "- Wi-Fi password is SuperSecret9988! and card 4532 1111 2222 3333",
    "- Home address: 221B Baker Street, London NW1 6XE",
    "- Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, and Turkey; reconciles SA90 EOSB GL 239300.",
    "",
    "## Family, Projects & Bilingual Notes",
  ];

  // Generate ~31,500 chars of realistic mixed TR/EN multi-sentence paragraphs (~160 distinct facts)
  let idx = 1;
  while (sections.join("\n").length < 31_200) {
    sections.push(
      `Çağlar builds personal AI tools in TypeScript and Next.js module #${idx} using strict 390px iPhone viewport checks. Dr. notes confirm daughter Ece studies Edexcel GCSE History topic #${idx} with bilingual flashcards in London. Tercih #${idx}: Karşılaştırma sorularında düz metin yerine her zaman temiz tablo ve grafik kartları üretilmeli ve gereksiz JSON hata mesajları gizlenmelidir.`
    );
    // Add an exact duplicate every 10th block to test cross-export local pre-dedupe at scale
    if (idx % 10 === 0) {
      sections.push(
        `- Çağlar builds personal AI tools in TypeScript and Next.js module #${idx} using strict 390px iPhone viewport checks.`
      );
    }
    idx += 1;
  }

  return sections.join("\n\n");
}

test("Bug 1: 30k+ char mixed TR/EN Claude export pre-splits paragraphs, pre-dedupes locally, chunks <= 6.8k chars, and merges cleanly with zero KF/secret leakage", async () => {
  const store = createInMemoryMemoryStore();
  const existingFacts = await store.listProfileFacts({ userId: "owner-1" });
  const bigClaudeExport = build30kMixedClaudeExport();
  assert.ok(
    bigClaudeExport.length >= 30_000,
    `Expected >= 30k chars, got ${bigClaudeExport.length}`
  );

  const chunkPayloadSizes: number[] = [];
  const progressEvents: number[] = [];

  const mockChunkRunner: VertexMergeRunner = ({ candidates }) => {
    const serialized = JSON.stringify(candidates);
    chunkPayloadSizes.push(serialized.length);
    assert.ok(
      serialized.length <= DEFAULT_MERGE_CHUNK_CHARS + 512,
      `Chunk exceeded budget: ${serialized.length} chars`
    );
    // Zero Korn Ferry or sensitive secrets may enter ANY chunk
    assert.doesNotMatch(
      serialized,
      /korn\s*ferry|sa90|eosb|239300|supersecret|4532|baker street/i
    );

    return Promise.resolve({
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
    });
  };

  const result = await mergeMemoryExports({
    sources: [
      {
        source: "claude",
        exportedAt: "2026-11-17",
        rawText: bigClaudeExport,
      },
    ],
    existingFacts,
    runner: mockChunkRunner,
    onProgress: (ev) => {
      progressEvents.push(ev.completedChunks);
    },
  });

  assert.ok(
    chunkPayloadSizes.length >= 4,
    `Expected >= 4 chunks for 31k export, got ${chunkPayloadSizes.length}`
  );
  assert.equal(result.chunksTotal, chunkPayloadSizes.length);
  assert.equal(result.chunksSucceeded, chunkPayloadSizes.length);
  assert.equal(result.failedChunks, undefined);
  assert.ok(result.items.length >= 120);
  assert.ok(
    result.counts.mergedCount >= 5,
    "Exact duplicates pre-deduped locally must surface as status='merged'"
  );
  assert.ok(
    result.counts.skippedSensitiveCount >= 3,
    "Passwords/cards, postal address, and restricted KF clause must be skipped"
  );
  // Short Korn Ferry job-title/region context line was preserved locally
  assert.ok(
    result.items.some((i) =>
      /MENA Finance Controller at Korn Ferry/i.test(i.value)
    )
  );
  assert.ok(progressEvents.length >= chunkPayloadSizes.length);
});

test("Bug 1 partial-chunk recovery: if 1 chunk fails after retries, successful chunks are preserved and the failed part is reported for retry", async () => {
  const bigClaudeExport = build30kMixedClaudeExport();
  let callNum = 0;

  const flakyRunner: VertexMergeRunner = ({ candidates }) => {
    callNum += 1;
    if (callNum === 2) {
      return Promise.reject(new Error("vertex_timeout"));
    }
    return Promise.resolve({
      modelUsed: "gemini-4-hydrogen",
      payload: {
        items: candidates.map((c) => ({
          status: "new" as const,
          fact: c.text.endsWith(".") ? c.text : `${c.text}.`,
          category: "projects" as const,
          candidateIndices: [c.idx],
          existingFactId: null,
        })),
      },
    });
  };

  const result = await mergeMemoryExports({
    sources: [{ source: "claude", rawText: bigClaudeExport }],
    existingFacts: [],
    runner: flakyRunner,
  });

  assert.ok((result.chunksTotal ?? 0) >= 4);
  assert.equal(result.chunksSucceeded, (result.chunksTotal ?? 0) - 1);
  assert.equal(result.failedChunks?.length, 1);
  assert.ok((result.failedChunks?.[0]?.lineCount ?? 0) > 0);
  assert.ok((result.failedChunks?.[0]?.retryText.length ?? 0) > 20);
  assert.ok(
    result.items.length >= 90,
    "Successful chunks must remain ready to approve & save"
  );
});

test("Bug 1 per-chunk escalation & fallback chain: Hydrogen -> retry Hydrogen -> escalate Argon -> fallback Copilot Claude Haiku 5.5", async () => {
  const attempts: string[] = [];
  const runner = createResilientChunkMergeRunner({
    hasVertex: true,
    hasCopilot: true,
    createVertexModel: (modelId, opts) => ({
      doGenerate: (params) => {
        attempts.push(`${modelId}:${opts.timeoutMs}:${params.maxOutputTokens}`);
        return Promise.reject(new Error("vertex_timeout"));
      },
    }),
    createCopilotModel: (opts) => ({
      doGenerate: () => {
        attempts.push(`claude-haiku-5.5:${opts.timeoutMs}`);
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: [
                  {
                    status: "new",
                    fact: "Çağlar lives in London and works in GMT/BST.",
                    category: "about_me",
                    candidateIndices: [0],
                    existingFactId: null,
                  },
                ],
              }),
            },
          ],
        });
      },
    }),
  });

  const result = await mergeMemoryExports({
    sources: [
      {
        source: "claude",
        rawText: "- Çağlar lives in London and works in GMT/BST.",
      },
    ],
    existingFacts: [],
    runner,
  });

  assert.deepEqual(attempts, [
    "gemini-4-hydrogen:45000:16384",
    "gemini-4-hydrogen:45000:16384",
    "gemini-4-argon:55000:16384",
    "claude-haiku-5.5:45000",
  ]);
  assert.equal(result.modelUsed, "claude-haiku-5.5");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.category, "about_me");
});

test("Bug 2: gmailReadMessages({}) defaults to latest 10 inbox messages (in:inbox), refreshes stale access tokens via refresh_token first, and returns reconnect_required instead of raw JSON errors", async () => {
  const vault = createInMemoryVaultStore(MASTER_KEY);
  // Store BOTH a stale 1-hour access token AND a valid refresh token:
  await vault.upsertSecret({
    userId: "owner-1",
    name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
    plaintext: "ya29.stale-expired-access-token",
  });
  await vault.upsertSecret({
    userId: "owner-1",
    name: GOOGLE_VAULT_SECRET_NAMES.refreshToken,
    plaintext: "1//valid-refresh-token",
  });
  await vault.upsertSecret({
    userId: "owner-1",
    name: GOOGLE_VAULT_SECRET_NAMES.clientId,
    plaintext: "test-client.apps.googleusercontent.com",
  });
  await vault.upsertSecret({
    userId: "owner-1",
    name: GOOGLE_VAULT_SECRET_NAMES.clientSecret,
    plaintext: "GOCSPX-test-secret",
  });

  // 1) Resolver MUST prefer refresh_token over stale direct access_token
  const auth = await resolveGoogleAccessTokenFromVault({
    userId: "owner-1",
    vaultStore: vault,
    fetchImpl: ((url) => {
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "ya29.freshly-refreshed-token" }),
          { status: 200 }
        )
      );
    }) as typeof fetch,
  });
  assert.equal(auth.ok, true);
  if (auth.ok) {
    assert.equal(auth.source, "vault_refresh_token");
    assert.equal(auth.accessToken, "ya29.freshly-refreshed-token");
  }

  // 2) Calling gmailReadMessages with {} defaults to maxResults=10 & q=in:inbox
  let capturedListUrl = "";
  const okTools = createGoogleConnectorTools({
    userId: "owner-1",
    vaultStore: vault,
    fetchImpl: ((input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "ya29.freshly-refreshed-token" }),
            { status: 200 }
          )
        );
      }
      if (url.includes("/gmail/v1/users/me/messages?")) {
        capturedListUrl = url;
        return Promise.resolve(
          new Response(JSON.stringify({ messages: [] }), { status: 200 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch,
  });

  const inboxRes = await (okTools.gmailReadMessages as any).execute(
    {},
    { toolCallId: "gm-default", messages: [] }
  );
  assert.equal(inboxRes.status, "ok");
  const parsedUrl = new URL(capturedListUrl);
  assert.equal(parsedUrl.searchParams.get("maxResults"), "10");
  assert.equal(parsedUrl.searchParams.get("q"), "in:inbox");

  // 3) Expired token (HTTP 401) or missing gmail.readonly scope (HTTP 403) returns reconnect_required (triggers Connect/Reconnect card, never raw error JSON)
  for (const statusCode of [401, 403] as const) {
    const errTools = createGoogleConnectorTools({
      userId: "owner-1",
      vaultStore: vault,
      fetchImpl: ((input) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "ya29.missing-scope-token" }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: statusCode,
                message: "Insufficient Permission",
              },
            }),
            { status: statusCode }
          )
        );
      }) as typeof fetch,
    });

    const out = await (errTools.gmailReadMessages as any).execute(
      {},
      { toolCallId: `gm-${statusCode}`, messages: [] }
    );
    assert.equal(out.status, "reconnect_required");
    assert.equal(out.connectProvider, "google");
    assert.equal(isSetupRequiredOutput(out), true);
    assert.doesNotMatch(out.message, /Gmail message list failed|\{/);
  }
});
