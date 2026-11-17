import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoKornFerryDataForGoogle } from "../../lib/ai/vertex-model";
import {
  buildGroupedMemoryPromptBlock,
  classifyKornFerryMemoryFact,
  formatMemorySourceLabel,
  isAllowedShortKornFerryContextFact,
} from "../../lib/memory/bulk-import";
import {
  mergeMemoryExports,
  type VertexMergeRunner,
} from "../../lib/memory/multi-source-merge";
import {
  createInMemoryMemoryStore,
  SensitiveMemoryBlockedError,
} from "../../lib/memory/store";

test("Korn Ferry memory governance: allows short job-title/region context lines only and blocks all KF financials, codes, SOX, EOSB, SA90, and documents", async () => {
  // Allowed short role/region context lines (EN + TR)
  assert.equal(
    isAllowedShortKornFerryContextFact(
      "Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, Qatar, and Turkey."
    ),
    true
  );
  assert.equal(
    isAllowedShortKornFerryContextFact(
      "Korn Ferry'de MENA Bölge Finans Direktörü olarak çalışıyor."
    ),
    true
  );

  // Blocked KF accounting, numbers, controls, clients, and non-role lines
  for (const blocked of [
    "Summarize Korn Ferry SA90 EOSB accrual",
    "Review Korn Ferry SA90 EOSB accrual GL 239300",
    "Korn Ferry Q4 MENA revenue was $14.2M across client engagements.",
    "Korn Ferry SOX control FIN-04 requires monthly SAP sign-off.",
    "Hay Group Saudi Arabia (SA90) EOSB provision formula.",
    "Korn Ferry close numbers",
    "Korn Ferry batch OCR",
  ]) {
    assert.equal(isAllowedShortKornFerryContextFact(blocked), false, blocked);
    assert.equal(
      classifyKornFerryMemoryFact(blocked).kind,
      "blocked_kf_data",
      blocked
    );
  }

  // Compound statement keeps ONLY the short role/region clause and flags the restricted clause
  const partial = classifyKornFerryMemoryFact(
    "Works as MENA Finance Controller at Korn Ferry covering UAE and KSA; reconciles SA90 GL 239300 EOSB accruals."
  );
  assert.equal(partial.kind, "partial_short_context");
  if (partial.kind === "partial_short_context") {
    assert.match(partial.fact, /MENA Finance Controller at Korn Ferry/);
    assert.ok(!/SA90|239300|EOSB/i.test(partial.fact));
  }

  // MemoryStore enforces the same rule on durable ProfileFacts
  const store = createInMemoryMemoryStore();
  const savedShort = await store.upsertProfileFact({
    userId: "owner-1",
    category: "work",
    key: "kf_role",
    value:
      "Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, and Turkey.",
    source: "claude",
  });
  assert.equal(savedShort.category, "work");

  await assert.rejects(
    () =>
      store.upsertProfileFact({
        userId: "owner-1",
        category: "work",
        key: "kf_secret",
        value: "Korn Ferry SA90 EOSB GL 239300 balance is SAR 1,240,000.",
      }),
    (err: unknown) =>
      err instanceof SensitiveMemoryBlockedError &&
      err.reason === "korn_ferry_data"
  );

  // Vertex firewall permits ONLY validated short KF role/region bullets inside Owner durable memory in `system`
  const allFacts = await store.listProfileFacts({ userId: "owner-1" });
  const memoryBlock = buildGroupedMemoryPromptBlock(allFacts, "work role");
  assert.doesNotThrow(() =>
    assertNoKornFerryDataForGoogle([
      { role: "system", content: `You are helpful.\n\n${memoryBlock}` },
      {
        role: "user",
        content: [{ type: "text", text: "What is the weather in London?" }],
      },
    ])
  );

  // Tampered system prompt with restricted KF data STILL throws `model_work_boundary`
  assert.throws(
    () =>
      assertNoKornFerryDataForGoogle([
        {
          role: "system",
          content: `${memoryBlock}\n- Korn Ferry SA90 EOSB accrual GL 239300.`,
        },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ]),
    /model_work_boundary/
  );

  // Any `user` message mentioning Korn Ferry STILL throws `model_work_boundary`
  assert.throws(
    () =>
      assertNoKornFerryDataForGoogle([
        { role: "system", content: "You are helpful." },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Works as MENA Finance Controller at Korn Ferry.",
            },
          ],
        },
      ]),
    /model_work_boundary/
  );
});

