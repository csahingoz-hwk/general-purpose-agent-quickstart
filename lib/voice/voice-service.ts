import { randomUUID } from "node:crypto";
import { gatewayEnabled, openAIEnabled } from "@/lib/ai/routing/catalog";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  createPostgresVaultStore,
  type SecretVaultStore,
  VaultError,
} from "@/lib/vault/secret-vault";
import { DEFAULT_LIVE_MODEL, isAllowedLiveModel } from "./live-protocol";

export const MAX_VOICE_MEMO_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-m4a",
] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

// Owner model floor rule for chat/STT: never a 3.x text model. The single
// exception (owner-approved) is the Gemini Live speech-to-speech lane below.
export const VOICE_STT_GEMINI_MODEL = "gemini-4-hydrogen";
export const VOICE_STT_OPENAI_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_GEMINI_LIVE_MODEL = DEFAULT_LIVE_MODEL;

export const VOICE_VAULT_SECRET_NAMES = {
  geminiApiKey: "GEMINI_API_KEY",
  openaiApiKey: "OPENAI_VOICE_API_KEY",
} as const;

export function isVoiceEnabled(): boolean {
  return process.env.VOICE_ENABLED !== "false";
}

export function resolveLiveVoiceModelName(): string {
  const configured = (process.env.GEMINI_LIVE_MODEL ?? "").trim();
  if (!configured) {
    return DEFAULT_GEMINI_LIVE_MODEL;
  }
  // Only Gemini *Live* voice models are allowed here; 3.x text/Flash models stay blocked.
  if (!isAllowedLiveModel(configured)) {
    throw new Error(
      "Blocked voice model configuration: only Gemini Live voice models are allowed (3.x text models are disallowed by owner policy)."
    );
  }
  return configured;
}

