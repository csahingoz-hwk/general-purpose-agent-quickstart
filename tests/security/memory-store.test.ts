import assert from "node:assert/strict";
import { test } from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { createMemoryTools } from "../../lib/ai/tools/memory-tools";
import {
  createInMemoryMemoryStore,
  isMemoryToolsEnabled,
} from "../../lib/memory/store";
import type { ChatMessage } from "../../lib/types";

const userMsg = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

test("profile facts upsert by key, enforce sharedAcrossBots filter, and isolate users", async () => {
  const store = createInMemoryMemoryStore();
  await store.upsertProfileFact({
    userId: "u1",
    category: "finance",
    key: "Reporting Currency",
    value: "USD",
    sharedAcrossBots: true,
  });
  await store.upsertProfileFact({
    userId: "u1",
    category: "finance",
    key: "reporting_currency",
    value: "GBP & USD",
    sharedAcrossBots: true,
  });
  await store.upsertProfileFact({
    userId: "u1",
    category: "project",
    key: "private_bot_note",
    value: "Local bot only",
    sharedAcrossBots: false,
  });
  await store.upsertProfileFact({
    userId: "u2",
    category: "identity",
    key: "reporting_currency",
    value: "EUR",
  });

  const allU1 = await store.listProfileFacts({ userId: "u1" });
  assert.equal(allU1.length, 2);
  assert.equal(
    allU1.find((f) => f.key === "reporting_currency")?.value,
    "GBP & USD"
  );

  const sharedU1 = await store.listProfileFacts({
    userId: "u1",
    sharedOnly: true,
  });
  assert.equal(sharedU1.length, 1);
  assert.equal(sharedU1[0].key, "reporting_currency");
});

test("journal entries support chronological order, keyword/tag search, and memory tools", async () => {
  const store = createInMemoryMemoryStore();
  const tools = createMemoryTools({ userId: "owner-1", store });

  await (tools.saveProfileFact as any).execute(
    {
      category: "work",
      key: "close_deadline",
      value: "WD5 17:00 London",
      sharedAcrossBots: true,
    },
    { toolCallId: "m1", messages: [] }
  );

  await (tools.addJournalEntry as any).execute(
    {
      title: "SA90 EOSB reconciliation",
      body: "Aligned GL 239300 headcount rollforward with HR.",
      tags: ["ksa", "close"],
    },
    { toolCallId: "m2", messages: [] }
  );
  await (tools.addJournalEntry as any).execute(
    {
      title: "Vibecoding UI polish",
      body: "Verified 44px mobile touch targets on Safari.",
      tags: ["ui"],
    },
    { toolCallId: "m3", messages: [] }
  );

  const recalled = await (tools.recallMemories as any).execute(
    { query: "EOSB", tag: "ksa", limit: 5 },
    { toolCallId: "m4", messages: [] }
  );
  assert.equal(recalled.journalEntries.length, 1);
  assert.equal(recalled.journalEntries[0].title, "SA90 EOSB reconciliation");
});

test("memory tools stay off by default and never coexist with webSearch when enabled", () => {
  const prev = process.env.MEMORY_TOOLS_ENABLED;
  try {
    Reflect.deleteProperty(process.env, "MEMORY_TOOLS_ENABLED");
    assert.equal(isMemoryToolsEnabled(), false);
    assert.deepEqual(
      selectActiveTools([userMsg("Save to my profile that I use GBP")], true),
      []
    );

    process.env.MEMORY_TOOLS_ENABLED = "true";
    assert.deepEqual(
      selectActiveTools([userMsg("Save to my profile that I use GBP")], true),
      ["saveProfileFact"]
    );
    assert.deepEqual(
      selectActiveTools(
        [userMsg("Search the web for GBP rates and save to my profile")],
        true,
        true
      ),
      ["webSearch"]
    );
  } finally {
    if (prev === undefined) {
      Reflect.deleteProperty(process.env, "MEMORY_TOOLS_ENABLED");
    } else {
      process.env.MEMORY_TOOLS_ENABLED = prev;
    }
  }
});
