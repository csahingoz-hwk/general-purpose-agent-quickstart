import assert from "node:assert/strict";
import test from "node:test";
import {
  runWorktreeCoderTask,
  validateCoderBranchSpec,
} from "../../lib/subagents/worktree-coder";
import { createInMemoryTaskStore } from "../../lib/tasks/runner";

test("worktree coding subagent blocks protected branches, fails when tests fail, and requires owner approval before git push", async () => {
  // 1. Protected branches and shell metacharacters are rejected
  for (const forbidden of [
    "main",
    "master",
    "feature/openai-premium-model-routing",
    "release/v1",
    "agent/bad;rm -rf /",
    "agent/../etc",
  ]) {
    assert.equal(
      validateCoderBranchSpec(forbidden).valid,
      false,
      `Expected branch "${forbidden}" to be rejected`
    );
  }

  assert.equal(validateCoderBranchSpec("agent/fix-typo").valid, true);
  assert.equal(validateCoderBranchSpec("draft/ui-polish").valid, true);

  const store = createInMemoryTaskStore();

  // 2. Protected branch fails task immediately
  const protectedAttempt = await runWorktreeCoderTask({
    store,
    userId: "owner-1",
    title: "Attempt edit on main",
    prompt: "Update README",
    targetBranch: "main",
  });
  assert.equal(protectedAttempt.status, "failed");

  // 3. Failing test suite aborts task with status === "failed"
  const failingTests = await runWorktreeCoderTask({
    store,
    userId: "owner-1",
    title: "Refactor button",
    prompt: "Adjust padding",
    targetBranch: "agent/refactor-button",
    verifyWorkspace: () =>
      Promise.resolve({
        checkPassed: true,
        testsPassed: false,
        summary: "1 assertion failed in safety-approvals.test.ts",
      }),
  });
  assert.equal(failingTests.status, "failed");
  assert.match(failingTests.error ?? "", /tests=false/);

  // 4. Passing verification with requestPush=true pauses in awaiting_approval before git push
  const pushGated = await runWorktreeCoderTask({
    store,
    userId: "owner-1",
    title: "Add helper test",
    prompt: "Add unit test",
    targetBranch: "draft/add-helper-test",
    requestPush: true,
    verifyWorkspace: () =>
      Promise.resolve({
        checkPassed: true,
        testsPassed: true,
        headCommit: "abc1234",
        summary: "All checks green",
      }),
  });
  assert.equal(pushGated.status, "awaiting_approval");
  assert.match(pushGated.output ?? "", /SHA-256 action digest/);
});