export function validateAudioUpload(opts: {
  declaredType: string;
  bytes: Uint8Array;
}):
  | { valid: true; mimeType: AllowedAudioMimeType; size: number }
  | { valid: false; error: string } {
  const size = opts.bytes.byteLength;
  if (size === 0) {
    return { valid: false, error: "Recorded audio clip is empty" };
  }
  if (size > MAX_VOICE_MEMO_BYTES) {
    return {
      valid: false,
      error: "Voice memo exceeds the 10MB size limit",
    };
  }

  const baseMime = (opts.declaredType.split(";")[0] ?? "").trim().toLowerCase();
  if (baseMime === "audio/mp3") {
    return { valid: true, mimeType: "audio/mpeg", size };
  }
  if (baseMime === "audio/m4a") {
    return { valid: true, mimeType: "audio/x-m4a", size };
  }
  if ((ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(baseMime)) {
    return {
      valid: true,
      mimeType: baseMime as AllowedAudioMimeType,
      size,
    };
  }
  return {
    valid: false,
    error: "Unsupported audio format (use WebM, Ogg, MP4/M4A, WAV, or MP3)",
  };
}

export function estimateAudioTokens(byteLength: number): {
  estimatedSeconds: number;
  estimatedInputTokens: number;
} {
  // ~16 KB/s typical Opus/AAC voice bitrate; ~27 audio tokens/sec
  const estimatedSeconds = Math.max(1, Math.ceil(byteLength / 16_000));
  const estimatedInputTokens = estimatedSeconds * 27;
  return { estimatedSeconds, estimatedInputTokens };
}

export type VoiceTranscriptionResult =
  | {
      status: "ok";
      transcript: string;
      provider: "gemini" | "openai";
      model: string;
      estimatedSeconds: number;
      estimatedInputTokens: number;
    }
  | {
      status: "setup_required";
      message: string;
    }
  | {
      status: "blocked_data_boundary";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

export async function transcribeVoiceMemo(opts: {
  userId: string;
  mimeType: AllowedAudioMimeType;
  bytes: Uint8Array;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<VoiceTranscriptionResult> {
  if (!isVoiceEnabled()) {
    return {
      status: "setup_required",
      message:
        "Voice memos are not enabled yet. Set VOICE_ENABLED=true and save GEMINI_API_KEY (or OPENAI_VOICE_API_KEY) in Secret Vault.",
    };
  }

  const store = opts.vaultStore ?? createPostgresVaultStore();
  const fetchFn = opts.fetchImpl ?? fetch;
  const { estimatedSeconds, estimatedInputTokens } = estimateAudioTokens(
    opts.bytes.byteLength
  );

  let geminiKey: string | null = null;
  let openaiKey: string | null = null;

  try {
    [geminiKey, openaiKey] = await Promise.all([
      store.resolveSecret({
        userId: opts.userId,
        name: VOICE_VAULT_SECRET_NAMES.geminiApiKey,
      }),
      store.resolveSecret({
        userId: opts.userId,
        name: VOICE_VAULT_SECRET_NAMES.openaiApiKey,
      }),
    ]);
  } catch (err) {
    if (err instanceof VaultError) {
      return {
        status: "setup_required",
        message:
          "Secret Vault is not configured yet. Set SECRET_VAULT_KEY and save GEMINI_API_KEY or OPENAI_VOICE_API_KEY.",
      };
    }
    return { status: "error", message: "Failed to read voice credentials." };
  }

  // Prefer OpenAI STT if configured when owner wants non-Google processing; otherwise gemini-4-hydrogen
  if (geminiKey?.trim()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${VOICE_STT_GEMINI_MODEL}:generateContent`;
    const audioBase64 = Buffer.from(opts.bytes).toString("base64");

    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey.trim(),
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Transcribe this voice memo verbatim in its spoken language (English or Turkish). Return only the transcript text with no commentary.",
              },
              {
                inlineData: {
                  mimeType: opts.mimeType,
                  data: audioBase64,
                },
              },
            ],
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    }).catch(() => null);

    if (!response || !response.ok) {
      return {
        status: "error",
        message: `Voice transcription request failed${response ? ` (HTTP ${response.status})` : ""}.`,
      };
    }

    const body = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text =
      body.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    if (containsRestrictedWorkData(text)) {
      return {
        status: "blocked_data_boundary",
        message:
          "Transcript blocked: personal Gemini API must not be used for Korn Ferry / employer work material.",
      };
    }

    return {
      status: "ok",
      transcript: text,
      provider: "gemini",
      model: VOICE_STT_GEMINI_MODEL,
      estimatedSeconds,
      estimatedInputTokens,
    };
  }

  if (openaiKey?.trim()) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from(opts.bytes)], { type: opts.mimeType }),
      "memo.webm"
    );
    form.append("model", VOICE_STT_OPENAI_MODEL);

    const response = await fetchFn(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey.trim()}`,
        },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      }
    ).catch(() => null);

    if (!response || !response.ok) {
      return {
        status: "error",
        message: `OpenAI transcription failed${response ? ` (HTTP ${response.status})` : ""}.`,
      };
    }

    const json = (await response.json()) as { text?: string };
    return {
      status: "ok",
      transcript: (json.text ?? "").trim(),
      provider: "openai",
      model: VOICE_STT_OPENAI_MODEL,
      estimatedSeconds,
      estimatedInputTokens,
    };
  }

  return {
    status: "setup_required",
    message:
      "No voice API key found in Secret Vault. Save GEMINI_API_KEY (personal use, billed against GCP credit) or OPENAI_VOICE_API_KEY in /routines -> Secret Vault.",
  };
}

export type LiveVoiceSessionDescriptor =
  | {
      status: "ready";
      sessionId: string;
      model: string;
      billingNotice: string;
      dataBoundaryNotice: string;
      estimatedTokensPerMinute: number;
      expiresAt: string;
    }
  | {
      status: "setup_required";
      message: string;
    };

export async function createLiveVoiceSessionDescriptor(opts: {
  userId: string;
  vaultStore?: SecretVaultStore;
}): Promise<LiveVoiceSessionDescriptor> {
  if (!isVoiceEnabled()) {
    return {
      status: "setup_required",
      message:
        "Live voice is disabled by default. Set VOICE_ENABLED=true and store GEMINI_API_KEY in Secret Vault.",
    };
  }

  const model = resolveLiveVoiceModelName();
  const store = opts.vaultStore ?? createPostgresVaultStore();
  const builtInVoiceReady = gatewayEnabled() || openAIEnabled();

  try {
    const geminiKey = await store
      .resolveSecret({
        userId: opts.userId,
        name: VOICE_VAULT_SECRET_NAMES.geminiApiKey,
      })
      .catch(() => null);
    if (!geminiKey?.trim() && !builtInVoiceReady) {
      return {
        status: "setup_required",
        message:
          "Live speech is ready once your assistant model lane is active.",
      };
    }

    return {
      status: "ready",
      sessionId: randomUUID(),
      model,
      billingNotice: geminiKey?.trim()
        ? "Paid per-use Gemini Live API via Google Cloud Billing."
        : "Included with your workspace assistant lane.",
      dataBoundaryNotice:
        "Personal assistant use only — do not discuss Korn Ferry or employer confidential material.",
      estimatedTokensPerMinute: 1620,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  } catch {
    if (builtInVoiceReady) {
      return {
        status: "ready",
        sessionId: randomUUID(),
        model,
        billingNotice: "Included with your workspace assistant lane.",
        dataBoundaryNotice: "Personal assistant use only.",
        estimatedTokensPerMinute: 1620,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
    }
    return {
      status: "setup_required",
      message: "Live speech is not available right now.",
    };
  }
}

export function splitCompletedSentence(buffer: string): {
  sentence: string | null;
  rest: string;
} {
  const match = buffer.match(/^([\s\S]{14,}?[.!?;:]+)(?:\s+|$)([\s\S]*)$/);
  if (!match) {
    return { sentence: null, rest: buffer };
  }
  return {
    sentence: match[1].trim(),
    rest: match[2] ?? "",
  };
}

export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#~>]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
