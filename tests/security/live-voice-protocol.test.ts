import assert from "node:assert/strict";
import test from "node:test";
import {
  base64ToInt16,
  buildLiveConnectConfig,
  buildLiveSetupMessage,
  DEFAULT_LIVE_MODEL,
  downsampleTo16k,
  EchoGate,
  echoSimilarity,
  int16ToBase64,
  isAllowedLiveModel,
  LIVE_FRAME_SAMPLES,
  LIVE_VAD,
  LiveTurnAssembler,
  liveConstrainedSocketUrl,
  parseLiveServerMessage,
  pcm16ToFloat32,
} from "../../lib/voice/live-protocol";
import { buildVoiceSystemInstruction } from "../../lib/voice/live-session";

const FRAME = LIVE_FRAME_SAMPLES;
const frameOf = (value: number) => new Int16Array(FRAME).fill(value);
const dbToRms = (db: number) => 10 ** (db / 20);

test("live setup locks gemini-3.8-live, audio-only output, transcription, compression and noise-resistant VAD", () => {
  assert.equal(DEFAULT_LIVE_MODEL, "gemini-3.8-live");
  assert.equal(isAllowedLiveModel("gemini-3.8-live"), true);
  assert.equal(isAllowedLiveModel("gemini-3.8-flash"), false);

  const msg = buildLiveSetupMessage({
    model: "gemini-3.8-live",
    systemInstruction: "Be brief.",
  });
  assert.equal(msg.setup.model, "models/gemini-3.8-live");
  assert.deepEqual(msg.setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.deepEqual(msg.setup.inputAudioTranscription, {});
  assert.deepEqual(msg.setup.outputAudioTranscription, {});
  assert.deepEqual(msg.setup.contextWindowCompression, { slidingWindow: {} });
  const vad = msg.setup.realtimeInputConfig.automaticActivityDetection;
  assert.equal(vad.startOfSpeechSensitivity, "START_SENSITIVITY_LOW");
  assert.equal(vad.endOfSpeechSensitivity, "END_SENSITIVITY_HIGH");
  assert.ok(vad.silenceDurationMs >= 500 && vad.silenceDurationMs <= 800);
  assert.equal(
    msg.setup.realtimeInputConfig.activityHandling,
    "START_OF_ACTIVITY_INTERRUPTS"
  );
  assert.deepEqual(vad, LIVE_VAD);

  const resumed = buildLiveConnectConfig({
    systemInstruction: "x",
    resumeHandle: "h-123",
  });
  assert.deepEqual(resumed.sessionResumption, { handle: "h-123" });

  const url = liveConstrainedSocketUrl("auth_tokens/abc");
  assert.match(
    url,
    /BidiGenerateContentConstrained\?access_token=auth_tokens\/abc$/
  );
  assert.match(url, /^wss:\/\/generativelanguage\.googleapis\.com\/ws\//);
});

test("PCM helpers round-trip and downsample 48 kHz to 16 kHz 40 ms frames", () => {
  const pcm = new Int16Array([0, 1000, -1000, 32_767, -32_768]);
  assert.deepEqual(
    Array.from(base64ToInt16(int16ToBase64(pcm))),
    Array.from(pcm)
  );
  const f = pcm16ToFloat32(pcm);
  assert.ok(Math.abs((f[3] ?? 0) - 0.999_97) < 1e-3);

  const input = new Float32Array(48_000 * 0.04).fill(0.5);
  const out = downsampleTo16k(input, 48_000);
  assert.equal(out.length, FRAME);
  assert.ok(Math.abs((out[100] ?? 0) - 16_383) <= 1);

  const input44 = new Float32Array(44_100).fill(-0.25);
  const out44 = downsampleTo16k(input44, 44_100);
  assert.ok(Math.abs(out44.length - 16_000) <= 1);
});

test("echo gate forwards silence for room noise and residual speaker echo, but lets real speech (with pre-roll) through", () => {
  const gate = new EchoGate();
  // Quiet room at -60 dBFS: nothing but digital silence goes out.
  for (let i = 0; i < 25; i += 1) {
    const d = gate.process(frameOf(30), dbToRms(-60), false);
    assert.equal(d.open, false);
    assert.equal(d.frames.length, 1);
    assert.ok(d.frames[0]?.every((s) => s === 0));
  }

  // Assistant speaking; residual echo leaks at -40 dBFS (above idle threshold,
  // below barge-in threshold) for 2 seconds → still pure silence, no barge-in.
  for (let i = 0; i < 50; i += 1) {
    const d = gate.process(frameOf(400), dbToRms(-40), true);
    assert.equal(d.open, false, `echo frame ${i} must not open the gate`);
    assert.equal(d.bargeIn, false);
    assert.ok(d.frames[0]?.every((s) => s === 0));
  }

  // Short loud blip while assistant talks (cough, 120 ms) is not a barge-in.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      gate.process(frameOf(3000), dbToRms(-20), true).bargeIn,
      false
    );
  }
  gate.process(frameOf(10), dbToRms(-60), true);

  // Sustained real speech over the assistant (≥ 280 ms at -20 dBFS) → barge-in.
  let barge = false;
  let flushed = 0;
  for (let i = 0; i < 10 && !barge; i += 1) {
    const d = gate.process(frameOf(3000), dbToRms(-20), true);
    barge = d.bargeIn;
    flushed = d.frames.length;
  }
  assert.equal(barge, true);
  assert.ok(
    flushed >= 7,
    "pre-roll frames are flushed so the first syllable is kept"
  );
});

