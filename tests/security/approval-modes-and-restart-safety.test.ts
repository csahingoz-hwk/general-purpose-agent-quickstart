import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyApprovalResponses,
  expirePendingApprovalsOnNewUserTurn,
  markMidFlightToolsInterrupted,
  prepareRetry,
} from "../../lib/ai/conversation-state";
import {
  applyOwnerPoliciesToToolSet,
  createInMemoryApprovalPreferencesStore,
  createInMemoryExecutionJournalStore,
} from "../../lib/safety/approval-preferences";
import type { ChatMessage } from "../../lib/types";

test("Item 3: Owner approval mode toggles 'ask_every_time' vs 'draft_without_asking' while keeping outbound sends approval-gated and catching prompt injection", async () => {
  const prefs = createInMemoryApprovalPreferencesStore();
  const userId = "owner-mode-1";
  const chatId = crypto.randomUUID();

  let draftExecCount = 0;
  let sendExecCount = 0;

  const baseTools = {
    gmailCreateDraft: {
      needsApproval: true,
      execute: (input: unknown) => {
        draftExecCount += 1;
        return Promise.resolve({ status: "draft_created_unsent", input });
      },
    },
    draftOutboundMessage: {
      needsApproval: true,
      execute: (input: unknown) => {
        sendExecCount += 1;
        return Promise.resolve({ status: "approved_dry_run", input });
      },
    },
  };

  // Default mode: ask_every_time -> both require approval
  const initialSettings = await prefs.getSettings(userId);
  assert.equal(initialSettings.approvalMode, "ask_every_time");

  const askEveryTimeTools = applyOwnerPoliciesToToolSet(baseTools, {
    userId,
    chatId,
    approvalMode: initialSettings.approvalMode,
    rules: [],
    journalStore: createInMemoryExecutionJournalStore(),
  });
  assert.equal(askEveryTimeTools.gmailCreateDraft.needsApproval, true);
  assert.equal(askEveryTimeTools.draftOutboundMessage.needsApproval, true);

  // Switch to 'draft_without_asking' -> unsent drafts skip gate, outbound send still asks!
  const updated = await prefs.updateSettings({
    userId,
    approvalMode: "draft_without_asking",
  });
  assert.equal(updated.approvalMode, "draft_without_asking");

  const draftFirstTools = applyOwnerPoliciesToToolSet(baseTools, {
    userId,
    chatId,
    approvalMode: updated.approvalMode,
    rules: [],
    journalStore: createInMemoryExecutionJournalStore(),
  });
  assert.equal(draftFirstTools.gmailCreateDraft.needsApproval, false);
  assert.equal(
    draftFirstTools.draftOutboundMessage.needsApproval,
    true,
    "Outbound send must still ask before sending"
  );

  const res = await draftFirstTools.gmailCreateDraft.execute(
    { recipient: "a@example.com", subject: "Hi", body: "Draft text" },
    { toolCallId: "tc-draft-1", messages: [] }
  );
  assert.equal((res as { status: string }).status, "draft_created_unsent");
  assert.equal(draftExecCount, 1);
  assert.equal(sendExecCount, 0);
});

test("Item 5: Per-tool 'Always allow' and 'Never allow' rules override defaults and undo cleanly when deleted", async () => {
  const prefs = createInMemoryApprovalPreferencesStore();
  const userId = "owner-rules-1";
  const chatId = crypto.randomUUID();
  let outboundRuns = 0;

  const baseTools = {
    draftOutboundMessage: {
      needsApproval: true,
      execute: () => {
        outboundRuns += 1;
        return Promise.resolve({ status: "approved_dry_run" });
      },
    },
  };

  // 1. Save 'never_allow' -> tool is blocked without executing
  await prefs.setToolRule({
    userId,
    toolName: "draftOutboundMessage",
    decision: "never_allow",
  });
  let rules = await prefs.listToolRules(userId);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.decision, "never_allow");

  const blockedTools = applyOwnerPoliciesToToolSet(baseTools, {
    userId,
    chatId,
    approvalMode: "ask_every_time",
    rules,
    journalStore: createInMemoryExecutionJournalStore(),
  });
  assert.equal(blockedTools.draftOutboundMessage.needsApproval, false);
  const blockedRes = await blockedTools.draftOutboundMessage.execute(
    { channel: "email", recipient: "x@y.com", body: "Hello" },
    { toolCallId: "tc-never-1", messages: [] }
  );
  assert.equal(
    (blockedRes as { status: string }).status,
    "blocked_by_owner_rule"
  );
  assert.equal(outboundRuns, 0, "Underlying tool must not execute");

  // 2. Update to 'always_allow' -> needsApproval becomes false and executes
  await prefs.setToolRule({
    userId,
    toolName: "draftOutboundMessage",
    decision: "always_allow",
  });
  rules = await prefs.listToolRules(userId);
  const allowedTools = applyOwnerPoliciesToToolSet(baseTools, {
    userId,
    chatId,
    approvalMode: "ask_every_time",
    rules,
    journalStore: createInMemoryExecutionJournalStore(),
  });
  assert.equal(allowedTools.draftOutboundMessage.needsApproval, false);
  const okRes = await allowedTools.draftOutboundMessage.execute(
    { channel: "email", recipient: "x@y.com", body: "Hello" },
    { toolCallId: "tc-always-1", messages: [] }
  );
  assert.equal((okRes as { status: string }).status, "approved_dry_run");
  assert.equal(outboundRuns, 1);

  // 3. Undo rule in Settings -> restores needsApproval: true
  const deleted = await prefs.deleteToolRule({
    userId,
    toolName: "draftOutboundMessage",
  });
  assert.equal(deleted, true);
  rules = await prefs.listToolRules(userId);
  assert.equal(rules.length, 0);

  const restoredTools = applyOwnerPoliciesToToolSet(baseTools, {
    userId,
    chatId,
    approvalMode: "ask_every_time",
    rules,
    journalStore: createInMemoryExecutionJournalStore(),
  });
  assert.equal(restoredTools.draftOutboundMessage.needsApproval, true);
});

