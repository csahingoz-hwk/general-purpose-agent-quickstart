import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "next-auth";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { systemPrompt } from "../../lib/ai/prompts";
import {
  executeSharedVoiceToolCall,
  fillerPhraseForTool,
  LIVE_VOICE_TOOL_DECLARATIONS,
} from "../../lib/ai/tools/shared-registry";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import { createInMemoryTaskStore } from "../../lib/tasks/runner";
import type { ChatMessage } from "../../lib/types";
import type { SecretVaultStore } from "../../lib/vault/secret-vault";
import {
  buildGatewayLiveSetupMessage,
  buildLiveSetupMessage,
  buildLiveToolOutputItemMessage,
  parseLiveServerMessage,
} from "../../lib/voice/live-protocol";
import { buildVoiceSystemInstruction } from "../../lib/voice/live-session";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const fakeSession: Session = {
  user: {
    id: "97a9a7c5-e220-425d-9589-7e63b607ca75",
    email: "owner@example.test",
    name: "Çağlar",
    type: "regular",
  },
  expires: new Date(Date.now() + 3_600_000).toISOString(),
};

const emptyVault: SecretVaultStore = {
  upsertSecret() {
    return Promise.reject(new Error("not used"));
  },
  listSecrets() {
    return Promise.resolve([]);
  },
  resolveSecret() {
    return Promise.resolve(null);
  },
  deleteSecret() {
    return Promise.resolve(false);
  },
};

test("Step 1: natural EN/TR prompts route to personal connectors & delegateTask while suppressing webSearch", () => {
  const prevGoogle = process.env.GOOGLE_CONNECTORS_ENABLED;
  const prevMem = process.env.MEMORY_TOOLS_ENABLED;
  try {
    process.env.GOOGLE_CONNECTORS_ENABLED = "true";
    process.env.MEMORY_TOOLS_ENABLED = "true";

    for (const q of [
      "Did Ali email me?",
      "Any unread emails today?",
      "What's in my inbox?",
      "Bana e-posta geldi mi?",
      "Okunmamış mailim var mı?",
      "Gelen kutumda ne var?",
    ]) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("gmailReadMessages"), q);
      assert.ok(!tools.includes("webSearch"), `no webSearch leak on: ${q}`);
    }

    for (const q of [
      "What's on my calendar tomorrow?",
      "Am I free Friday afternoon?",
      "Do I have any meetings today?",
      "Takvimimde ne var?",
      "Bugün toplantım var mı?",
      "Yarın öğleden sonra boş muyum?",
    ]) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("calendarReadEvents"), q);
      assert.ok(!tools.includes("webSearch"), `no webSearch leak on: ${q}`);
    }

    for (const q of [
      "Find the tax invoice in my Drive",
      "Google Drive'da ara",
    ]) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("driveReadFiles"), q);
    }

    for (const q of [
      "Delegate a task to audit open branches",
      "Create a task card for repo cleanup",
      "Arka planda çalıştır",
    ]) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("delegateTask"), q);
      assert.ok(!tools.includes("webSearch"), `no webSearch leak on: ${q}`);
    }
  } finally {
    if (prevGoogle === undefined) {
      Reflect.deleteProperty(process.env, "GOOGLE_CONNECTORS_ENABLED");
    } else {
      process.env.GOOGLE_CONNECTORS_ENABLED = prevGoogle;
    }
    if (prevMem === undefined) {
      Reflect.deleteProperty(process.env, "MEMORY_TOOLS_ENABLED");
    } else {
      process.env.MEMORY_TOOLS_ENABLED = prevMem;
    }
  }
});

test("Step 1: voice & operator system prompts include Çağlar, Europe/London, TR/EN matching, spoken fillers, and forbid 'I don't have access'", () => {
  const voiceSys = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/London",
  });
  assert.match(voiceSys, /Çağlar/);
  assert.match(voiceSys, /Europe\/London/);
  assert.match(voiceSys, /English or Turkish/);
  assert.match(voiceSys, /Checking your inbox/);
  assert.match(voiceSys, /NEVER say 'I don't have access'/);
  assert.match(voiceSys, /setup_required/);
  assert.match(voiceSys, /awaiting_approval/);

  const opSys = systemPrompt({
    supportsTools: true,
    includeOperatorTools: true,
  });
  assert.match(opSys, /one-tap Connect button/);
  assert.match(opSys, /Never say "I don't have access"/);
});

