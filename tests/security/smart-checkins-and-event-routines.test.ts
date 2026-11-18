import assert from "node:assert/strict";
import { test } from "node:test";
import { GOOGLE_VAULT_SECRET_NAMES } from "../../lib/connectors/google-vault-auth";
import {
  createInMemoryCheckInStateStore,
  isSilentCheckInOutput,
  runSmartScheduledCheckIn,
} from "../../lib/cron/smart-checkin";
import {
  createInMemoryEventRoutineStore,
  dispatchNormalizedRoutineEvents,
  EventTriggerRegistry,
  githubEventTriggerAdapter,
  gmailEventTriggerAdapter,
  pollEventTriggeredRoutinesForUser,
  slackEventTriggerAdapter,
} from "../../lib/routines/event-routines";
import { createInMemoryTaskStore } from "../../lib/tasks/runner";
import { createInMemoryVaultStore } from "../../lib/vault/secret-vault";

const SECRET = "test-event-routines-vault-secret-32-chars!!";

test("Item 11: Scheduled check-ins skip when user chatted in last 20m, stay quiet when nothing useful happened, back off after consecutive silent runs, and reset on useful news", async () => {
  const store = createInMemoryCheckInStateStore();
  const scheduleId = "sched-checkin-1";
  const userId = "owner-checkin-1";
  const cronExpression = "0 * * * *"; // hourly
  const timezone = "Europe/London";

  // 1. User chatted 8 minutes ago (< 20 minutes) -> skipped_active_chat, evaluator not called!
  let evaluatorCalls = 0;
  const baseNow = new Date("2026-11-18T10:00:00Z");
  store.setLastUserChatAt(userId, new Date(baseNow.getTime() - 8 * 60 * 1000));

  const skippedActive = await runSmartScheduledCheckIn({
    scheduleId,
    userId,
    cronExpression,
    timezone,
    now: baseNow,
    store,
    evaluate: () => {
      evaluatorCalls += 1;
      return Promise.resolve("Urgent update");
    },
  });
  assert.equal(skippedActive.outcome, "skipped_active_chat");
  assert.equal(skippedActive.notified, false);
  assert.equal(evaluatorCalls, 0);

  // 2. User last chatted 45 minutes ago -> runs; 3 silent runs in a row stay quiet and trigger backoff
  store.setLastUserChatAt(userId, new Date(baseNow.getTime() - 45 * 60 * 1000));
  assert.equal(isSilentCheckInOutput("NO_UPDATE"), true);
  assert.equal(isSilentCheckInOutput("Yeni bir gelişme yok."), true);
  assert.equal(isSilentCheckInOutput("Flight BA245 delayed by 40m."), false);

  let tickTime = baseNow;
  for (let i = 1; i <= 3; i++) {
    const res = await runSmartScheduledCheckIn({
      scheduleId,
      userId,
      cronExpression,
      timezone,
      now: tickTime,
      store,
      evaluate: () => Promise.resolve("Nothing new right now."),
    });
    assert.equal(res.outcome, "silent");
    assert.equal(res.notified, false);
    assert.equal(res.output, null);
    assert.equal(res.state.consecutiveSilentRuns, i);
    tickTime = new Date(tickTime.getTime() + 60 * 60 * 1000);
  }

  const afterThreeSilent = await store.getState(scheduleId);
  assert.equal(afterThreeSilent?.consecutiveSilentRuns, 3);
  assert.equal(
    afterThreeSilent?.backoffMultiplier,
    2,
    "After 3 silent runs, backoff multiplier doubles to 2x"
  );
  assert.ok(afterThreeSilent?.nextEligibleAt !== null);

  // Polling at 1x interval while backed off to 2x skips with 'skipped_backoff'
  const earlyPoll = await runSmartScheduledCheckIn({
    scheduleId,
    userId,
    cronExpression,
    timezone,
    now: new Date(baseNow.getTime() + 2 * 60 * 60 * 1000 + 30 * 60 * 1000),
    store,
    evaluate: () => Promise.resolve("Should not run yet"),
  });
  assert.equal(earlyPoll.outcome, "skipped_backoff");
  assert.equal(earlyPoll.notified, false);

  // 3. Once nextEligibleAt passes and useful news arrives, delivers & resets backoff to 1!
  const afterBackoffWindow = new Date(
    new Date(afterThreeSilent?.nextEligibleAt as string).getTime() + 60_000
  );
  const delivered = await runSmartScheduledCheckIn({
    scheduleId,
    userId,
    cronExpression,
    timezone,
    now: afterBackoffWindow,
    store,
    evaluate: () => Promise.resolve("x.ai sent an API key confirmation email."),
  });
  assert.equal(delivered.outcome, "delivered");
  assert.equal(delivered.notified, true);
  assert.equal(delivered.output, "x.ai sent an API key confirmation email.");
  assert.equal(delivered.state.consecutiveSilentRuns, 0);
  assert.equal(delivered.state.backoffMultiplier, 1);
  assert.equal(delivered.state.nextEligibleAt, null);
});