test("Item 6: Mid-flight tool calls across a server restart/redeploy are marked interrupted and NEVER replayed twice", async () => {
  const journal = createInMemoryExecutionJournalStore();
  const userId = "owner-restart-1";
  const chatId = crypto.randomUUID();
  let emailActionCalls = 0;

  // Boot #1 starts executing a side-effecting tool call and crashes mid-flight before finishing
  const boot1Begin = await journal.beginExecution({
    userId,
    chatId,
    toolCallId: "call-email-midflight",
    toolName: "gmailCreateDraft",
    digest: "a".repeat(64),
    bootId: "boot-1",
  });
  assert.equal(boot1Begin.allowed, true);
  emailActionCalls += 1; // Side effect started on boot-1 before crash!

  // Server restarts -> Boot #2 comes up! Any attempt to replay 'call-email-midflight' is blocked and marked interrupted
  const boot2Replay = applyOwnerPoliciesToToolSet(
    {
      gmailCreateDraft: {
        needsApproval: true,
        execute: () => {
          emailActionCalls += 1;
          return Promise.resolve({ status: "draft_created_unsent" });
        },
      },
    },
    {
      userId,
      chatId,
      approvalMode: "draft_without_asking",
      rules: [],
      journalStore: journal,
      bootId: "boot-2",
    }
  );

  const replayOutput = await boot2Replay.gmailCreateDraft.execute(
    { recipient: "cfo@example.com", subject: "Report", body: "Body" },
    { toolCallId: "call-email-midflight", messages: [] }
  );
  assert.equal(
    (replayOutput as { status: string }).status,
    "interrupted_on_restart"
  );
  assert.equal(
    emailActionCalls,
    1,
    "Mid-flight email/draft action must NEVER run a second time after restart"
  );
  const storedEntry = await journal.getEntry({
    chatId,
    toolCallId: "call-email-midflight",
  });
  assert.equal(storedEntry?.status, "interrupted");

  // Also verify persisted message history sweep marks mid-flight side-effecting parts interrupted & non-retryable
  const userMsgId = crypto.randomUUID();
  const savedHistory: ChatMessage[] = [
    {
      id: userMsgId,
      role: "user",
      parts: [{ type: "text", text: "Send the draft" }],
    },
    {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "tool-draftOutboundMessage",
          toolCallId: "call-midflight-2",
          state: "approval-responded",
          input: { channel: "email", recipient: "x@y.com", body: "Hi" },
          approval: { id: "ap-1", approved: true },
        } as any,
      ],
    },
  ];

  const swept = markMidFlightToolsInterrupted(savedHistory);
  assert.equal(swept.interruptedMessages.length, 1);
  const part = swept.messages[1]?.parts[0] as any;
  assert.equal(part.state, "output-error");
  assert.match(part.errorText, /NOT replayed/);

  // Retry must refuse to strip/replay the assistant turn with an interrupted write tool
  assert.throws(
    () => prepareRetry(swept.messages, userMsgId),
    /invalid_retry_target/
  );
});

test("Item 7: Sending a new message while an approval is waiting expires that approval and rejects late clicks", () => {
  const assistantId = crypto.randomUUID();
  const waitingMessages: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Draft an email to Sam" }],
    },
    {
      id: assistantId,
      role: "assistant",
      parts: [
        {
          type: "tool-gmailCreateDraft",
          toolCallId: "tc-wait-1",
          state: "approval-requested",
          input: {
            recipient: "sam@example.com",
            subject: "Catch up",
            body: "Hi Sam",
          },
          approval: { id: "appr-wait-1" },
        } as any,
      ],
    },
  ];

  const expired = expirePendingApprovalsOnNewUserTurn(waitingMessages);
  assert.equal(expired.expiredMessages.length, 1);
  const updatedPart = expired.messages[1]?.parts[0] as any;
  assert.equal(updatedPart.state, "output-denied");
  assert.equal(updatedPart.approval.approved, false);
  assert.equal(updatedPart.approval.reason, "expired_by_new_message");

  // Late click on the expired approval card must throw 'approval_expired'
  const lateSubmission: ChatMessage[] = [
    waitingMessages[0] as ChatMessage,
    {
      id: assistantId,
      role: "assistant",
      parts: [
        {
          type: "tool-gmailCreateDraft",
          toolCallId: "tc-wait-1",
          state: "approval-responded",
          approval: { id: "appr-wait-1", approved: true },
        } as any,
      ],
    },
  ];
  assert.throws(
    () => applyApprovalResponses(expired.messages, lateSubmission),
    /approval_expired/
  );
});