test("Step 1: Live protocol encodes NON_BLOCKING tools on Google Direct and function tools on Gateway, and parses tool calls", () => {
  const gwSetup = buildGatewayLiveSetupMessage({
    systemInstruction: "Sys",
    tools: LIVE_VOICE_TOOL_DECLARATIONS,
  });
  assert.ok(Array.isArray(gwSetup.config.tools));
  const toolNames = gwSetup.config.tools.map((t) => t.name);
  for (const required of [
    "gmailReadMessages",
    "calendarReadEvents",
    "driveReadFiles",
    "getWeather",
    "webSearch",
    "recallMemories",
    "listMySchedules",
    "delegateTask",
  ]) {
    assert.ok(toolNames.includes(required), `missing Live tool: ${required}`);
  }

  const directSetup = buildLiveSetupMessage({
    model: "gemini-3.8-live",
    systemInstruction: "Sys",
    tools: LIVE_VOICE_TOOL_DECLARATIONS,
  });
  const decls = directSetup.setup.tools?.[0]?.functionDeclarations ?? [];
  assert.equal(decls.length, LIVE_VOICE_TOOL_DECLARATIONS.length);
  assert.equal(decls[0]?.behavior, "NON_BLOCKING");

  const gwEvents = parseLiveServerMessage(
    JSON.stringify({
      type: "function-call-arguments-done",
      callId: "call_weather_1",
      name: "getWeather",
      arguments: '{"city":"London"}',
    })
  );
  assert.deepEqual(gwEvents, [
    {
      type: "tool-call",
      callId: "call_weather_1",
      name: "getWeather",
      args: { city: "London" },
    },
  ]);

  const directEvents = parseLiveServerMessage(
    JSON.stringify({
      toolCall: {
        functionCalls: [
          {
            id: "fc_1",
            name: "gmailReadMessages",
            args: { query: "is:unread" },
          },
        ],
      },
    })
  );
  assert.deepEqual(directEvents, [
    {
      type: "tool-call",
      callId: "fc_1",
      name: "gmailReadMessages",
      args: { query: "is:unread" },
    },
  ]);

  const gwOut = buildLiveToolOutputItemMessage("gateway", {
    callId: "call_weather_1",
    name: "getWeather",
    output: { status: "ok", city: "London" },
  });
  assert.equal(gwOut.type, "conversation-item-create");

  assert.equal(
    fillerPhraseForTool("gmailReadMessages", "en"),
    "Checking your inbox…"
  );
  assert.equal(
    fillerPhraseForTool("gmailReadMessages", "tr"),
    "Gelen kutuna bakıyorum…"
  );
});

