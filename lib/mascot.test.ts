import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AGENT_MASCOT, resolveMascotState } from "./mascot";

test("default mascot is the blue variant", () => {
  assert.equal(DEFAULT_AGENT_MASCOT, "blue");
});

test("mascot state follows send, stream, completion, and errors", () => {
  assert.equal(resolveMascotState("ready", "ready"), "idle");
  assert.equal(resolveMascotState("ready", "submitted"), "thinking");
  assert.equal(resolveMascotState("submitted", "streaming"), "working");
  assert.equal(resolveMascotState("streaming", "ready"), "done");
  assert.equal(resolveMascotState("submitted", "ready"), "done");
  assert.equal(resolveMascotState("submitted", "error"), "idle");
  assert.equal(resolveMascotState("streaming", "error"), "idle");
  assert.equal(resolveMascotState("error", "ready"), "idle");
  assert.equal(resolveMascotState("ready", "error"), "idle");
});
