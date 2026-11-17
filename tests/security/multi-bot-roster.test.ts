import assert from "node:assert/strict";
import test from "node:test";
import { systemPrompt } from "../../lib/ai/prompts";
import {
  BUILT_IN_TEAMMATES,
  composeTeammateSoul,
  createInMemoryBotRosterStore,
  extractRequestedBotSlug,
  filterFactsForBot,
} from "../../lib/bots/roster";
import { isMascotVariant } from "../../lib/mascot";
import { createInMemoryMemoryStore } from "../../lib/memory/store";

test("built-in teammates provide valid mascot themes, compose bilingual-safe souls, and support per-owner custom overrides", async () => {
  assert.equal(BUILT_IN_TEAMMATES.length, 3);
  for (const bot of BUILT_IN_TEAMMATES) {
    assert.equal(isMascotVariant(bot.mascotVariant), true);
  }

  assert.equal(
    extractRequestedBotSlug(
      "Please review this variance @bot:finance-controller"
    ),
    "finance-controller"
  );

  const store = createInMemoryBotRosterStore();
  await store.upsertBot({
    userId: "owner-1",
    slug: "tax-specialist",
    name: "UK Tax Reviewer",
    description: "Personal self-assessment helper",
    soul: "Focus on HMRC deadlines and allowances.",
    defaultModel: "gemini-4-argon",
    mascotVariant: "teal",
    skillSlugs: ["variance-commentary"],
  });

  const owner1Bots = await store.listBots("owner-1");
  const owner2Bots = await store.listBots("owner-2");
  assert.equal(owner1Bots.length, 4);
  assert.equal(owner2Bots.length, 3);

  const financeBot = await store.getBotBySlug("owner-1", "finance-controller");
  assert.ok(financeBot);
  const composed = composeTeammateSoul(null, financeBot);
  const prompt = systemPrompt({
    supportsTools: true,
    soul: composed,
    needsOnboarding: false,
  });
  assert.match(prompt, /Role: Finance Controller/);
  assert.match(prompt, /Turkish question gets a natural Turkish answer/);
});

test("sharedAcrossBots=true facts share across teammates while sharedAcrossBots=false stay isolated to originating bot", async () => {
  const mem = createInMemoryMemoryStore();
  await mem.upsertProfileFact({
    userId: "owner-1",
    key: "home_timezone",
    value: "Europe/London",
    sharedAcrossBots: true,
  });
  await mem.upsertProfileFact({
    userId: "owner-1",
    key: "preferred_test_runner",
    value: "node --test",
    sharedAcrossBots: false,
    botSlug: "vibecoder",
  });
  await mem.upsertProfileFact({
    userId: "owner-1",
    key: "materiality_threshold",
    value: "GBP 5,000",
    sharedAcrossBots: false,
    botSlug: "finance-controller",
  });

  const allFacts = await mem.listProfileFacts({ userId: "owner-1" });

  const vibecoderVisible = filterFactsForBot(allFacts, "vibecoder");
  assert.deepEqual(vibecoderVisible.map((f) => f.key).sort(), [
    "home_timezone",
    "preferred_test_runner",
  ]);

  const financeVisible = filterFactsForBot(allFacts, "finance-controller");
  assert.deepEqual(financeVisible.map((f) => f.key).sort(), [
    "home_timezone",
    "materiality_threshold",
  ]);
});
