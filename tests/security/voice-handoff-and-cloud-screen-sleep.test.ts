import assert from "node:assert/strict";
import { test } from "node:test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { Session } from "next-auth";
import { systemPrompt } from "../../lib/ai/prompts";
import { createCloudComputerTools } from "../../lib/ai/tools/cloud-computer";
import { createInMemoryCloudLifecycleStore } from "../../lib/cloud-computer/lifecycle";
import {
  detectScreenHandoffChallenge,
  getScreenHandoffDecision,
  isScreenHandoffPayload,
  recordScreenHandoffDecision,
} from "../../lib/cloud-computer/screen-handoff";
import { GOOGLE_VAULT_SECRET_NAMES } from "../../lib/connectors/google-vault-auth";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import {
  createInMemoryApprovalPreferencesStore,
  createInMemoryExecutionJournalStore,
} from "../../lib/safety/approval-preferences";
import { createInMemoryVaultStore } from "../../lib/vault/secret-vault";
import { LIVE_VOICE_TOOL_DECLARATIONS } from "../../lib/voice/live-protocol";
import { executeVoiceTextAgentHandoff } from "../../lib/voice/text-agent-handoff";

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 200, noCache: 200, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 },
};

const fakeSession: Session = {
  expires: new Date(Date.now() + 3_600_000).toISOString(),
  user: {
    id: "97a9a7c5-e220-425d-9589-7e63b607ca75",
    email: "owner@example.test",
    type: "regular",
  },
};

const SECRET = "test-cloud-computer-hmac-secret-32-chars-long";

