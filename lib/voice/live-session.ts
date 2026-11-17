import { GoogleGenAI } from "@google/genai";
import {
  createPostgresVaultStore,
  isVaultConfigured,
} from "@/lib/vault/secret-vault";
import {
  buildLiveConnectConfig,
  buildLiveSetupMessage,
  DEFAULT_LIVE_VOICE,
  liveConstrainedSocketUrl,
} from "./live-protocol";
import {
  resolveLiveVoiceModelName,
  VOICE_VAULT_SECRET_NAMES,
} from "./voice-service";

export class LiveVoiceSetupError extends Error {
  readonly code: "key_missing" | "token_failed" | "model_blocked";
  constructor(code: LiveVoiceSetupError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** Gemini key for the Live lane: Vercel env first, then the owner's vault. */
export async function resolveLiveGeminiKey(
  userId: string
): Promise<string | null> {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (!process.env.POSTGRES_URL?.trim() || !isVaultConfigured()) {
    return null;
  }
  const fromVault = await createPostgresVaultStore()
    .resolveSecret({ userId, name: VOICE_VAULT_SECRET_NAMES.geminiApiKey })
    .catch(() => null);
  return fromVault?.trim() || null;
}

export function buildVoiceSystemInstruction(opts: {
  timeZone: string;
  teammate?: { name: string; soul: string } | null;
  facts?: string[];
  recentTurns?: Array<{ role: "user" | "assistant"; text: string }>;
}): string {
  const now = new Date();
  let localTime = now.toISOString();
  try {
    localTime = now.toLocaleString("en-GB", {
      timeZone: opts.timeZone,
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    /* keep ISO */
  }
  const lines = [
    "You are the owner's personal assistant in a live, hands-free voice conversation.",
    "Speak like a warm, sharp human on a phone call: natural, concise, usually one to three sentences. Offer more detail only when asked.",
    "Always reply in the language the owner is speaking (English or Turkish), and switch instantly if they switch.",
    "Never read out markdown, lists, symbols, or URLs. Say numbers and dates the way people speak them.",
    "If you did not clearly hear something, say so briefly and ask the owner to repeat it. Never guess words the owner did not say.",
    "This is a personal assistant. If the owner starts discussing employer-confidential work material, politely say that it can't be handled in voice mode.",
    `Local time for the owner: ${localTime} (${opts.timeZone}).`,
  ];
  if (opts.teammate) {
    lines.push(
      `Active specialist role: ${opts.teammate.name}.`,
      opts.teammate.soul.slice(0, 1200)
    );
  }
  if (opts.facts && opts.facts.length > 0) {
    lines.push(
      "Things the owner asked you to remember:",
      ...opts.facts.slice(0, 12).map((f) => `- ${f.slice(0, 200)}`)
    );
  }
  if (opts.recentTurns && opts.recentTurns.length > 0) {
    lines.push(
      "Recent conversation in this chat (continue naturally from it):",
      ...opts.recentTurns
        .slice(-8)
        .map(
          (t) =>
            `${t.role === "user" ? "Owner" : "You"}: ${t.text.slice(0, 400)}`
        )
    );
  }
  return lines.join("\n");
}

export type LiveTokenGrant = {
  token: string;
  model: string;
  wsUrl: string;
  setup: ReturnType<typeof buildLiveSetupMessage>;
  expiresAt: string;
};

/**
 * Mints a single-use ephemeral token whose session config is locked
 * server-side (model, voice, VAD, transcription, system instruction). The
 * long-lived Gemini key never reaches the browser.
 */
export async function mintLiveVoiceToken(opts: {
  apiKey: string;
  systemInstruction: string;
  resumeHandle?: string | null;
  voiceName?: string;
}): Promise<LiveTokenGrant> {
  let model: string;
  try {
    model = resolveLiveVoiceModelName();
  } catch (err) {
    throw new LiveVoiceSetupError(
      "model_blocked",
      err instanceof Error ? err.message : "Blocked voice model"
    );
  }
  const voiceName = opts.voiceName ?? process.env.GEMINI_LIVE_VOICE?.trim();
  const config = buildLiveConnectConfig({
    systemInstruction: opts.systemInstruction,
    voiceName: voiceName || DEFAULT_LIVE_VOICE,
    resumeHandle: opts.resumeHandle,
  });

  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 90 * 1000).toISOString();

  let tokenName: string | undefined;
  try {
    const created = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model,
          config: config as any,
        },
        lockAdditionalFields: [],
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    tokenName = created.name;
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? String((err as { status?: unknown }).status)
        : "unknown";
    throw new LiveVoiceSetupError(
      "token_failed",
      `Live voice token request failed (status ${status}).`
    );
  }
  if (!tokenName) {
    throw new LiveVoiceSetupError(
      "token_failed",
      "Live voice token response was empty."
    );
  }

  return {
    token: tokenName,
    model,
    wsUrl: liveConstrainedSocketUrl(tokenName),
    setup: buildLiveSetupMessage({
      model,
      systemInstruction: opts.systemInstruction,
      voiceName: voiceName || DEFAULT_LIVE_VOICE,
      resumeHandle: opts.resumeHandle,
    }),
    expiresAt: expireTime,
  };
}
