import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryVaultStore } from "../../lib/vault/secret-vault";
import {
  createLiveVoiceSessionDescriptor,
  MAX_VOICE_MEMO_BYTES,
  resolveLiveVoiceModelName,
  transcribeVoiceMemo,
  VOICE_STT_GEMINI_MODEL,
  VOICE_VAULT_SECRET_NAMES,
  validateAudioUpload,
} from "../../lib/voice/voice-service";

const MASTER_KEY = "0123456789abcdef0123456789abcdef-voice-vault-key";

test("voice service enforces 10MB audio limit, blocks 3.x model slugs, uses gemini-4-hydrogen floor, and guards work data", async () => {
  // Audio validation
  assert.equal(
    validateAudioUpload({
      declaredType: "audio/webm;codecs=opus",
      bytes: new Uint8Array([1, 2, 3, 4]),
    }).valid,
    true
  );
  assert.equal(
    validateAudioUpload({
      declaredType: "audio/webm",
      bytes: new Uint8Array(MAX_VOICE_MEMO_BYTES + 1),
    }).valid,
    false
  );
  assert.equal(
    validateAudioUpload({
      declaredType: "application/x-msdownload",
      bytes: new Uint8Array([1, 2, 3]),
    }).valid,
    false
  );

  // Model floor guard blocks any 3.8 / 3.x model
  assert.equal(VOICE_STT_GEMINI_MODEL, "gemini-4-hydrogen");
  const prevModel = process.env.GEMINI_LIVE_MODEL;
  try {
    process.env.GEMINI_LIVE_MODEL = "gemini-3.8-flash";
    assert.throws(
      () => resolveLiveVoiceModelName(),
      /3\.x models are disallowed/
    );
    process.env.GEMINI_LIVE_MODEL = "";
    assert.equal(resolveLiveVoiceModelName(), "gemini-live-current");
  } finally {
    process.env.GEMINI_LIVE_MODEL = prevModel ?? "";
  }

  // Vault-backed transcription & work-data block
  const prevEnabled = process.env.VOICE_ENABLED;
  try {
    process.env.VOICE_ENABLED = "false";
    const disabledRes = await transcribeVoiceMemo({
      userId: "owner-1",
      mimeType: "audio/webm",
      bytes: new Uint8Array([1, 2, 3]),
    });
    assert.equal(disabledRes.status, "setup_required");

    process.env.VOICE_ENABLED = "true";
    const vault = createInMemoryVaultStore(MASTER_KEY);
    await vault.upsertSecret({
      userId: "owner-1",
      name: VOICE_VAULT_SECRET_NAMES.geminiApiKey,
      plaintext: "AIzaSy-test-vault-gemini-key",
    });

    let requestedUrl = "";
    const okRes = await transcribeVoiceMemo({
      userId: "owner-1",
      mimeType: "audio/webm",
      bytes: new Uint8Array(32_000),
      vaultStore: vault,
      fetchImpl: ((url) => {
        requestedUrl = String(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Bugün saat beşte market alışverişi." }],
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }) as typeof fetch,
    });
    assert.match(requestedUrl, /models\/gemini-4-hydrogen:generateContent/);
    assert.equal(okRes.status, "ok");
    if (okRes.status === "ok") {
      assert.equal(okRes.model, "gemini-4-hydrogen");
      assert.ok(okRes.estimatedInputTokens > 0);
    }

    // Work data in personal Gemini transcript is blocked
    const kfBlocked = await transcribeVoiceMemo({
      userId: "owner-1",
      mimeType: "audio/webm",
      bytes: new Uint8Array(16_000),
      vaultStore: vault,
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Korn Ferry SA90 EOSB accrual review" }],
                  },
                },
              ],
            }),
            { status: 200 }
          )
        )) as typeof fetch,
    });
    assert.equal(kfBlocked.status, "blocked_data_boundary");

    // Live session descriptor never leaks raw API key
    const liveDesc = await createLiveVoiceSessionDescriptor({
      userId: "owner-1",
      vaultStore: vault,
    });
    assert.equal(liveDesc.status, "ready");
    assert.equal(
      JSON.stringify(liveDesc).includes("AIzaSy-test-vault-gemini-key"),
      false
    );
  } finally {
    process.env.VOICE_ENABLED = prevEnabled ?? "";
  }
});