test("Item 8: Voice calls expose handOffToTextAgent and delegate inbox + draft + calendar work to the shared text agent, speaking the result", async () => {
  assert.ok(
    LIVE_VOICE_TOOL_DECLARATIONS.some((t) => t.name === "handOffToTextAgent"),
    "LIVE_VOICE_TOOL_DECLARATIONS must expose handOffToTextAgent"
  );

  const vault = createInMemoryVaultStore(SECRET);
  await vault.upsertSecret({
    userId: fakeSession.user.id,
    name: GOOGLE_VAULT_SECRET_NAMES.accessToken,
    provider: "google",
    plaintext: "ya29.test-owner-token",
  });

  const mockFetch: typeof fetch = (input) => {
    const url = String(input);
    if (url.includes("/gmail/v1/users/me/messages?")) {
      return Promise.resolve(
        Response.json({ messages: [{ id: "m-xai-1", threadId: "th-1" }] })
      );
    }
    if (url.includes("/gmail/v1/users/me/messages/m-xai-1")) {
      return Promise.resolve(
        Response.json({
          id: "m-xai-1",
          threadId: "th-1",
          snippet: "Welcome to x.ai API",
          payload: {
            headers: [
              { name: "From", value: "xAI Team <support@x.ai>" },
              { name: "Subject", value: "API Access Ready" },
              { name: "Date", value: "Wed, 18 Nov 2026 10:00:00 +0000" },
            ],
          },
        })
      );
    }
    return Promise.resolve(Response.json({ id: "d-1" }));
  };

  let stepIdx = 0;
  const mockModel = new MockLanguageModelV4({
    doGenerate: () => {
      stepIdx += 1;
      if (stepIdx === 1) {
        return Promise.resolve({
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-read-1",
              toolName: "gmailReadMessages",
              input: JSON.stringify({ query: "from:x.ai", maxResults: 3 }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
          warnings: [],
        });
      }
      if (stepIdx === 2) {
        return Promise.resolve({
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-draft-1",
              toolName: "gmailCreateDraft",
              input: JSON.stringify({
                recipient: "support@x.ai",
                subject: "Re: API Access Ready",
                body: "Teşekkürler, erişimi aldım.",
              }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
          warnings: [],
        });
      }
      return Promise.resolve({
        content: [
          {
            type: "text" as const,
            text: "**x.ai** ekibinden gelen son e-postayı buldum ve cevap taslağı kartını sohbete ekledim.",
          },
        ],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      });
    },
  });

  const res = await executeVoiceTextAgentHandoff({
    session: fakeSession,
    userId: fakeSession.user.id,
    chatId: crypto.randomUUID(),
    request: "x.ai'den gelen son emaili bulup cevap taslağı oluşturur musun?",
    locale: "tr",
    vaultStore: vault,
    memoryStore: createInMemoryMemoryStore(),
    approvalPrefsStore: createInMemoryApprovalPreferencesStore(),
    journalStore: createInMemoryExecutionJournalStore(),
    fetchImpl: mockFetch,
    modelOverride: mockModel,
  });

  assert.equal(res.blocked, false);
  assert.equal(res.voiceResult.status, "awaiting_approval");
  assert.ok(
    !res.spokenSummary.includes("**"),
    "Markdown must be stripped from spoken voice summary"
  );
  assert.ok(
    res.parts.some((p) => p.type === "tool-gmailReadMessages"),
    "Inbox read card must be placed in chat"
  );
  assert.ok(
    res.parts.some(
      (p) =>
        p.type === "tool-gmailCreateDraft" && p.state === "approval-requested"
    ),
    "Gmail draft approval card must be placed in chat"
  );
});

test("Item 9: Cloud Computer detects login, 2FA, and CAPTCHA screens, emits 'I'm here / Not now' Screen Handoff card, and forbids password asks in chat", async () => {
  // System prompt enforces never asking for passwords/2FA in chat
  const promptText = systemPrompt({
    supportsTools: true,
    includeOperatorTools: true,
  });
  assert.match(promptText, /NEVER ask the user to type passwords/);
  assert.match(promptText, /requestScreenHandoff/);

  // Detector identifies login, 2FA, and captcha pages
  assert.equal(
    detectScreenHandoffChallenge({
      url: "https://github.com/login",
      title: "Sign in to GitHub",
      text: "Sign in to continue to your dashboard.",
    }),
    "login"
  );
  assert.equal(
    detectScreenHandoffChallenge({
      url: "https://accounts.google.com/signin/v2/challenge",
      title: "2-Step Verification",
      text: "Enter the 6-digit code from your authenticator app.",
    }),
    "two_factor"
  );
  assert.equal(
    detectScreenHandoffChallenge({
      url: "https://example.com/portal",
      title: "Just a moment...",
      text: "Verify you are human by completing the Cloudflare Turnstile check.",
    }),
    "captcha"
  );

  // cloudBrowseUrl automatically returns ScreenHandoffPayload on a 2FA page
  const tools = createCloudComputerTools({
    userId: fakeSession.user.id,
    relayUrl: "https://relay.example.test",
    hmacSecret: SECRET,
    signingSecret: SECRET,
    lifecycleStore: createInMemoryCloudLifecycleStore(),
    fetchImpl: () =>
      Promise.resolve(
        Response.json({
          status: "ok",
          url: "https://portal.example.com/2fa",
          title: "Two-factor authentication",
          text: "Enter the 6-digit code sent to your device.",
        })
      ),
  });

  const browseOut = await (tools.cloudBrowseUrl as any).execute(
    { url: "https://portal.example.com/2fa" },
    { toolCallId: "cb-2fa", messages: [] }
  );
  assert.equal(isScreenHandoffPayload(browseOut), true);
  assert.equal(browseOut.reason, "two_factor");
  assert.equal(browseOut.neverAskPasswordInChat, true);

  // Explicit requestScreenHandoff tool + recording "I'm here" / "Not now" decisions
  const explicitOut = await (tools.requestScreenHandoff as any).execute(
    {
      reason: "login",
      serviceName: "GitHub",
      url: "https://github.com/login",
    },
    { toolCallId: "rh-1", messages: [] }
  );
  assert.equal(isScreenHandoffPayload(explicitOut), true);
  assert.equal(explicitOut.serviceName, "GitHub");

  recordScreenHandoffDecision({
    userId: fakeSession.user.id,
    handoffId: explicitOut.handoffId,
    decision: "im_here",
  });
  assert.equal(
    getScreenHandoffDecision({
      userId: fakeSession.user.id,
      handoffId: explicitOut.handoffId,
    })?.decision,
    "im_here"
  );
});

test("Item 10: Idle Cloud Computer sleeps after inactivity and wakes automatically on the next task", async () => {
  const lifecycle = createInMemoryCloudLifecycleStore();
  const userId = fakeSession.user.id;
  const idleTimeoutMs = 10 * 60 * 1000; // 10 minutes
  const t0 = new Date("2026-11-18T12:00:00Z");

  // Initially sleeping
  const initial = await lifecycle.getSession({
    userId,
    now: t0,
    idleTimeoutMs,
  });
  assert.equal(initial.state, "sleeping");
  assert.equal(initial.wakeCount, 0);

  // Task 1 wakes the Cloud Computer
  const wake1 = await lifecycle.ensureAwakeForTask({
    userId,
    now: t0,
    idleTimeoutMs,
  });
  assert.equal(wake1.wokeFromSleep, true);
  assert.equal(wake1.session.state, "running");
  assert.equal(wake1.session.wakeCount, 1);

  // Task 2 two minutes later finds it already running (no wake needed)
  const t2m = new Date(t0.getTime() + 2 * 60 * 1000);
  const wake2 = await lifecycle.ensureAwakeForTask({
    userId,
    now: t2m,
    idleTimeoutMs,
  });
  assert.equal(wake2.wokeFromSleep, false);
  assert.equal(wake2.session.state, "running");
  assert.equal(wake2.session.wakeCount, 1);

  // 15 minutes of inactivity -> sleepIdleSessions puts it to sleep
  const t17m = new Date(t2m.getTime() + 15 * 60 * 1000);
  const slept = await lifecycle.sleepIdleSessions({
    now: t17m,
    idleTimeoutMs,
  });
  assert.equal(slept.sleptCount, 1);
  assert.deepEqual(slept.sleptUserIds, [userId]);

  const afterSleep = await lifecycle.getSession({
    userId,
    now: t17m,
    idleTimeoutMs,
  });
  assert.equal(afterSleep.state, "sleeping");
  assert.ok(afterSleep.sleptAt !== null);

  // Next task at t+20m automatically wakes it back up!
  const t20m = new Date(t17m.getTime() + 3 * 60 * 1000);
  const wake3 = await lifecycle.ensureAwakeForTask({
    userId,
    now: t20m,
    idleTimeoutMs,
  });
  assert.equal(wake3.wokeFromSleep, true);
  assert.equal(wake3.session.state, "running");
  assert.equal(wake3.session.wakeCount, 2);
});
