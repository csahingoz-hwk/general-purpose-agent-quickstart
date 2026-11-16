import assert from "node:assert/strict";
import { test } from "node:test";
import { extractConversationResults } from "../../lib/results-extractor";
import {
  BUILT_IN_SKILLS,
  createInMemorySkillStore,
  extractRequestedSkillSlug,
  formatSkillPromptBlock,
  normalizeSkillSlug,
} from "../../lib/skills/library";
import type { ChatMessage } from "../../lib/types";

test("built-in skills load cleanly, custom skills override by slug per user, and trigger parses /skill:<slug>", async () => {
  assert.ok(BUILT_IN_SKILLS.length >= 4);
  assert.equal(
    normalizeSkillSlug("  SAP Reconciliation #1! "),
    "sap-reconciliation-1"
  );
  assert.equal(
    extractRequestedSkillSlug("Please check /skill:ksa-eosb-audit for 6 years"),
    "ksa-eosb-audit"
  );
  assert.equal(
    extractRequestedSkillSlug("Ordinary chat without a skill"),
    null
  );

  const store = createInMemorySkillStore();
  const saved = await store.upsertSkill({
    userId: "owner-1",
    slug: "Cash Forecast",
    name: "13-Week Cash Forecast",
    description: "Weekly liquidity rollforward",
    instructions: "Build a 13-week receipts vs disbursements table.",
  });
  assert.equal(saved.slug, "cash-forecast");
  assert.equal(saved.builtIn, false);

  const listOwner1 = await store.listSkills("owner-1");
  assert.ok(listOwner1.some((s) => s.slug === "cash-forecast"));

  const listOwner2 = await store.listSkills("owner-2");
  assert.equal(
    listOwner2.some((s) => s.slug === "cash-forecast"),
    false
  );

  const promptBlock = formatSkillPromptBlock(saved);
  assert.match(promptBlock, /Active Skill: 13-Week Cash Forecast/);
});

test("extractConversationResults summarizes rich cards, drafts, and artifacts from assistant turns", () => {
  const messages: ChatMessage[] = [
    {
      id: "m-user",
      role: "user",
      parts: [{ type: "text", text: "Draft email and create doc" }],
    },
    {
      id: "m-asst",
      role: "assistant",
      parts: [
        {
          type: "tool-draftOutboundMessage",
          toolCallId: "t1",
          state: "approval-requested",
          input: {
            channel: "email",
            recipient: "audit@example.test",
            body: "Draft text",
          },
          approval: { id: "a1" },
        } as any,
        {
          type: "tool-createDocument",
          toolCallId: "t2",
          state: "output-available",
          input: { title: "Close Checklist", kind: "sheet" },
          output: { id: "doc-1", title: "Close Checklist", kind: "sheet" },
        } as any,
      ],
    },
  ];

  const results = extractConversationResults(messages);
  assert.equal(results.length, 2);
  assert.equal(results[0].kind, "draft");
  assert.equal(results[1].kind, "document");
  assert.equal(results[1].title, "Close Checklist");
});
