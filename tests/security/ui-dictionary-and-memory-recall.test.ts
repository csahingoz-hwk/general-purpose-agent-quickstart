import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectActiveTools,
  shouldOfferWebSearch,
} from "../../lib/ai/context/select-tools";
import { buildGroupedMemoryPromptBlock } from "../../lib/memory/bulk-import";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import type { ChatMessage } from "../../lib/types";
import {
  getCopy,
  uiCopy,
  validateBilingualDictionary,
} from "../../lib/ui-copy";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

test("Item 2: EN/TR UI dictionary has 100% key parity and validator flags missing or empty keys", () => {
  const report = validateBilingualDictionary(
    uiCopy.en as unknown as Record<string, unknown>,
    uiCopy.tr as unknown as Record<string, unknown>
  );
  assert.deepEqual(report.missingInTr, [], "Missing TR keys in uiCopy");
  assert.deepEqual(report.missingInEn, [], "Extra TR keys missing in EN");
  assert.deepEqual(report.emptyInEn, [], "Empty EN values in uiCopy");
  assert.deepEqual(report.emptyInTr, [], "Empty TR values in uiCopy");
  assert.deepEqual(
    report.lengthMismatchKeys,
    [],
    "Array length mismatch between EN and TR"
  );

  // Verify getCopy returns distinct localized copy for EN vs TR
  assert.equal(getCopy("en").save, "Save");
  assert.equal(getCopy("tr").save, "Kaydet");
  assert.equal(getCopy("en").alwaysAllow, "Always allow");
  assert.equal(getCopy("tr").alwaysAllow, "Her zaman izin ver");
  assert.equal(getCopy("en").neverAllow, "Never allow");
  assert.equal(getCopy("tr").neverAllow, "Asla izin verme");
  assert.equal(getCopy("en").screenHandoffImHere, "I'm here");
  assert.equal(getCopy("tr").screenHandoffImHere, "Buradayım");

  // Negative check: validator catches missing keys, empty strings, and array mismatches
  const broken = validateBilingualDictionary(
    {
      hello: "Hello",
      onlyInEn: "Missing in TR",
      items: ["a", "b"],
    },
    {
      hello: "   ",
      onlyInTr: "Yalnızca Türkçe",
      items: ["a"],
    }
  );
  assert.deepEqual(broken.missingInTr, ["onlyInEn"]);
  assert.deepEqual(broken.missingInEn, ["onlyInTr"]);
  assert.deepEqual(broken.emptyInTr, ["hello"]);
  assert.deepEqual(broken.lengthMismatchKeys, ["items"]);
});

test("Item 1: Memory auto-recall loads relevant profile facts (including Turkish agglutinative stems & bilingual matches) and journal notes into every turn", async () => {
  const store = createInMemoryMemoryStore();
  const userId = "owner-recall-1";

  // Unpinned searchable facts + pinned rule + journal note
  await store.upsertProfileFact({
    userId,
    category: "rules",
    key: "concise_replies",
    value: "Keep replies concise and direct.",
    pinned: true,
  });
  await store.upsertProfileFact({
    userId,
    category: "about_me",
    key: "coffee_order",
    value: "Drinks black filter coffee without milk or sugar.",
    pinned: false,
  });
  await store.upsertProfileFact({
    userId,
    category: "family",
    key: "sister_birthday",
    value: "Sister's birthday is March 3.",
    pinned: false,
  });
  await store.addJournalEntry({
    userId,
    title: "Sabah kahve notu",
    body: "V60 filtre kahveyi Etiyopya çekirdeğiyle demledim.",
    tags: ["kahve", "sabah"],
  });

  const [facts, journalEntries] = await Promise.all([
    store.listProfileFacts({ userId }),
    store.listJournalEntries({ userId, limit: 25 }),
  ]);

  // Turkish agglutinative prompt ("kahvemi nasıl içtiğimi hatırlıyor musun?")
  // matches BOTH the English unpinned coffee fact AND the Turkish journal note!
  const blockTr = buildGroupedMemoryPromptBlock(
    facts,
    "kahvemi nasıl içtiğimi hatırlıyor musun?",
    { journalEntries }
  );
  assert.match(blockTr, /Keep replies concise and direct\./);
  assert.match(
    blockTr,
    /Drinks black filter coffee without milk or sugar\./,
    "Should auto-recall unpinned English coffee fact on Turkish query"
  );
  assert.match(
    blockTr,
    /Sabah kahve notu: V60 filtre kahveyi Etiyopya çekirdeğiyle demledim\./,
    "Should auto-recall matching journal note into prompt block"
  );
});

test("Item 1: Self-questions ('kahvemi nasıl içtiğimi hatırlıyor musun?', 'how do I like my coffee?') always offer memory tools and never route to webSearch", () => {
  const selfPrompts = [
    "kahvemi nasıl içtiğimi hatırlıyor musun?",
    "kahvemi nasıl içerim?",
    "how do I drink my coffee?",
    "what is my favorite coffee?",
    "when is my sister's birthday?",
    "kardeşimin doğum günü ne zaman?",
    "alerjim var mı?",
    "do I have any allergies?",
    "tercihlerim neler?",
    "hakkımda ne biliyorsun?",
  ];

  for (const prompt of selfPrompts) {
    const normalized = prompt.toLowerCase();
    assert.equal(
      shouldOfferWebSearch(normalized, true),
      false,
      `webSearch must NOT be offered on personal question: ${prompt}`
    );
    const tools = selectActiveTools([userTurn(prompt)], true, true);
    assert.ok(
      tools.includes("recallMemories"),
      `recallMemories must be available on: ${prompt}`
    );
    assert.ok(
      tools.includes("saveProfileFact"),
      `saveProfileFact must be available on: ${prompt}`
    );
    assert.ok(
      tools.includes("addJournalEntry"),
      `addJournalEntry must be available on: ${prompt}`
    );
    assert.ok(
      !tools.includes("webSearch"),
      `webSearch must be excluded on: ${prompt}`
    );
  }
});