test("echo gate opens fast for normal speech when assistant is silent and closes after hangover", () => {
  const gate = new EchoGate();
  for (let i = 0; i < 20; i += 1) {
    gate.process(frameOf(20), dbToRms(-58), false);
  }
  const first = gate.process(frameOf(2000), dbToRms(-28), false);
  assert.equal(first.open, false);
  const second = gate.process(frameOf(2000), dbToRms(-28), false);
  assert.equal(second.open, true, "opens after ~80 ms of speech");
  assert.equal(second.bargeIn, false);
  assert.ok(second.frames.length >= 2);

  let closedAfter = 0;
  for (let i = 0; i < 30; i += 1) {
    const d = gate.process(frameOf(20), dbToRms(-58), false);
    if (!d.open) {
      closedAfter = i + 1;
      break;
    }
  }
  assert.ok(
    closedAfter >= 10 && closedAfter <= 14,
    `hangover ≈480 ms (got ${closedAfter} frames)`
  );
});

test("gate left open by the user's trailing hangover closes as soon as the assistant starts talking", () => {
  const gate = new EchoGate();
  for (let i = 0; i < 10; i += 1) {
    gate.process(frameOf(20), dbToRms(-58), false);
  }
  gate.process(frameOf(2000), dbToRms(-28), false);
  assert.equal(gate.process(frameOf(2000), dbToRms(-28), false).open, true);
  // Assistant audio starts while the gate is still in its hangover window.
  const d = gate.process(frameOf(600), dbToRms(-38), true);
  assert.equal(d.open, false);
  assert.ok(d.frames[0]?.every((s) => s === 0));
});

test("adaptive echo penalty raises the barge-in bar after a leak and decays on clean turns", () => {
  const gate = new EchoGate();
  const before = gate.thresholdDb(true);
  gate.reportEchoLeak();
  gate.reportEchoLeak();
  assert.equal(gate.thresholdDb(true) - before, 12);
  gate.decayEchoPenalty();
  assert.equal(gate.bargePenaltyDb, 9);
  for (let i = 0; i < 5; i += 1) {
    gate.reportEchoLeak();
  }
  assert.equal(gate.bargePenaltyDb, 18);
  assert.equal(gate.thresholdDb(false) < gate.thresholdDb(true), true);
});

test("turn assembler keeps late input transcription on the current turn until an actual barge-in occurs", () => {
  const t = new LiveTurnAssembler();
  t.addInput(" What's the");
  t.addInput(" weather");
  t.markOutputStarted();
  // Late input transcription chunk for the SAME turn arrives after audio started:
  t.addInput(" tomorrow?");
  assert.equal(t.userCaption, "What's the weather tomorrow?");
  t.addOutput("Tomorrow looks");
  // Real barge-in starts:
  t.markBargeIn();
  t.addInput(" actually");
  t.addOutput(" sunny.");
  assert.equal(t.userCaption, "actually");
  const first = t.commit(true);
  assert.deepEqual(first, {
    user: "What's the weather tomorrow?",
    assistant: "Tomorrow looks sunny.",
    interrupted: true,
  });
  t.addInput(" in Istanbul");
  const second = t.commit(false);
  assert.equal(second?.user, "actually in Istanbul");
  assert.equal(second?.assistant, "");
  assert.equal(t.commit(false), null);
});

test("echo similarity flags a 'user' turn that just repeats the assistant", () => {
  assert.ok(
    echoSimilarity(
      "what would you like me to turn off",
      "What would you like me to turn off here?"
    ) >= 0.9
  );
  assert.ok(
    echoSimilarity(
      "book a table for two",
      "What would you like me to turn off?"
    ) < 0.3
  );
});

test("server message parser yields ordered events incl. multi-part audio, interruption, resumption and goAway", () => {
  const events = parseLiveServerMessage(
    JSON.stringify({
      serverContent: {
        inputTranscription: { text: "hello" },
        modelTurn: {
          parts: [
            { inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } },
            { inlineData: { data: "BBB=", mimeType: "audio/pcm;rate=24000" } },
          ],
        },
        outputTranscription: { text: "Hi!" },
        turnComplete: true,
      },
    })
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["input-transcript", "audio", "audio", "output-transcript", "turn-complete"]
  );
  assert.deepEqual(
    parseLiveServerMessage(JSON.stringify({ setupComplete: {} })),
    [{ type: "setup-complete" }]
  );
  assert.deepEqual(
    parseLiveServerMessage(
      JSON.stringify({ serverContent: { interrupted: true } })
    ),
    [{ type: "interrupted" }]
  );
  assert.deepEqual(
    parseLiveServerMessage(
      JSON.stringify({
        sessionResumptionUpdate: { newHandle: "h1", resumable: true },
      })
    ),
    [{ type: "resumption", handle: "h1" }]
  );
  assert.deepEqual(
    parseLiveServerMessage(JSON.stringify({ goAway: { timeLeft: "4.5s" } })),
    [{ type: "go-away", timeLeftMs: 4500 }]
  );
  assert.deepEqual(parseLiveServerMessage("not json"), []);
});

test("voice system instruction enforces language mirroring, brevity, no guessing, and carries context", () => {
  const text = buildVoiceSystemInstruction({
    timeZone: "Europe/London",
    teammate: { name: "Finance Controller", soul: "Reconcile totals." },
    facts: ["Prefers GBP"],
    recentTurns: [{ role: "user", text: "Plan Friday" }],
  });
  assert.match(text, /English or Turkish/);
  assert.match(text, /Never guess words/);
  assert.match(text, /one to three sentences/);
  assert.match(text, /Finance Controller/);
  assert.match(text, /Prefers GBP/);
  assert.match(text, /Owner: Plan Friday/);
});
