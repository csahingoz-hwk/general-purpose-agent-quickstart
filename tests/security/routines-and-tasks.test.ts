import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRoutinesEnabled,
  ROUTINE_PRESETS,
  validateRoutineInput,
} from "../../lib/cron/routine-presets";
import {
  createInMemoryTaskStore,
  executeDryRunTask,
} from "../../lib/tasks/runner";

test("all built-in routine presets validate cleanly, routines default on for owner, and invalid cron/timezones fail", () => {
  const prev = process.env.ROUTINES_ENABLED;
  try {
    Reflect.deleteProperty(process.env, "ROUTINES_ENABLED");
    assert.equal(isRoutinesEnabled(), true);
    process.env.ROUTINES_ENABLED = "false";
    assert.equal(isRoutinesEnabled(), false);
  } finally {
    if (prev === undefined) {
      Reflect.deleteProperty(process.env, "ROUTINES_ENABLED");
    } else {
      process.env.ROUTINES_ENABLED = prev;
    }
  }
  for (const preset of ROUTINE_PRESETS) {
    const res = validateRoutineInput(preset);
    assert.equal(res.ok, true, preset.id);
    if (res.ok) {
      assert.ok(res.nextRunAt.getTime() > Date.now() - 60_000);
    }
  }

  assert.equal(
    validateRoutineInput({
      cronExpression: "not a cron",
      timezone: "Europe/London",
      prompt: "Hello",
    }).ok,
    false
  );
  assert.equal(
    validateRoutineInput({
      cronExpression: "0 8 * * 1-5",
      timezone: "Mars/Olympus",
      prompt: "Hello",
    }).ok,
    false
  );
  assert.equal(
    validateRoutineInput({
      cronExpression: "0 8 * * 1-5",
      timezone: "",
      prompt: "Hello",
    }).ok,
    false
  );
  assert.equal(
    validateRoutineInput({
      cronExpression: "0 8 * * 1-5",
      prompt: "   ",
    }).ok,
    false
  );
});

test("background task runner transitions, pauses high-risk runs, cancels active runs, and isolates users", async () => {
  const store = createInMemoryTaskStore();

  const mediumTask = await store.enqueueTask({
    userId: "owner-1",
    kind: "routine",
    title: "Morning brief",
    prompt: "Summarize priorities",
    riskLevel: "medium",
  });
  assert.equal(mediumTask.status, "queued");

  const done = await executeDryRunTask({
    store,
    userId: "owner-1",
    taskId: mediumTask.id,
  });
  assert.equal(done?.status, "succeeded");
  assert.ok((done?.steps.length ?? 0) >= 3);

  // Terminal tasks remain succeeded if cancelTask is called later
  const cancelAfterDone = await store.cancelTask({
    userId: "owner-1",
    id: mediumTask.id,
  });
  assert.equal(cancelAfterDone?.status, "succeeded");

  // High-risk task pauses in awaiting_approval and can be cancelled
  const risky = await store.enqueueTask({
    userId: "owner-1",
    kind: "executor",
    title: "External webhook push",
    prompt: "Post close status externally",
    riskLevel: "high",
  });
  const paused = await executeDryRunTask({
    store,
    userId: "owner-1",
    taskId: risky.id,
  });
  assert.equal(paused?.status, "awaiting_approval");

  // Other user cannot view or cancel owner-1's task
  assert.equal(
    await store.getTask({ userId: "other-user", id: risky.id }),
    null
  );
  assert.equal(
    await store.cancelTask({ userId: "other-user", id: risky.id }),
    null
  );

  const cancelled = await store.cancelTask({
    userId: "owner-1",
    id: risky.id,
  });
  assert.equal(cancelled?.status, "cancelled");
  assert.ok(cancelled?.finishedAt !== null);
});
