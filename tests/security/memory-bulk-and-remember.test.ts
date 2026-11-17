import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import {
  buildGroupedMemoryPromptBlock,
  buildMemoriesExportMarkdown,
  deriveFactKey,
  detectSensitiveMemoryContent,
  extractExplicitRememberFact,
  prepareMemoryImportPreview,
} from "../../lib/memory/bulk-import";
import {
  createInMemoryMemoryStore,
  SensitiveMemoryBlockedError,
} from "../../lib/memory/store";
import { buildVoiceSystemInstruction } from "../../lib/voice/live-session";

test("50-line pasted list splits into single-sentence facts across the 6 categories, skips passwords/cards/addresses with warnings, de-duplicates, supports editable categories & pinning, and groups Rules & Preferences first in prompts", async () => {
  const store = createInMemoryMemoryStore();

  // Seed 3 existing memories for owner-1 (from chat and voice) and 1 private memory for owner-2
  await store.upsertProfileFact({
    userId: "owner-1",
    category: "about_me",
    key: deriveFactKey("I live in London (Europe/London)."),
    value: "I live in London (Europe/London).",
    source: "chat",
    pinned: true,
  });
  await store.upsertProfileFact({
    userId: "owner-1",
    category: "preferences",
    key: deriveFactKey("Kahvemi sade ve şekersiz içerim."),
    value: "Kahvemi sade ve şekersiz içerim.",
    source: "voice",
    pinned: true,
  });
  await store.upsertProfileFact({
    userId: "owner-1",
    category: "family",
    key: deriveFactKey("Daughter's name is Ece."),
    value: "Daughter's name is Ece.",
    source: "chat",
    pinned: false,
  });
  await store.upsertProfileFact({
    userId: "owner-2",
    category: "about_me",
    key: deriveFactKey("Owner-2 secret note."),
    value: "Owner-2 secret note.",
    source: "pasted",
  });

  const existingOwner1 = await store.listProfileFacts({ userId: "owner-1" });
  assert.equal(existingOwner1.length, 3);

  // Build a 53-line pasted input:
  // - 3 sensitive lines (password, Visa card number, street/postcode address) -> MUST BE SKIPPED WITH WARNING!
  // - 3 duplicates of existing memories + 1 repeat inside paste -> UNCHECKED BY DEFAULT!
  // - 46 brand-new self-contained facts across Rules, Preferences, About me, Family, Work, Projects!
  const pastedLines: string[] = [
    "# Rules",
    "- Never use pay-per-use API models without asking first",
    "# Sensitive lines that must be blocked",
    "- My WiFi password is SuperSecretPassword123!",
    "- Personal Visa card 4532 0151 1283 0366",
    "- My home address is 221B Baker Street, London NW1 6XE",
    "# Existing & repeated items",
    "- I live in London (Europe/London)",
    "• Daughter's name is Ece",
    "1. Kahvemi sade ve şekersiz içerim",
    "2) Prefer concise comparison tables with clear takeaways",
    "Prefer concise comparison tables with clear takeaways",
    "# Projects",
    "* StreamVault TV runs on a Samsung Tizen TV",
    "* Mac mini connects over standalone Tailscale SSH in tmux",
  ];
  for (let i = 1; i <= 42; i++) {
    pastedLines.push(
      `${i + 2}. Searchable project note #${i}: mobile UI stays crisp at 390px (${i})`
    );
  }

  const preview = prepareMemoryImportPreview(
    pastedLines.join("\n"),
    existingOwner1
  );

  // Verify all 3 sensitive lines were caught & skipped with exact reasons
  assert.equal(preview.skippedSensitive.length, 3);
  assert.deepEqual(
    preview.skippedSensitive.map((s) => s.reason),
    ["password", "card_number", "address"]
  );
  // Card digits are masked in warning preview
  assert.ok(!preview.skippedSensitive[1]?.preview.includes("1283"));

  // Remaining 50 valid candidate lines: 4 duplicates + 46 new pre-checked single-sentence facts
  assert.equal(preview.items.length, 50);
  const selectedNew = preview.items.filter((p) => p.checked);
  const duplicates = preview.items.filter((p) => p.isDuplicate);
  assert.equal(duplicates.length, 4);
  assert.equal(selectedNew.length, 46);
  // Every extracted value is formatted as a self-contained sentence ending with punctuation
  for (const item of selectedNew) {
    assert.match(item.value, /[.!?…]$/);
  }

  // Save batch with source="pasted"
  const batchRes = await store.upsertProfileFactsBatch({
    userId: "owner-1",
    source: "pasted",
    items: selectedNew.map((p) => ({
      category: p.category,
      key: p.key,
      value: p.value,
      pinned: p.pinned,
    })),
  });
  assert.equal(batchRes.saved.length, 46);
  assert.equal(batchRes.saved[0]?.source, "pasted");
  assert.ok(batchRes.saved[0]?.learnedAt);

  // Direct store attempt to save a password, card number, or address fails closed
  await assert.rejects(
    () =>
      store.upsertProfileFact({
        userId: "owner-1",
        category: "about_me",
        key: "bad_pw",
        value: "My password is secret123",
      }),
    SensitiveMemoryBlockedError
  );

  const allOwner1 = await store.listProfileFacts({ userId: "owner-1" });
  assert.equal(allOwner1.length, 49);

  // Verify prompt grouping:
  // 1) Rules & Preferences come FIRST!
  // 2) Pinned facts are ALWAYS included even on an unrelated query ("weather tomorrow")
  // 3) Searchable (`!pinned`) facts are pulled in ONLY when relevant (e.g. "Tizen" or "Ece")!
  const unrelatedPrompt = buildGroupedMemoryPromptBlock(
    allOwner1,
    "What is the weather tomorrow?"
  );
  const rulesIdx = unrelatedPrompt.indexOf("### Rules");
  const prefsIdx = unrelatedPrompt.indexOf("### Preferences");
  const aboutIdx = unrelatedPrompt.indexOf("### About me");
  assert.ok(rulesIdx !== -1 && prefsIdx !== -1 && aboutIdx !== -1);
  assert.ok(
    rulesIdx < prefsIdx && prefsIdx < aboutIdx,
    "Rules and Preferences must appear first in prompt block"
  );
  // Unrelated searchable fact ("Daughter's name is Ece.") is NOT pulled into weather query
  assert.ok(!unrelatedPrompt.includes("Daughter's name is Ece."));

  // Relevant query ("Tell me about Ece and my Tizen project") pulls in matching searchable facts!
  const relevantPrompt = buildGroupedMemoryPromptBlock(
    allOwner1,
    "Help me plan something for Ece and check my Tizen TV project"
  );
  assert.match(relevantPrompt, /### Family\n- Daughter's name is Ece\./);
  assert.match(relevantPrompt, /### Projects[\s\S]*Samsung Tizen TV/);

  // Voice session prompt embeds the grouped block cleanly
  const voicePrompt = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/London",
    groupedMemoryBlock: relevantPrompt,
  });
  assert.match(voicePrompt, /### Rules/);
  assert.match(voicePrompt, /### Preferences/);

  // Export includes source, learned date, and pinned/searchable mode
  const exported = buildMemoriesExportMarkdown(allOwner1);
  assert.match(exported, /Durable Facts \(49\)/);
  assert.match(exported, /source: pasted, learned:/);
  assert.ok(!exported.includes("Owner-2 secret note"));
});

test("'remember this: …' and 'bunu hatırla: …' parse self-contained facts in chat & voice and block passwords, card numbers, and addresses", () => {
  assert.equal(detectSensitiveMemoryContent("I live in London."), null);
  assert.equal(
    detectSensitiveMemoryContent(
      "My home address is 10 Downing Street SW1A 2AA"
    ),
    "address"
  );
  assert.equal(
    detectSensitiveMemoryContent("Card: 4532 0151 1283 0366"),
    "card_number"
  );
  assert.equal(detectSensitiveMemoryContent("Şifrem: gizli12345"), "password");

  const en = extractExplicitRememberFact(
    "Remember this: I prefer aisle seats on flights over 3 hours"
  );
  assert.equal(en?.kind, "ok");
  if (en?.kind === "ok") {
    assert.equal(en.category, "preferences");
    assert.equal(en.pinned, true);
    assert.equal(en.value, "I prefer aisle seats on flights over 3 hours.");
  }

  const tr = extractExplicitRememberFact("Bunu hatırla: Kızımın adı Ece");
  assert.equal(tr?.kind, "ok");
  if (tr?.kind === "ok") {
    assert.equal(tr.category, "family");
    assert.equal(tr.value, "Kızımın adı Ece.");
  }

  const blockedPw = extractExplicitRememberFact(
    "Remember this: my Netflix password is hunter2password"
  );
  assert.deepEqual(blockedPw, {
    kind: "sensitive_blocked",
    reason: "password",
  });

  // Questions never trigger explicit save
  assert.equal(
    extractExplicitRememberFact("Do you remember this: what did I say?"),
    null
  );

  const toolsEn = selectActiveTools(
    [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "Remember this: my shoe size is EU 43" }],
      },
    ],
    true,
    true
  );
  assert.deepEqual(toolsEn, ["saveProfileFact"]);
});
