import assert from "node:assert/strict";
import { test } from "node:test";
import { createFictionalInbox } from "../../lib/ai/tools/demo-inbox";

test("fictional inbox contains 12 clearly synthetic, stable messages", () => {
  const result = createFictionalInbox("tr");

  assert.equal(result.kind, "fictional-inbox");
  assert.equal(result.fixtureId, "inbox-demo-v1");
  assert.equal(result.language, "tr");
  assert.match(result.disclaimer, /Fictional sample data/);
  assert.equal(result.messages.length, 12);
  assert.equal(new Set(result.messages.map((item) => item.id)).size, 12);

  for (const message of result.messages) {
    assert.match(message.sender, /^[^@]+@example\.test$/);
    assert.ok(message.priority >= 1 && message.priority <= 5);
  }

  assert.equal(
    result.messages.filter((message) => message.priority >= 3).length,
    7
  );
  assert.equal(
    result.messages.filter((message) => message.priority >= 5).length,
    2
  );
});

test("each demo call returns a copy and cannot mutate future results", () => {
  const first = createFictionalInbox();
  first.messages[0].subject = "changed by test";
  const second = createFictionalInbox();

  assert.equal(second.messages[0].subject, "Project milestone review");
  assert.equal(second.language, "en");
});
