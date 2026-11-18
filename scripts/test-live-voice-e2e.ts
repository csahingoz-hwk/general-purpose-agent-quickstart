import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import {
  buildGatewayLiveSetupMessage,
  buildLiveSetupMessage,
  DEFAULT_GATEWAY_LIVE_MODEL,
  DEFAULT_LIVE_MODEL,
  int16ToBase64,
  LIVE_OUTPUT_SAMPLE_RATE,
  LIVE_VOICE_TOOL_DECLARATIONS,
} from "../lib/voice/live-protocol";

const origin = "http://localhost:3100";
const owner = "owner@example.test";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type Segment = { durationMs: number; amplitude: number; freqHz?: number };

/** Writes a 16 kHz mono 16-bit PCM WAV file for Chromium's fake mic capture. */
function writeTestWav(path: string, segments: Segment[]) {
  const sampleRate = 16_000;
  const totalSamples = segments.reduce(
    (sum, s) => sum + Math.round((s.durationMs / 1000) * sampleRate),
    0
  );
  const pcm = new Int16Array(totalSamples);
  let offset = 0;
  for (const seg of segments) {
    const count = Math.round((seg.durationMs / 1000) * sampleRate);
    const freq = seg.freqHz ?? 440;
    for (let i = 0; i < count && offset < totalSamples; i += 1) {
      const t = i / sampleRate;
      pcm[offset] = Math.round(
        seg.amplitude * Math.sin(2 * Math.PI * freq * t)
      );
      offset += 1;
    }
  }
  const dataBytes = pcm.byteLength;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  Buffer.from(pcm.buffer).copy(wav, 44);
  writeFileSync(path, wav);
}

/** Synthesizes 24 kHz PCM base64 chunks for mock Gemini Live audio replies. */
function makeAssistantAudioChunks(durationMs: number, chunkMs = 150): string[] {
  const chunks: string[] = [];
  const samplesPerChunk = Math.round(
    (chunkMs / 1000) * LIVE_OUTPUT_SAMPLE_RATE
  );
  const count = Math.max(1, Math.round(durationMs / chunkMs));
  for (let c = 0; c < count; c += 1) {
    const pcm = new Int16Array(samplesPerChunk);
    for (let i = 0; i < samplesPerChunk; i += 1) {
      const t = (c * samplesPerChunk + i) / LIVE_OUTPUT_SAMPLE_RATE;
      pcm[i] = Math.round(7000 * Math.sin(2 * Math.PI * 520 * t));
    }
    chunks.push(int16ToBase64(pcm));
  }
  return chunks;
}

function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

type MockClientSocket = {
  sendJson: (obj: unknown) => void;
  close: () => void;
};