test("Step 1: shared voice tool execution handles Open-Meteo weather, Connect Google card on unconnected inbox, approval cards on sends/drafts, delegateTask cards, and Korn Ferry blocks", async () => {
  const taskStore = createInMemoryTaskStore();
  const memoryStore = createInMemoryMemoryStore();

  // 1. Unconnected Gmail -> returns Connect Google card (setup_required), never "I don't have access"
  const gmailOutcome = await executeSharedVoiceToolCall({
    session: fakeSession,
    userId: fakeSession.user.id,
    timeZone: "Europe/London",
    homeLocation: null,
    toolCallId: "tc_gmail",
    toolName: "gmailReadMessages",
    args: { query: "is:unread" },
    vaultStore: emptyVault,
    memoryStore,
    taskStore,
  });
  assert.equal(gmailOutcome.voiceResult.status, "setup_required");
  assert.equal(gmailOutcome.voiceResult.provider, "google");
  assert.equal(
    (gmailOutcome.toolPart.output as { connectProvider?: string })
      .connectProvider,
    "google"
  );
  assert.match(
    String(gmailOutcome.voiceResult.spokenInstruction),
    /Connect Google/
  );

  // 2. Weather via Open-Meteo (defaulting to London with zero API keys!)
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        current: { time: "2026-11-17T17:00", temperature_2m: 11.4 },
        current_units: { temperature_2m: "°C" },
        hourly: { time: ["2026-11-17T17:00"], temperature_2m: [11.4] },
        daily: {
          time: ["2026-11-17", "2026-11-18"],
          sunrise: ["07:22"],
          sunset: ["16:08"],
          temperature_2m_max: [12.5, 13.0],
          temperature_2m_min: [6.2, 7.1],
          precipitation_probability_max: [20, 10],
          precipitation_sum: [0, 0],
          weather_code: [1, 1],
        },
      })
    )) as unknown as typeof fetch;
  try {
    const weatherOutcome = await executeSharedVoiceToolCall({
      session: fakeSession,
      userId: fakeSession.user.id,
      timeZone: "Europe/London",
      homeLocation: null,
      toolCallId: "tc_weather",
      toolName: "getWeather",
      args: {},
      vaultStore: emptyVault,
      memoryStore,
      taskStore,
    });
    assert.equal(weatherOutcome.voiceResult.status, "ok");
    assert.equal(weatherOutcome.voiceResult.city, "London");
    assert.equal(weatherOutcome.voiceResult.currentTemperature, 11.4);
    assert.equal(weatherOutcome.toolPart.type, "tool-getWeather");
    assert.equal(weatherOutcome.toolPart.state, "output-available");
  } finally {
    globalThis.fetch = prevFetch;
  }

  // 3. Approval-gated send/draft -> pauses in approval-requested with SHA-256 digest
  const draftOutcome = await executeSharedVoiceToolCall({
    session: fakeSession,
    userId: fakeSession.user.id,
    timeZone: "Europe/London",
    homeLocation: null,
    toolCallId: "tc_draft",
    toolName: "gmailCreateDraft",
    args: {
      recipient: "friend@example.com",
      subject: "Dinner Friday",
      body: "Are you free at 7pm?",
    },
    vaultStore: emptyVault,
    memoryStore,
    taskStore,
  });
  assert.equal(draftOutcome.voiceResult.status, "awaiting_approval");
  assert.equal(draftOutcome.toolPart.state, "approval-requested");
  assert.ok(typeof draftOutcome.voiceResult.digest === "string");

  // 4. Delegate task -> safe task succeeds & destructive/sending task pauses in awaiting_approval
  const safeTask = await executeSharedVoiceToolCall({
    session: fakeSession,
    userId: fakeSession.user.id,
    timeZone: "Europe/London",
    homeLocation: null,
    toolCallId: "tc_task_safe",
    toolName: "delegateTask",
    args: {
      title: "Compare weekend train times",
      prompt: "Research London to Edinburgh train options and summarize.",
    },
    vaultStore: emptyVault,
    memoryStore,
    taskStore,
  });
  assert.equal(safeTask.toolPart.type, "tool-delegateTask");
  assert.equal(safeTask.voiceResult.status, "succeeded");

  const riskyTask = await executeSharedVoiceToolCall({
    session: fakeSession,
    userId: fakeSession.user.id,
    timeZone: "Europe/London",
    homeLocation: null,
    toolCallId: "tc_task_risky",
    toolName: "delegateTask",
    args: {
      title: "Push branch and email summary",
      prompt:
        "Run git push origin feat/test and send email to team@example.com",
    },
    vaultStore: emptyVault,
    memoryStore,
    taskStore,
  });
  assert.equal(riskyTask.voiceResult.status, "awaiting_approval");

  // 5. Korn Ferry employer data firewall blocks pre-flight
  const blocked = await executeSharedVoiceToolCall({
    session: fakeSession,
    userId: fakeSession.user.id,
    timeZone: "Europe/London",
    homeLocation: null,
    toolCallId: "tc_kf",
    toolName: "delegateTask",
    args: {
      title: "Korn Ferry Q4 accrual",
      prompt: "Summarize Korn Ferry MENA trial balance",
    },
    vaultStore: emptyVault,
    memoryStore,
    taskStore,
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.voiceResult.status, "blocked_data_boundary");
});