test("Item 12: Event-triggered routines fire on 'new Gmail email', deduplicate seen IDs, and support extensible Slack/GitHub adapters", async () => {
  const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";
  const eventStore = createInMemoryEventRoutineStore();
  const taskStore = createInMemoryTaskStore();
  const vault = createInMemoryVaultStore(SECRET);

  await vault.upsertSecret({
    userId,
    name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
    provider: "google",
    plaintext: "ya29.test-gmail-trigger-token",
  });

  const registry = new EventTriggerRegistry([
    gmailEventTriggerAdapter,
    githubEventTriggerAdapter,
    slackEventTriggerAdapter,
  ]);
  const catalogSources = registry.listCatalog().map((c) => c.source);
  assert.deepEqual(catalogSources, ["gmail", "github", "slack"]);

  // Create a "new Gmail email" trigger filtered to from:x.ai
  await eventStore.createTrigger({
    userId,
    source: "gmail",
    eventFilter: "from:x.ai",
    title: "Summarize x.ai emails",
    promptTemplate: "Summarize this email and prepare an unsent draft reply.",
  });

  let inboxIds = ["msg-old-1"];
  const mockFetch: typeof fetch = (input) => {
    const url = String(input);
    if (url.includes("/gmail/v1/users/me/messages?")) {
      return Promise.resolve(
        Response.json({
          messages: inboxIds.map((id) => ({ id, threadId: `th-${id}` })),
        })
      );
    }
    if (url.includes("/messages/msg-old-1")) {
      return Promise.resolve(
        Response.json({
          id: "msg-old-1",
          threadId: "th-msg-old-1",
          snippet: "Older message",
          payload: {
            headers: [
              { name: "From", value: "billing@x.ai" },
              { name: "Subject", value: "Old receipt" },
            ],
          },
        })
      );
    }
    if (url.includes("/messages/msg-new-2")) {
      return Promise.resolve(
        Response.json({
          id: "msg-new-2",
          threadId: "th-msg-new-2",
          snippet: "Your API quota was upgraded.",
          payload: {
            headers: [
              { name: "From", value: "team@x.ai" },
              { name: "Subject", value: "Quota Upgraded" },
            ],
          },
        })
      );
    }
    if (url.includes("/messages/msg-other-3")) {
      return Promise.resolve(
        Response.json({
          id: "msg-other-3",
          threadId: "th-msg-other-3",
          snippet: "Weekly digest",
          payload: {
            headers: [
              { name: "From", value: "newsletter@example.org" },
              { name: "Subject", value: "Digest" },
            ],
          },
        })
      );
    }
    return Promise.resolve(Response.json({}));
  };

  // Poll #1: seeds baseline cursor at 'msg-old-1' without backfilling historical inbox
  const poll1 = await pollEventTriggeredRoutinesForUser({
    userId,
    eventStore,
    taskStore,
    vaultStore: vault,
    registry,
    fetchImpl: mockFetch,
  });
  assert.deepEqual(poll1.seededCursors, ["gmail"]);
  assert.equal(poll1.enqueuedTasks.length, 0);

  // Two new emails arrive: one from newsletter@example.org (filtered out) and one from team@x.ai (matches!)
  inboxIds = ["msg-new-2", "msg-other-3", "msg-old-1"];
  const poll2 = await pollEventTriggeredRoutinesForUser({
    userId,
    eventStore,
    taskStore,
    vaultStore: vault,
    registry,
    fetchImpl: mockFetch,
  });
  assert.equal(poll2.enqueuedTasks.length, 1);
  assert.match(poll2.enqueuedTasks[0]?.title ?? "", /\[Event:gmail\]/);
  assert.match(poll2.enqueuedTasks[0]?.prompt ?? "", /Quota Upgraded/);

  // Poll #3 with no newer mail -> 0 duplicate tasks enqueued
  const poll3 = await pollEventTriggeredRoutinesForUser({
    userId,
    eventStore,
    taskStore,
    vaultStore: vault,
    registry,
    fetchImpl: mockFetch,
  });
  assert.equal(poll3.enqueuedTasks.length, 0);

  // Extensibility check: Slack & GitHub adapters parse payloads and dispatch through the exact same pipeline!
  await eventStore.createTrigger({
    userId,
    source: "slack",
    eventFilter: "channel:C123",
    title: "Triage Slack mention",
    promptTemplate: "Draft a concise Slack reply.",
  });
  const slackEvents =
    slackEventTriggerAdapter.parseWebhookPayload?.({
      eventType: "app_mention",
      rawBody: JSON.stringify({
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U999",
          text: "Can someone check the release?",
          event_ts: "1795000123.0001",
        },
      }),
    }) ?? [];
  const slackDispatched = await dispatchNormalizedRoutineEvents({
    userId,
    source: "slack",
    events: slackEvents,
    eventStore,
    taskStore,
    registry,
  });
  assert.equal(slackDispatched.enqueuedTasks.length, 1);
  assert.match(
    slackDispatched.enqueuedTasks[0]?.title ?? "",
    /\[Event:slack\]/
  );
});