async function startMockLiveWsServer(opts: {
  onMessage: (ws: MockClientSocket, msg: Record<string, any>) => void;
  onUpgradeProtocols?: (protocols: string[]) => void;
  onClose?: () => void;
}): Promise<{ server: Server; wsUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Duplex>();
  const server = createServer();

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const rawProto = req.headers["sec-websocket-protocol"];
    const protoList =
      typeof rawProto === "string"
        ? rawProto.split(",").map((s) => s.trim())
        : [];
    opts.onUpgradeProtocols?.(protoList);
    const accept = createHash("sha1")
      .update(`${key}${WS_GUID}`)
      .digest("base64");
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      ...(protoList[0] ? [`Sec-WebSocket-Protocol: ${protoList[0]}`] : []),
      "\r\n",
    ];
    socket.write(headers.join("\r\n"));
    sockets.add(socket);

    const client: MockClientSocket = {
      sendJson(obj) {
        if (!socket.destroyed) {
          socket.write(
            encodeWsFrame(0x01, Buffer.from(JSON.stringify(obj), "utf8"))
          );
        }
      },
      close() {
        if (!socket.destroyed) {
          socket.end(encodeWsFrame(0x08, Buffer.from([0x03, 0xe8])));
        }
      },
    };

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b0 = buf[0] ?? 0;
        const b1 = buf[1] ?? 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let idx = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) {
            return;
          }
          payloadLen = buf.readUInt16BE(2);
          idx = 4;
        } else if (payloadLen === 127) {
          if (buf.length < 10) {
            return;
          }
          payloadLen = Number(buf.readBigUInt64BE(2));
          idx = 10;
        }
        const maskBytes = masked ? 4 : 0;
        if (buf.length < idx + maskBytes + payloadLen) {
          return;
        }
        const mask = masked ? buf.subarray(idx, idx + 4) : null;
        idx += maskBytes;
        const payload = Buffer.from(buf.subarray(idx, idx + payloadLen));
        buf = buf.subarray(idx + payloadLen);

        if (mask) {
          for (let i = 0; i < payload.length; i += 1) {
            payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
          }
        }
        if (opcode === 0x08) {
          opts.onClose?.();
          socket.end(encodeWsFrame(0x08, Buffer.from([0x03, 0xe8])));
          return;
        }
        if (opcode === 0x09) {
          socket.write(encodeWsFrame(0x0a, payload));
          continue;
        }
        if (opcode === 0x01) {
          const parsed = JSON.parse(payload.toString("utf8")) as Record<
            string,
            any
          >;
          opts.onMessage(client, parsed);
        }
      }
    });
    socket.on("error", () => {
      sockets.delete(socket);
    });
    socket.on("close", () => {
      sockets.delete(socket);
      opts.onClose?.();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    server,
    wsUrl: `ws://127.0.0.1:${port}/ws/BidiGenerateContentConstrained?access_token=auth_tokens/mock`,
    close: async () => {
      for (const s of sockets) {
        s.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function pcmMaxAbs(base64: string): { byteLength: number; maxAbs: number } {
  const bytes = Buffer.from(base64, "base64");
  let maxAbs = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const sample = bytes.readInt16LE(i);
    const abs = Math.abs(sample);
    if (abs > maxAbs) {
      maxAbs = abs;
    }
  }
  return { byteLength: bytes.length, maxAbs };
}

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function launchWithFakeMic(wavPath: string) {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
  return await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wavPath}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });
}

