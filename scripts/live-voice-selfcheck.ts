/**
 * Build-time live-voice self-check (non-fatal).
 *
 * Proves the real production path end to end on every deploy:
 * server key → single-use ephemeral token with locked config → constrained
 * WebSocket → setup → a short spoken reply. Logs only timings and status.
 */
import postgres from "postgres";
import { createPostgresVaultStore } from "../lib/vault/secret-vault";
import {
  buildLiveSetupMessage,
  parseLiveServerMessage,
} from "../lib/voice/live-protocol";
import { mintLiveVoiceToken } from "../lib/voice/live-session";
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
  const apiKey = await resolveKey();
  if (!apiKey) {
    return "SKIP (no Gemini key configured for the owner)";
  }
  const t0 = Date.now();
  const systemInstruction = "Self-check. Answer in one short English sentence.";
  const grant = await mintLiveVoiceToken({ apiKey, systemInstruction });
  const tToken = Date.now() - t0;
  const setup = buildLiveSetupMessage({
    model: grant.model,
    systemInstruction,
  });

  return await new Promise<string>((resolve) => {
    const ws = new WebSocket(grant.wsUrl);
    let tSetup = 0;
    let tSent = 0;
    let tFirstAudio = 0;
    let audioBytes = 0;
    let transcript = "";
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
        `FAIL timeout (token ${tToken}ms, setup ${tSetup ? `${tSetup}ms` : "none"}, audio ${audioBytes}B)`
      );
    }, HARD_TIMEOUT_MS - 3000);

    ws.onopen = () => ws.send(JSON.stringify(setup));
    ws.onerror = () => {
      /* onclose reports */
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (!tFirstAudio) {
        resolve(
          `FAIL socket closed code=${ev.code} reason=${(ev.reason || "").slice(0, 160)} (token ${tToken}ms)`
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
        if (event.type === "setup-complete") {
          tSetup = Date.now() - t0;
          tSent = Date.now();
          ws.send(
            JSON.stringify({
              realtimeInput: { text: "Please say: voice check complete." },
            })
          );
        } else if (event.type === "audio") {
          if (!tFirstAudio) {
            tFirstAudio = Date.now() - tSent;
          }
          audioBytes += Math.floor((event.data.length * 3) / 4);
        } else if (event.type === "output-transcript") {
          transcript += event.text;
        } else if (event.type === "turn-complete") {
          clearTimeout(timer);
          finish(
            `PASS model=${grant.model} token=${tToken}ms setupComplete=${tSetup}ms firstAudio=${tFirstAudio}ms audio=${(audioBytes / 48_000).toFixed(1)}s transcript="${transcript.trim().slice(0, 80)}"`
          );
        } else if (event.type === "error") {
          clearTimeout(timer);
          finish(`FAIL server error: ${event.message.slice(0, 160)}`);
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
