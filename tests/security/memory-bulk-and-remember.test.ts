import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import {
  buildMemoriesExportMarkdown,
  deriveFactKey,
  extractExplicitRememberFact,
  prepareMemoryImportPreview,
  selectRelevantFactsForPrompt,
  splitPastedMemoryList,
} from "../../lib/memory/bulk-import";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import { buildVoiceSystemInstruction } from "../../lib/voice/live-session";

test("50-line pasted list splits bullets, numbered items, headings, and paragraphs, de-duplicates against existing memories, and avoids key collisions", async () => {
  const store = createInMemoryMemoryStore();

  // Seed 3 existing memories for owner-1 and 1 private memory for owner-2
  await store.upsertProfileFact({
    userId: "owner-1",
    category: "identity",
    key: deriveFactKey("I live in London (Europe/London)"),
    value: "I live in London (Europe/London)",
  });
  await store.upsertProfileFact({
    userId: "owner-1",
    category: "preference",
    key: deriveFactKey("Kahvemi sade ve şekersiz içerim"),
    value: "Kahvemi sade ve şekersiz içerim",
  });
  await store.upsertProfileFact({
    userId: "owner-1",
    category: "identity",
    key: deriveFactKey("Daughter's name is Ece"),
    value: "Daughter's name is Ece",
  });
  await store.upsertProfileFact({
    userId: "owner-2",
    category: "general",
    key: deriveFactKey("Owner-2 secret note"),
    value: "Owner-2 secret note",
  });

  const existingOwner1 = await store.listProfileFacts({ userId: "owner-1" });
  assert.equal(existingOwner1.length, 3);

  // Build a 50-fact pasted list (3 duplicates of existing + 1 repeat within paste + 46 brand-new facts,
  // including two facts sharing identical first 55 characters to prove zero key collisions!)
  const pastedLines: string[] = [
    "# Identity & Family",
    "- I live in London (Europe/London).", // duplicate of existing (#1)
    "• Daughter's name is Ece", // duplicate of existing (#2)
    "1. Kahvemi sade ve şekersiz içerim!", // duplicate of existing (#3)
    "2) Prefer concise comparison tables with clear takeaways",
    "Prefer concise comparison tables with clear takeaways", // repeat inside paste (#4)
    "# Preferences",
    "* When reviewing monthly numbers, always highlight variances above 5% first",
    "* When reviewing monthly numbers, always highlight cash flow timing second",
  ];
  for (let i = 1; i <= 43; i++) {
    pastedLines.push(
      `${i + 2}. Personal memory item #${i}: keep mobile cards clean at 390px viewport (${i})`
    );
  }

  const rawPaste = pastedLines.join("\n");
  const splitOnly = splitPastedMemoryList(rawPaste);
  assert.equal(splitOnly.length, 50, "Expected headings stripped and 50 facts");

  const preview = prepareMemoryImportPreview(rawPaste, existingOwner1);
  assert.equal(preview.length, 50);

  const selectedNew = preview.filter((p) => p.checked);
  const duplicates = preview.filter((p) => p.isDuplicate);
  assert.equal(duplicates.length, 4, "3 existing + 1 repeat in paste");
  assert.equal(selectedNew.length, 46, "46 genuinely new facts pre-checked");

  // Save selected batch for owner-1
  const batchRes = await store.upsertProfileFactsBatch({
    userId: "owner-1",
    items: selectedNew.map((p) => ({
      category: p.category,
      key: p.key,
      value: p.value,
    })),
  });
  assert.equal(batchRes.saved.length, 46);
  assert.equal(batchRes.skippedDuplicates, 0);

  const allOwner1After = await store.listProfileFacts({ userId: "owner-1" });
  assert.equal(
    allOwner1After.length,
    49,
    "3 existing + 46 new = 49 distinct persisted facts (zero collisions)"
  );

  // Verify inline edit updates value in place without changing total count or leaking across owners
  const targetToEdit = allOwner1After.find((f) =>
    f.value.includes("Personal memory item #10:")
  );
  assert.ok(targetToEdit);
  const edited = await store.updateProfileFact({
    userId: "owner-1",
    id: targetToEdit.id,
    category: "project",
    value: "Updated memory item #10: verified inline edit in Postgres store",
  });
  assert.ok(edited);
  assert.equal(edited.category, "project");
  assert.match(edited.value, /verified inline edit/);

  // Cross-owner edit attempt fails closed
  const crossEdit = await store.updateProfileFact({
    userId: "owner-2",
    id: targetToEdit.id,
    value: "Attempted overwrite",
  });
  assert.equal(crossEdit, null);

  // Export markdown includes all 49 facts cleanly
  const finalOwner1 = await store.listProfileFacts({ userId: "owner-1" });
  const exported = buildMemoriesExportMarkdown(finalOwner1);
  assert.match(exported, /Saved Memories \(49\)/);
  assert.match(exported, /verified inline edit/);
  assert.ok(!exported.includes("Owner-2 secret note"));

  // Every chat and voice session prompt receives up to 80 memories (all 49 included!)
  const promptFacts = selectRelevantFactsForPrompt(
    finalOwner1,
    "What should you keep in mind about mobile cards?",
    80,
    6000
  );
  assert.equal(promptFacts.length, 49);

  const voicePrompt = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/London",
    facts: promptFacts.map((f) => `[${f.category}] ${f.value}`),
  });
  assert.match(voicePrompt, /verified inline edit/);
  assert.match(voicePrompt, /Daughter's name is Ece/);
});

test("'remember this: …' and 'bunu hatırla: …' work in chat and voice without false positives on questions", () => {
  const en = extractExplicitRememberFact(
    "Remember this: I prefer aisle seats on flights over 3 hours."
  );
  assert.ok(en);
  assert.equal(en.category, "preference");
  assert.equal(en.value, "I prefer aisle seats on flights over 3 hours.");

  const tr = extractExplicitRememberFact(
    "Bunu hatırla: Kızımın GCSE tarih sınavı Edexcel müfredatında."
  );
  assert.ok(tr);
  assert.equal(tr.category, "identity");
  assert.match(tr.value, /Edexcel/);

  // Questions must NOT be treated as explicit save directives
  assert.equal(
    extractExplicitRememberFact("Do you remember this: what did I say?"),
    null
  );

  // selectActiveTools enables saveProfileFact (and never paid webSearch) for remember directives
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

  const toolsTr = selectActiveTools(
    [
      {
        id: "m2",
        role: "user",
        parts: [{ type: "text", text: "Bunu hatırla: çayı şekersiz içerim" }],
      },
    ],
    true,
    true
  );
  assert.deepEqual(toolsTr, ["saveProfileFact"]);
});
