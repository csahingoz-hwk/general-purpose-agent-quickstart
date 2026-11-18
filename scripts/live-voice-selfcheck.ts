/**
 * Build-time live-voice self-check (non-fatal).
 *
 * Proves the real production path end to end on every deploy:
 * Vercel OIDC -> Google Cloud Vertex AI WIF (`0140A2-72DEB2-62EDCD` Ultra credit) ->
 * WebSocket (`gemini-3.8-live` BidiGenerateContent) -> setup -> tool call -> spoken audio reply.
 * Logs only timings and status, never credentials.
 */
import postgres from "postgres";
import { vertexEnabled } from "../lib/ai/routing/catalog";
import { createPostgresVaultStore } from "../lib/vault/secret-vault";
import {
  buildLiveToolOutputItemMessage,
  parseLiveServerMessage,
} from "../lib/voice/live-protocol";
import {
  buildVoiceSystemInstruction,
  mintLiveVoiceToken,
} from "../lib/voice/live-session";
import { VOICE_VAULT_SECRET_NAMES } from "../lib/voice/voice-service";

const HARD_TIMEOUT_MS = 25_000;

async function resolveKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  const owner = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || !process.env.POSTGRES_URL?.trim()) {
    return null;
  }
  const sql = postgres(process.env.POSTGRES_URL, { max: 1, prepare: false });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM "User" WHERE lower(email) = ${owner} LIMIT 1`;
    const userId = rows[0]?.id;
    if (!userId) {
      return null;
    }
    const key = await createPostgresVaultStore()
      .resolveSecret({ userId, name: VOICE_VAULT_SECRET_NAMES.geminiApiKey })
      .catch(() => null);
    return key?.trim() || null;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => null);
  }
}

async function run(): Promise<string> {
  const hasVertexCreds =
    vertexEnabled() && Boolean(process.env.VERCEL_OIDC_TOKEN?.trim());
  const apiKey = hasVertexCreds ? null : await resolveKey();
  if (!hasVertexCreds && !apiKey) {
    return "SKIP (no Vertex WIF OIDC or Gemini key in build environment)";
  }
  const t0 = Date.now();
  const systemInstruction = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/London",
  });
  const grant = await mintLiveVoiceToken({
    apiKey,
    preferVertex: hasVertexCreds,
    systemInstruction,
  });
  const tToken = Date.now() - t0;

  return await new Promise<string>((resolve) => {
    const ws =
      grant.protocols && grant.protocols.length > 0
        ? new WebSocket(grant.wsUrl, grant.protocols)
        : new WebSocket(grant.wsUrl);
    let tSetup = 0;
    let tSent = 0;
    let tFirstAudio = 0;
    let audioBytes = 0;
    let transcript = "";
    let promptSent = false;
    let toolCalled = "";
    let awaitingToolAnswer = false;
    let pendingGatewayResume = false;
    const seenCallIds = new Set<string>();
    const finish = (status: string) => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(status);
    };
    const timer = setTimeout(() => {
      finish(
        `FAIL timeout (transport=${grant.transport}, token ${tToken}ms, setup ${tSetup ? `${tSetup}ms` : "none"}, tool=${toolCalled || "none"}, audio ${audioBytes}B)`
      );
    }, HARD_TIMEOUT_MS - 3000);

    ws.onopen = () => ws.send(JSON.stringify(grant.setup));
    ws.onerror = () => {
      /* onclose reports */
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (!tFirstAudio) {
        resolve(
          `FAIL socket closed transport=${grant.transport} code=${ev.code} reason=${(ev.reason || "").slice(0, 160)} (token ${tToken}ms)`
        );
      }
    };
    ws.onmessage = async (ev) => {
      const raw =
        typeof ev.data === "string"
          ? ev.data
          : ev.data instanceof Blob
            ? await ev.data.text()
            : new TextDecoder().decode(ev.data as ArrayBuffer);
      for (const event of parseLiveServerMessage(raw)) {
        if (event.type === "setup-complete" && !promptSent) {
          promptSent = true;
          tSetup = Date.now() - t0;
          tSent = Date.now();
          const promptText =
            "What is the weather in London right now? Call getWeather.";
          if (grant.transport === "gateway") {
            ws.send(
              JSON.stringify({
                type: "conversation-item-create",
                item: {
                  type: "text-message",
                  role: "user",
                  text: promptText,
                },
              })
            );
            ws.send(JSON.stringify({ type: "response-create" }));
          } else if (grant.wsUrl.includes("aiplatform.googleapis.com")) {
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: promptText }],
                    },
                  ],
                  turnComplete: true,
                },
              })
            );
          } else {
            ws.send(JSON.stringify({ realtimeInput: { text: promptText } }));
          }
        } else if (event.type === "tool-call") {
          if (seenCallIds.has(event.callId)) {
            continue;
          }
          seenCallIds.add(event.callId);
          toolCalled = event.name;
          awaitingToolAnswer = true;
          ws.send(
            JSON.stringify(
              buildLiveToolOutputItemMessage(grant.transport, {
                callId: event.callId,
                name: event.name,
                output: {
                  status: "ok",
                  city: "London",
                  currentTemperature: 16,
                  unit: "°C",
                  rainChancePercent: 10,
                },
              })
            )
          );
          if (grant.transport === "gateway") {
            pendingGatewayResume = true;
          }
        } else if (event.type === "audio") {
          if (!tFirstAudio) {
            tFirstAudio = Date.now() - tSent;
          }
          audioBytes += Math.floor((event.data.length * 3) / 4);
        } else if (event.type === "output-transcript") {
          transcript += event.text;
        } else if (event.type === "turn-complete") {
          if (pendingGatewayResume) {
            pendingGatewayResume = false;
            awaitingToolAnswer = false;
            ws.send(JSON.stringify({ type: "response-create" }));
            continue;
          }
          if (awaitingToolAnswer && audioBytes === 0) {
            awaitingToolAnswer = false;
            continue;
          }
          clearTimeout(timer);
          finish(
            `PASS transport=${grant.transport} model=${grant.model} tool=${toolCalled || "direct"} token=${tToken}ms setupComplete=${tSetup}ms firstAudio=${tFirstAudio}ms audio=${(audioBytes / 48_000).toFixed(1)}s transcript="${transcript.trim().slice(0, 80)}"`
          );
        } else if (event.type === "error") {
          clearTimeout(timer);
          finish(
            `FAIL server error (${grant.transport}): ${event.message.slice(0, 160)}`
          );
        }
      }
    };
  });
}

const hard = setTimeout(() => {
  console.log("Live voice self-check: FAIL hard timeout");
  process.exit(0);
}, HARD_TIMEOUT_MS);

run()
  .then((status) => console.log(`Live voice self-check: ${status}`))
  .catch((err) =>
    console.log(
      `Live voice self-check: FAIL ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`
    )
  )
  .finally(() => {
    clearTimeout(hard);
    process.exit(0);
  });