test("Multi-source merge across ChatGPT (JSON), Claude (MD), Gemini (TR/EN), and Grok Bot: normalizes to 1 sentence, merges duplicates, flags conflicts keeping newest, skips sensitive + KF data, and sends zero KF bytes to Vertex", async () => {
  const store = createInMemoryMemoryStore();
  const staleTierFact = await store.upsertProfileFact({
    userId: "owner-1",
    category: "projects",
    key: "ai_subscription_tier",
    value: "Uses Google AI Plus tier.",
    source: "chat",
    learnedAt: "2025-05-01T00:00:00.000Z",
  });
  const alreadySavedFact = await store.upsertProfileFact({
    userId: "owner-1",
    category: "rules",
    key: "no_pay_per_use",
    value: "Never use pay-per-use API models without asking first.",
    source: "pasted",
    pinned: true,
    learnedAt: "2026-11-10T00:00:00.000Z",
  });

  const existingFacts = await store.listProfileFacts({ userId: "owner-1" });

  let vertexRunnerCalled = false;
  const mockVertexRunner: VertexMergeRunner = ({
    candidates,
    existingFacts: existingForModel,
    preferredModel,
  }) => {
    vertexRunnerCalled = true;
    // With 4 distinct sources, preferredModel must escalate to `gemini-4-argon`
    assert.equal(preferredModel, "gemini-4-argon");

    // ZERO Korn Ferry text or passwords/cards/addresses may ever enter the Vertex prompt payload!
    const serialized = JSON.stringify({ candidates, existingForModel });
    assert.ok(
      !/korn\s*ferry|sa90|eosb|239300|supersecret|4532|baker street/i.test(
        serialized
      ),
      `Restricted or sensitive text leaked into Vertex merge input: ${serialized}`
    );

    const findIdx = (needle: string) => {
      const found = candidates.find((c) =>
        c.text.toLowerCase().includes(needle.toLowerCase())
      );
      assert.ok(found, `Expected candidate containing "${needle}"`);
      return found.idx;
    };

    const idxChatGptLondon = findIdx("lives in london");
    const idxGeminiLondonTr = findIdx("londra'da yaşıyor");
    const idxChatGptOldTier = findIdx("google ai pro");
    const idxClaudeNewTier = findIdx("google ai ultra");
    const idxGeminiCoffee = findIdx("şekersiz");
    const idxGrokRule = findIdx("pay-per-use api models");
    const idxGrokEce = findIdx("gcse history");

    return Promise.resolve({
      modelUsed: "gemini-4-argon",
      payload: {
        items: [
          {
            status: "merged",
            fact: "Lives in London in the Europe/London timezone.",
            category: "about_me",
            candidateIndices: [idxChatGptLondon, idxGeminiLondonTr],
            existingFactId: null,
          },
          {
            status: "conflict",
            fact: "Subscribes to Google AI Ultra with a $40/month Cloud credit.",
            category: "projects",
            candidateIndices: [idxClaudeNewTier, idxChatGptOldTier],
            existingFactId: staleTierFact.id,
            conflictTopic: "Google AI subscription tier",
            conflictOptions: [
              {
                fact: "Subscribes to Google AI Ultra with a $40/month Cloud credit.",
                candidateIndex: idxClaudeNewTier,
                isNewest: true,
              },
              {
                fact: "Subscribes to Google AI Pro tier.",
                candidateIndex: idxChatGptOldTier,
                isNewest: false,
              },
            ],
          },
          {
            status: "new",
            fact: "Drinks black coffee without sugar.",
            category: "preferences",
            candidateIndices: [idxGeminiCoffee],
          },
          {
            status: "new",
            fact: "Daughter Ece is preparing for Edexcel GCSE History.",
            category: "family",
            candidateIndices: [idxGrokEce],
          },
          {
            status: "already_saved",
            fact: "Never use pay-per-use API models without asking first.",
            category: "rules",
            candidateIndices: [idxGrokRule],
            existingFactId: alreadySavedFact.id,
          },
        ],
      },
    });
  };

  const result = await mergeMemoryExports({
    existingFacts,
    runner: mockVertexRunner,
    sources: [
      {
        source: "chatgpt",
        exportedAt: "2025-09-15",
        rawText: JSON.stringify([
          {
            memory: "User lives in London",
            updated_at: "2025-09-10T10:00:00Z",
          },
          {
            memory: "Uses Google AI Pro tier",
            updated_at: "2025-09-12T10:00:00Z",
          },
          {
            memory: "Home WiFi password is SuperSecretPassword99!",
            updated_at: "2025-09-12T10:00:00Z",
          },
          {
            memory:
              "Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, and Turkey",
            updated_at: "2025-09-14T10:00:00Z",
          },
        ]),
      },
      {
        source: "claude",
        exportedAt: "2026-11-01",
        rawText: [
          "## Work context",
          "- Korn Ferry'de MENA Finans Kontrolörü olarak çalışıyor.",
          "- Korn Ferry SA90 Hay Group GL 239300 EOSB accrual reconciliation schedule.",
          "## Tech",
          "- [2026-11-01] Subscribes to Google AI Ultra ($40/mo Cloud credit)",
        ].join("\n"),
      },
      {
        source: "gemini",
        exportedAt: "2026-10-20",
        rawText: [
          "- Londra'da yaşıyor (Europe/London saat dilimi)",
          "- Kahvesini sade ve şekersiz içer",
          "- My home address is 221B Baker Street, London NW1 6XE",
        ].join("\n"),
      },
      {
        source: "grok_bot",
        exportedAt: "2026-11-15",
        rawText: [
          "# Personal Assistant Memory Export",
          "Exported: 2026-11-15T12:00:00Z",
          "### Rules",
          "- Never use pay-per-use API models without asking first. _(source: pasted, learned: 2026-11-10, pinned)_",
          "### Family",
          "- Daughter Ece is preparing for Edexcel GCSE History. _(source: chat, learned: 2026-11-14, searchable)_",
        ].join("\n"),
      },
    ],
  });

  assert.equal(vertexRunnerCalled, true);
  assert.equal(result.modelUsed, "gemini-4-argon");

  // Verify exact 4-stat summary counts:
  // - 2 new (coffee preference + Ece GCSE History)
  // - 2 merged (London ChatGPT+Gemini, plus local KF short role ChatGPT+Claude!)
  // - 1 conflict (Google AI Ultra vs Pro)
  // - 3 skipped as sensitive (WiFi password + KF SA90 EOSB data + Baker Street address)
  // - 1 already saved (no pay-per-use rule)
  assert.deepEqual(result.counts, {
    newCount: 2,
    mergedCount: 2,
    conflictCount: 1,
    skippedSensitiveCount: 3,
    alreadySavedCount: 1,
  });

  // Conflicts appear first and pre-select the newest option
  const conflictItem = result.items[0];
  assert.ok(conflictItem);
  assert.equal(conflictItem.status, "conflict");
  assert.equal(conflictItem.checked, true);
  assert.equal(conflictItem.selectedOptionIndex, 0);
  assert.match(conflictItem.value, /Google AI Ultra/);
  assert.equal(conflictItem.replaceFactId, staleTierFact.id);
  assert.equal(conflictItem.conflictOptions?.length, 2);
  assert.equal(conflictItem.conflictOptions?.[0]?.source, "claude");
  assert.equal(conflictItem.conflictOptions?.[1]?.source, "chatgpt");

  // Merged KF short role item combined ChatGPT + Claude locally without touching Vertex
  const kfMerged = result.items.find(
    (i) => i.category === "work" && /Korn Ferry/i.test(i.value)
  );
  assert.ok(kfMerged, "Expected short Korn Ferry role/region context item");
  assert.equal(kfMerged.status, "merged");
  assert.equal(kfMerged.source, "chatgpt+claude");
  assert.equal(
    formatMemorySourceLabel(kfMerged.source, "en"),
    "ChatGPT + Claude"
  );

  // Merged London item combined ChatGPT + Gemini
  const londonMerged = result.items.find((i) =>
    /Europe\/London/i.test(i.value)
  );
  assert.ok(londonMerged);
  assert.equal(londonMerged.status, "merged");
  assert.equal(
    formatMemorySourceLabel(londonMerged.source, "en"),
    "ChatGPT + Gemini"
  );

  // One-tap batch approval saves checked items & replaces superseded staleTierFact in-place!
  const selectedForSave = result.items.filter((i) => i.checked);
  assert.equal(selectedForSave.length, 5); // 2 new + 2 merged + 1 conflict

  const batchRes = await store.upsertProfileFactsBatch({
    userId: "owner-1",
    source: "pasted",
    items: selectedForSave.map((item) => ({
      category: item.category,
      key: item.key,
      value: item.value,
      source: item.source,
      pinned: item.pinned,
      learnedAt: item.learnedAt ?? undefined,
      replaceFactId: item.replaceFactId,
    })),
  });
  assert.equal(batchRes.saved.length, 5);

  const finalFacts = await store.listProfileFacts({ userId: "owner-1" });
  // Total = 1 alreadySavedFact + 1 replaced staleTierFact (updated in place!) + 4 newly inserted = 6!
  assert.equal(finalFacts.length, 6);
  assert.ok(
    !finalFacts.some((f) => /Google AI Plus/i.test(f.value)),
    "Superseded conflicting fact must be replaced in place, not duplicated"
  );
  assert.ok(finalFacts.some((f) => /Google AI Ultra/i.test(f.value)));
  assert.ok(finalFacts.some((f) => f.source === "chatgpt+claude"));
});
