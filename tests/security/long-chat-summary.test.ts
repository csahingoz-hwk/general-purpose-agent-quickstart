import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEarlierInChatSummary,
  createInMemoryThreadSummaryStore,
  LONG_CHAT_MESSAGE_THRESHOLD,
  syncThreadSummary,
} from "../../lib/ai/context/thread-summary";
import { prepareRetry } from "../../lib/ai/conversation-state";
import type { ChatMessage } from "../../lib/types";

function makeTurnPair(index: number): [ChatMessage, ChatMessage] {
  return [
    {
      id: `u-${index}`,
      role: "user",
      parts: [
        {
          type: "text",
          text: `Step ${index}: Plan trip details for destination #${index} (Lisbon hotel & flights).`,
        },
      ],
    },
    {
      id: `a-${index}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `Confirmed step ${index}: Saved flight timing and boutique hotel options for #${index}.`,
        },
      ],
    },
  ];
}

test("Item 4: Short threads skip summary while long threads persist 'Earlier in this chat' summary across reloads and retries", async () => {
  const store = createInMemoryThreadSummaryStore();
  const chatId = crypto.randomUUID();
  const userId = "owner-summary-1";

  // 4 messages (< threshold) -> no summary created
  const shortMessages = [...makeTurnPair(1), ...makeTurnPair(2)];
  assert.equal(buildEarlierInChatSummary(shortMessages), null);
  const shortSync = await syncThreadSummary({
    chatId,
    userId,
    messages: shortMessages,
    store,
  });
  assert.equal(shortSync.record, null);
  assert.equal(shortSync.promptBlock, "");

  // Build a 12-message thread (>= LONG_CHAT_MESSAGE_THRESHOLD)
  const longMessages: ChatMessage[] = [];
  for (let i = 1; i <= 6; i++) {
    longMessages.push(...makeTurnPair(i));
  }
  assert.ok(longMessages.length >= LONG_CHAT_MESSAGE_THRESHOLD);

  const synced = await syncThreadSummary({
    chatId,
    userId,
    messages: longMessages,
    store,
  });
  assert.ok(synced.record !== null);
  assert.match(synced.promptBlock, /Earlier in this chat/);
  assert.match(synced.record.summaryText, /Step 1: Plan trip details/);
  assert.ok(synced.record.coveredMessageCount >= 6);

  // Simulate reload: reading from store returns persisted summary for this user only
  const reloaded = await store.getSummary({ chatId, userId });
  assert.equal(reloaded?.summaryText, synced.record.summaryText);
  assert.equal(await store.getSummary({ chatId, userId: "other-user" }), null);

  // Simulate interrupted turn + Retry: even if retry trims a trailing failed reply
  // down below threshold on boundary, persisted summary remains available!
  const boundaryThread = longMessages.slice(0, LONG_CHAT_MESSAGE_THRESHOLD);
  const boundarySynced = await syncThreadSummary({
    chatId: "boundary-chat",
    userId,
    messages: boundaryThread,
    store,
  });
  assert.ok(boundarySynced.record !== null);

  const retryInput: ChatMessage[] = [
    ...boundaryThread.slice(0, -1),
    {
      id: "a-interrupted",
      role: "assistant",
      parts: [
        { type: "text", text: "Partial broken text" },
        {
          type: "data-reply-status",
          data: { status: "interrupted", retryable: true },
        },
      ],
    },
  ];
  const lastUserId = boundaryThread.at(-2)?.id as string;
  const retried = prepareRetry(retryInput, lastUserId);
  const afterRetrySync = await syncThreadSummary({
    chatId: "boundary-chat",
    userId,
    messages: retried.messages,
    store,
  });
  assert.ok(afterRetrySync.record !== null);
  assert.match(afterRetrySync.promptBlock, /Earlier in this chat/);
});