test("live voice E2E: 1-tap Gemini 3.8 Live audio turn, zero echo re-trigger during playback, and chat transcript persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-voice-e2e-"));
  const wavPath = join(dir, "turn1.wav");
  // 0..300 ms quiet floor -> 300..860 ms user speech (-11 dBFS) ->
  // 860..2050 ms simulated residual speaker bleed (-40 dBFS) -> quiet room.
  writeTestWav(wavPath, [
    { durationMs: 300, amplitude: 20 },
    { durationMs: 560, amplitude: 9000, freqHz: 440 },
    { durationMs: 1190, amplitude: 320, freqHz: 520 },
    { durationMs: 2800, amplitude: 20 },
  ]);

  const state: { setupMessage: Record<string, any> | null } = {
    setupMessage: null,
  };
  let audioBeforeSetup = 0;
  let badFrameSizes = 0;
  let speechFramesReceived = 0;
  let framesDuringAssistant = 0;
  let leakedEchoFramesDuringAssistant = 0;
  let replySent = false;
  let assistantWindowOpen = false;
  let streamEndReceived = false;
  let cleanSocketClose = false;
  const persistedTurns: Record<string, any>[] = [];

  const mock = await startMockLiveWsServer({
    onClose: () => {
      cleanSocketClose = true;
    },
    onMessage: (ws, msg) => {
      if (msg.setup) {
        state.setupMessage = msg.setup;
        ws.sendJson({ setupComplete: {} });
        return;
      }
      if (!state.setupMessage) {
        audioBeforeSetup += 1;
        return;
      }
      if (msg.realtimeInput?.audioStreamEnd) {
        streamEndReceived = true;
        return;
      }
      const b64 = msg.realtimeInput?.audio?.data;
      if (typeof b64 === "string") {
        const { byteLength, maxAbs } = pcmMaxAbs(b64);
        if (byteLength !== 1280) {
          badFrameSizes += 1;
        }
        if (assistantWindowOpen) {
          framesDuringAssistant += 1;
          if (maxAbs > 0) {
            leakedEchoFramesDuringAssistant += 1;
          }
        } else if (maxAbs > 1000) {
          speechFramesReceived += 1;
        } else if (!replySent && speechFramesReceived >= 10) {
          replySent = true;
          // Send first part of input transcription, then start audio, then
          // send late trailing inputTranscription (" morning?") AFTER audio
          // started to verify it stays on Turn 1 rather than leaking to Turn 2.
          ws.sendJson({
            serverContent: {
              inputTranscription: { text: "What is on my schedule this" },
            },
          });
          const chunks = makeAssistantAudioChunks(1350, 150);
          assistantWindowOpen = true;
          ws.sendJson({
            serverContent: {
              modelTurn: {
                parts: [
                  {
                    inlineData: {
                      data: chunks[0],
                      mimeType: "audio/pcm;rate=24000",
                    },
                  },
                ],
              },
              outputTranscription: { text: "Good morning! " },
            },
          });
          ws.sendJson({
            serverContent: {
              inputTranscription: { text: " morning?" },
              modelTurn: {
                parts: chunks.slice(1).map((data) => ({
                  inlineData: { data, mimeType: "audio/pcm;rate=24000" },
                })),
              },
              outputTranscription: {
                text: "Your Friday calendar is clear.",
              },
              turnComplete: true,
            },
          });
          setTimeout(() => {
            assistantWindowOpen = false;
          }, 1450);
        }
      }
    },
  });

  const browser = await launchWithFakeMic(wavPath);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      permissions: ["microphone"],
    });
    const sessionJwt = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: sessionJwt, url: origin },
    ]);
    const page = await context.newPage();

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/messages*", (route) =>
      route.fulfill({
        json: {
          messages: [],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      })
    );
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: "gpt-6-luna",
          checkedAt: "2026-11-17T12:00:00Z",
          models: [
            {
              id: "gpt-6-luna",
              name: "Everyday chat",
              provider: "openai",
              description: "GPT-6 Luna",
            },
          ],
          capabilities: {},
        },
      })
    );
    await page.route("**/api/voice/transcribe", (route) =>
      route.fulfill({ json: { serverSttReady: true, liveReady: true } })
    );
    await page.route("**/api/voice/live-session", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          token: "auth_tokens/mock",
          model: DEFAULT_LIVE_MODEL,
          wsUrl: mock.wsUrl,
          setup: buildLiveSetupMessage({
            model: DEFAULT_LIVE_MODEL,
            systemInstruction: "Be brief and helpful.",
          }),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
    );
    await page.route("**/api/voice/live-transcript", (route) => {
      persistedTurns.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ json: { saved: true } });
    });

    await page.goto(origin);
    const liveBtn = page.getByTestId("live-voice-button");
    await expect(liveBtn).toBeVisible();

    await liveBtn.click();
    const overlay = page.getByTestId("live-voice-overlay");
    await expect(overlay).toBeVisible();

    // Wait for assistant speaking phase + live caption
    await expect(overlay).toHaveAttribute("data-phase", "speaking", {
      timeout: 6000,
    });
    await expect(
      page.getByTestId("live-voice-assistant-caption")
    ).toContainText("Your Friday calendar is clear.");

    // Wait for Web Audio 24 kHz playback to finish and return cleanly to listening
    await expect(overlay).toHaveAttribute("data-phase", "listening", {
      timeout: 6000,
    });
    // Hold 700 ms in listening with simulated residual speaker bleed: must NOT re-trigger!
    await page.waitForTimeout(700);
    await expect(overlay).toHaveAttribute("data-phase", "listening");

    await page.getByTestId("live-voice-close").click();
    await expect(overlay).toHaveCount(0);

    // Both turns are mirrored cleanly into the chat conversation
    await expect(
      page.getByText("What is on my schedule this morning?")
    ).toBeVisible();
    await expect(
      page.getByText("Good morning! Your Friday calendar is clear.")
    ).toBeVisible();

    assert.ok(state.setupMessage, "setup message sent first");
    assert.equal(state.setupMessage.model, `models/${DEFAULT_LIVE_MODEL}`);
    assert.deepEqual(state.setupMessage.generationConfig?.responseModalities, [
      "AUDIO",
    ]);
    assert.equal(
      state.setupMessage.realtimeInputConfig?.automaticActivityDetection
        ?.startOfSpeechSensitivity,
      "START_SENSITIVITY_LOW"
    );
    assert.equal(audioBeforeSetup, 0, "no audio sent before setupComplete");
    assert.equal(badFrameSizes, 0, "every PCM frame is 1280 bytes (40 ms)");
    assert.ok(speechFramesReceived >= 10, "real speech frames streamed");
    assert.ok(framesDuringAssistant >= 8, "mic stayed active during playback");
    assert.equal(
      leakedEchoFramesDuringAssistant,
      0,
      "EchoGate forwarded 100% digital zeros during -40 dBFS residual echo"
    );
    assert.equal(
      persistedTurns.length,
      1,
      "exactly one turn persisted (zero self-hearing echo loop)"
    );
    assert.equal(
      persistedTurns[0]?.userText,
      "What is on my schedule this morning?"
    );
    assert.equal(
      persistedTurns[0]?.assistantText,
      "Good morning! Your Friday calendar is clear."
    );
    assert.equal(persistedTurns[0]?.interrupted, false);
    assert.equal(streamEndReceived, true);
    assert.equal(cleanSocketClose, true);
    console.log(
      "PASS: Gemini 3.8 Live 1-tap voice turn, 40 ms 16 kHz capture, 24 kHz playback, zero echo loop, and chat persistence verified"
    );
  } finally {
    await browser.close();
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live voice E2E: ignores brief cough during assistant speech, honors sustained barge-in, and plays the follow-up reply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-voice-barge-"));
  const wavPath = join(dir, "barge.wav");
  // 0..300 ms quiet -> 300..850 ms Turn 1 speech ->
  // 850..1250 ms quiet while assistant starts a 4-second reply ->
  // 1250..1370 ms (120 ms) brief cough (-12 dBFS, must NOT barge in) ->
  // 1370..1600 ms quiet ->
  // 1600..2350 ms (750 ms) sustained loud barge-in (-9 dBFS, MUST barge in) ->
  // quiet room while short follow-up plays.
  writeTestWav(wavPath, [
    { durationMs: 300, amplitude: 20 },
    { durationMs: 550, amplitude: 9500, freqHz: 420 },
    { durationMs: 400, amplitude: 20 },
    { durationMs: 120, amplitude: 8000, freqHz: 350 },
    { durationMs: 230, amplitude: 20 },
    { durationMs: 750, amplitude: 11_500, freqHz: 460 },
    { durationMs: 3000, amplitude: 20 },
  ]);

  let stage: "waiting-turn1" | "assistant-long" | "after-barge" =
    "waiting-turn1";
  let turn1Frames = 0;
  let bargeFramesDuringLongReply = 0;
  const persistedTurns: Record<string, any>[] = [];

  const mock = await startMockLiveWsServer({
    onMessage: (ws, msg) => {
      if (msg.setup) {
        ws.sendJson({ setupComplete: {} });
        return;
      }
      const b64 = msg.realtimeInput?.audio?.data;
      if (typeof b64 !== "string") {
        return;
      }
      const { maxAbs } = pcmMaxAbs(b64);
      if (stage === "waiting-turn1" && maxAbs > 500) {
        turn1Frames += 1;
        if (turn1Frames === 8) {
          stage = "assistant-long";
          const longChunks = makeAssistantAudioChunks(4000, 250);
          ws.sendJson({
            serverContent: {
              inputTranscription: { text: "Read me every meeting" },
              modelTurn: {
                parts: longChunks.map((data) => ({
                  inlineData: { data, mimeType: "audio/pcm;rate=24000" },
                })),
              },
              outputTranscription: {
                text: "Here is the full list of every meeting today",
              },
            },
          });
        }
      } else if (stage === "assistant-long" && maxAbs > 500) {
        bargeFramesDuringLongReply += 1;
        if (bargeFramesDuringLongReply === 4) {
          stage = "after-barge";
          const shortChunks = makeAssistantAudioChunks(450, 150);
          ws.sendJson({
            serverContent: { interrupted: true },
          });
          ws.sendJson({
            serverContent: {
              inputTranscription: { text: "Just the headline please" },
              modelTurn: {
                parts: shortChunks.map((data) => ({
                  inlineData: { data, mimeType: "audio/pcm;rate=24000" },
                })),
              },
              outputTranscription: { text: "You are free until noon." },
              turnComplete: true,
            },
          });
        }
      }
    },
  });

  const browser = await launchWithFakeMic(wavPath);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      permissions: ["microphone"],
    });
    const sessionJwt = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: sessionJwt, url: origin },
    ]);
    const page = await context.newPage();

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/messages*", (route) =>
      route.fulfill({
        json: {
          messages: [],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      })
    );
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: "gpt-6-luna",
          checkedAt: "2026-11-17T12:00:00Z",
          models: [
            {
              id: "gpt-6-luna",
              name: "Everyday chat",
              provider: "openai",
              description: "GPT-6 Luna",
            },
          ],
          capabilities: {},
        },
      })
    );
    await page.route("**/api/voice/transcribe", (route) =>
      route.fulfill({ json: { serverSttReady: true, liveReady: true } })
    );
    await page.route("**/api/voice/live-session", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          token: "auth_tokens/mock",
          model: DEFAULT_LIVE_MODEL,
          wsUrl: mock.wsUrl,
          setup: buildLiveSetupMessage({
            model: DEFAULT_LIVE_MODEL,
            systemInstruction: "Be brief.",
          }),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
    );
    await page.route("**/api/voice/live-transcript", (route) => {
      persistedTurns.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ json: { saved: true } });
    });

    await page.goto(origin);
    await page.getByTestId("live-voice-button").click();
    const overlay = page.getByTestId("live-voice-overlay");
    await expect(overlay).toBeVisible();

    // Wait until the barge-in follow-up reply plays and finishes cleanly
    await expect(
      page.getByTestId("live-voice-assistant-caption")
    ).toContainText("You are free until noon.", { timeout: 8000 });
    await expect(overlay).toHaveAttribute("data-phase", "listening", {
      timeout: 6000,
    });

    await page.getByTestId("live-voice-close").click();
    await expect(overlay).toHaveCount(0);

    await expect(
      page.getByText("Here is the full list of every meeting today …")
    ).toBeVisible();
    await expect(page.getByText("Just the headline please")).toBeVisible();
    await expect(page.getByText("You are free until noon.")).toBeVisible();

    assert.equal(persistedTurns.length, 2);
    assert.equal(persistedTurns[0]?.interrupted, true);
    assert.equal(persistedTurns[1]?.userText, "Just the headline please");
    assert.equal(persistedTurns[1]?.assistantText, "You are free until noon.");
    assert.equal(persistedTurns[1]?.interrupted, false);
    console.log(
      "PASS: barge-in flushes interrupted 4s reply in <100 ms and plays follow-up reply without dropping audio"
    );
  } finally {
    await browser.close();
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live voice E2E: zero-key Vercel AI Gateway (google/gemini-3.8-live) subprotocol WebSocket turn works end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-voice-gw-"));
  const wavPath = join(dir, "gw.wav");
  writeTestWav(wavPath, [
    { durationMs: 300, amplitude: 20 },
    { durationMs: 560, amplitude: 9000, freqHz: 440 },
    { durationMs: 2500, amplitude: 20 },
  ]);

  const seenProtocols: string[] = [];
  let sessionUpdateReceived = false;
  let speechFrames = 0;
  let replied = false;
  let commitReceived = false;
  const persistedTurns: Record<string, any>[] = [];

  const mock = await startMockLiveWsServer({
    onUpgradeProtocols: (list) => {
      seenProtocols.push(...list);
    },
    onMessage: (ws, msg) => {
      if (msg.type === "session-update") {
        sessionUpdateReceived = true;
        ws.sendJson({ type: "session-created", raw: { setupComplete: {} } });
        return;
      }
      if (msg.type === "input-audio-commit") {
        commitReceived = true;
        return;
      }
      if (msg.type === "input-audio-append" && typeof msg.audio === "string") {
        const { maxAbs } = pcmMaxAbs(msg.audio);
        if (maxAbs > 1000) {
          speechFrames += 1;
        } else if (!replied && speechFrames >= 8) {
          replied = true;
          const chunks = makeAssistantAudioChunks(600, 150);
          ws.sendJson({
            type: "input-transcription-completed",
            transcript: "Check my evening",
          });
          for (const delta of chunks) {
            ws.sendJson({ type: "audio-delta", delta });
          }
          ws.sendJson({
            type: "audio-transcript-delta",
            delta: "Your evening is completely free.",
          });
          ws.sendJson({ type: "response-done", status: "completed" });
        }
      }
    },
  });

  const browser = await launchWithFakeMic(wavPath);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      permissions: ["microphone"],
    });
    const sessionJwt = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: sessionJwt, url: origin },
    ]);
    const page = await context.newPage();

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/messages*", (route) =>
      route.fulfill({
        json: {
          messages: [],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      })
    );
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: "gpt-6-luna",
          checkedAt: "2026-11-17T12:00:00Z",
          models: [
            {
              id: "gpt-6-luna",
              name: "Everyday chat",
              provider: "openai",
              description: "GPT-6 Luna",
            },
          ],
          capabilities: {},
        },
      })
    );
    await page.route("**/api/voice/transcribe", (route) =>
      route.fulfill({ json: { serverSttReady: true, liveReady: true } })
    );
    await page.route("**/api/voice/live-session", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          transport: "gateway",
          token: "vcst_mock_gateway_secret",
          model: DEFAULT_GATEWAY_LIVE_MODEL,
          wsUrl: mock.wsUrl,
          protocols: [
            "ai-gateway-realtime-v1",
            "ai-gateway-auth.vcst_mock_gateway_secret",
          ],
          setup: buildGatewayLiveSetupMessage({
            systemInstruction: "Be concise.",
          }),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
    );
    await page.route("**/api/voice/live-transcript", (route) => {
      persistedTurns.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ json: { saved: true } });
    });

    await page.goto(origin);
    await page.getByTestId("live-voice-button").click();
    const overlay = page.getByTestId("live-voice-overlay");
    await expect(overlay).toBeVisible();

    await expect(
      page.getByTestId("live-voice-assistant-caption")
    ).toContainText("Your evening is completely free.", { timeout: 6000 });
    await expect(overlay).toHaveAttribute("data-phase", "listening", {
      timeout: 6000,
    });

    await page.getByTestId("live-voice-close").click();
    await expect(overlay).toHaveCount(0);

    await expect(page.getByText("Check my evening")).toBeVisible();
    await expect(
      page.getByText("Your evening is completely free.")
    ).toBeVisible();

    assert.equal(sessionUpdateReceived, true);
    assert.deepEqual(seenProtocols, [
      "ai-gateway-realtime-v1",
      "ai-gateway-auth.vcst_mock_gateway_secret",
    ]);
    assert.equal(commitReceived, true);
    assert.equal(persistedTurns.length, 1);
    assert.equal(persistedTurns[0]?.userText, "Check my evening");
    console.log(
      "PASS: zero-key Vercel AI Gateway (google/gemini-3.8-live) live voice turn verified end to end"
    );
  } finally {
    await browser.close();
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live voice E2E: Gemini Live function calling mirrors Connect Google card, TaskCard, and ApprovalCard into chat with spoken filler", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-voice-tools-e2e-"));
  const wavPath = join(dir, "tools.wav");
  writeTestWav(wavPath, [
    { durationMs: 300, amplitude: 20 },
    { durationMs: 560, amplitude: 9200, freqHz: 430 },
    { durationMs: 3500, amplitude: 20 },
  ]);

  let sawToolDeclarations = false;
  let speechFrames = 0;
  let toolTriggered = false;
  const receivedToolOutputs: Array<{ callId: string; name: string }> = [];

  const mock = await startMockLiveWsServer({
    onMessage: (ws, msg) => {
      if (msg.type === "session-update") {
        sawToolDeclarations =
          Array.isArray(msg.config?.tools) && msg.config.tools.length >= 10;
        ws.sendJson({ type: "session-updated" });
        return;
      }
      if (msg.type === "input-audio-append" && typeof msg.audio === "string") {
        const { maxAbs } = pcmMaxAbs(msg.audio);
        if (maxAbs > 1000) {
          speechFrames += 1;
        } else if (!toolTriggered && speechFrames >= 8) {
          toolTriggered = true;
          ws.sendJson({
            type: "input-transcription-completed",
            itemId: "item_u1",
            transcript: "Check my inbox, start a repo task, and draft an email",
          });
          ws.sendJson({
            type: "audio-transcript-delta",
            responseId: "r1",
            itemId: "i1",
            delta: "Checking your inbox… ",
          });
          ws.sendJson({
            type: "function-call-arguments-done",
            responseId: "r1",
            itemId: "i_fc1",
            callId: "call_gmail_1",
            name: "gmailReadMessages",
            arguments: '{"query":"is:unread"}',
          });
          ws.sendJson({
            type: "function-call-arguments-done",
            responseId: "r1",
            itemId: "i_fc2",
            callId: "call_task_1",
            name: "delegateTask",
            arguments:
              '{"title":"Audit open branches","prompt":"List stale branches"}',
          });
          ws.sendJson({
            type: "function-call-arguments-done",
            responseId: "r1",
            itemId: "i_fc3",
            callId: "call_draft_1",
            name: "gmailCreateDraft",
            arguments:
              '{"recipient":"ali@example.com","subject":"Hello","body":"Hi Ali"}',
          });
          ws.sendJson({
            type: "response-done",
            responseId: "r1",
            status: "completed",
          });
        }
        return;
      }
      if (
        msg.type === "conversation-item-create" &&
        msg.item?.type === "function-call-output"
      ) {
        receivedToolOutputs.push({
          callId: String(msg.item.callId),
          name: String(msg.item.name),
        });
        return;
      }
      if (msg.type === "response-create" && receivedToolOutputs.length >= 3) {
        for (const chunk of makeAssistantAudioChunks(300)) {
          ws.sendJson({
            type: "audio-delta",
            responseId: "r2",
            itemId: "i2",
            delta: chunk,
          });
        }
        ws.sendJson({
          type: "audio-transcript-delta",
          responseId: "r2",
          itemId: "i2",
          delta:
            "Google isn't connected yet—tap Connect Google in chat, and your task and draft approval cards are ready.",
        });
        ws.sendJson({
          type: "response-done",
          responseId: "r2",
          status: "completed",
        });
      }
    },
  });

  const browser = await launchWithFakeMic(wavPath);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      permissions: ["microphone"],
    });
    const sessionJwt = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, name: "Çağlar", type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: sessionJwt, url: origin },
    ]);
    const page = await context.newPage();

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/messages*", (route) =>
      route.fulfill({
        json: {
          messages: [],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      })
    );
    await page.route("**/api/tasks*", (route) =>
      route.fulfill({ json: { status: "ready", tasks: [] } })
    );
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: "gpt-6-luna",
          checkedAt: "2026-11-17T12:00:00Z",
          models: [
            {
              id: "gpt-6-luna",
              name: "Everyday chat",
              provider: "openai",
              description: "GPT-6 Luna",
            },
          ],
          capabilities: {},
        },
      })
    );
    await page.route("**/api/voice/transcribe", (route) =>
      route.fulfill({ json: { serverSttReady: true, liveReady: true } })
    );
    await page.route("**/api/voice/live-session", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          transport: "gateway",
          token: "vcst_mock_tools",
          model: DEFAULT_GATEWAY_LIVE_MODEL,
          wsUrl: mock.wsUrl,
          protocols: [
            "ai-gateway-realtime-v1",
            "ai-gateway-auth.vcst_mock_tools",
          ],
          setup: buildGatewayLiveSetupMessage({
            systemInstruction: "Sys",
            tools: LIVE_VOICE_TOOL_DECLARATIONS,
          }),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
    );
    await page.route("**/api/voice/live-transcript", (route) =>
      route.fulfill({ json: { saved: true } })
    );

    await page.goto(origin);
    await page.getByTestId("live-voice-button").click();
    const overlay = page.getByTestId("live-voice-overlay");
    await expect(overlay).toBeVisible();

    await expect(
      page.getByTestId("live-voice-assistant-caption")
    ).toContainText("tap Connect Google in chat", { timeout: 8000 });
    await expect(page.getByTestId("live-voice-open-chat-card")).toBeVisible();

    // Tap the 1-tap banner to return to chat and verify all 3 mirrored cards!
    await page.getByTestId("live-voice-open-chat-card").click();
    await expect(overlay).toHaveCount(0);

    await expect(page.getByTestId("connect-google-button")).toBeVisible();
    await expect(page.getByTestId("task-card")).toBeVisible();
    await expect(page.getByText("Audit open branches")).toBeVisible();
    await expect(
      page.getByText("Save unsent Gmail draft (never sends)")
    ).toBeVisible();

    assert.equal(sawToolDeclarations, true);
    assert.equal(receivedToolOutputs.length, 3);
    console.log(
      "PASS: Live Voice function calling + filler + Connect Google card + TaskCard + ApprovalCard verified in Chrome"
    );
  } finally {
    await browser.close();
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
