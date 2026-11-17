import { GoogleGenAI } from "@google/genai";
import { gateway } from "ai";
import { gatewayEnabled } from "@/lib/ai/routing/catalog";
import {
  createPostgresVaultStore,
  isVaultConfigured,
} from "@/lib/vault/secret-vault";
import {
  buildGatewayLiveSetupMessage,
  buildLiveConnectConfig,
  buildLiveSetupMessage,
  DEFAULT_LIVE_VOICE,
  LIVE_VOICE_TOOL_DECLARATIONS,
  type LiveToolDeclaration,
  type LiveTransportKind,
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
  ownerName?: string;
  timeZone?: string;
  teammate?: { name: string; soul: string } | null;
  facts?: string[];
  recentTurns?: Array<{ role: "user" | "assistant"; text: string }>;
}): string {
  const ownerName = opts.ownerName?.trim() || "Çağlar";
  const timeZone = opts.timeZone?.trim() || "Europe/London";
  const now = new Date();
  let localTime = now.toISOString();
  try {
    localTime = now.toLocaleString("en-GB", {
      timeZone,
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    /* keep ISO */
  }
  const lines = [
    `You are ${ownerName}'s personal assistant in a live, hands-free voice conversation.`,
    `Owner name: ${ownerName}. Default home timezone: Europe/London. Current local time: ${localTime} (${timeZone}).`,
    "Speak like a warm, sharp human operator on a phone call: natural, concise, usually one to three sentences. Offer more detail only when asked.",
    "Always reply in the exact language the owner is speaking (English or Turkish), and switch instantly if they switch.",
    "You have real live tools connected right now: Gmail (gmailReadMessages), Google Calendar (calendarReadEvents), Google Drive (driveReadFiles), Weather via Open-Meteo (getWeather, defaulting to London if no city is named), Web Search (webSearch), Football Fixtures (getFixtures), Memory (recallMemories, saveProfileFact, addJournalEntry), Routines (listMySchedules, scheduleTask), Approval-gated Drafts (gmailCreateDraft, calendarCreateDraftEvent, driveCreateDraftDoc, draftOutboundMessage), and Delegated Tasks (delegateTask).",
    "NEVER say 'I don't have access', 'I can't access your personal email', or 'I can't check the weather'. Always call the matching tool.",
    "Right as you call any tool, speak a short natural filler in the owner's current language (for example: 'Checking your inbox…', 'Checking the weather…', 'Gelen kutuna bakıyorum…', 'Hava durumuna bakıyorum…'), then speak the answer naturally as soon as the tool result arrives.",
    "If a connector tool returns status 'setup_required', tell the owner in ONE short sentence that their Google (or GitHub) account isn't connected yet and they can tap the Connect button you just placed in the chat. Never say 'I don't have access'.",
    "If a write, send, draft, or destructive tool returns status 'awaiting_approval', tell the owner in ONE short sentence that an approval card is ready in the chat so they can tap Allow before anything runs.",
    "Never read out markdown, JSON, raw symbols, or URLs. Say numbers and dates the way people speak them.",
    "If you did not clearly hear something, say so briefly and ask the owner to repeat it. Never guess words the owner did not say.",
    "This is a personal assistant. If the owner starts discussing employer-confidential or Korn Ferry work material, politely say in one sentence that work data can't be handled in personal voice mode.",
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
  transport: LiveTransportKind;
  token: string;
  model: string;
  wsUrl: string;
  protocols?: string[];
  setup:
    | ReturnType<typeof buildLiveSetupMessage>
    | ReturnType<typeof buildGatewayLiveSetupMessage>;
  expiresAt: string;
};

/**
 * Mints a zero-key Vercel AI Gateway realtime grant for `google/gemini-3.8-live`
 * (using `vcst_` client secret when `AI_GATEWAY_API_KEY` is set, or Vercel OIDC
 * on Preview/Production), falling back to a single-use Google Direct ephemeral
 * token when AI Gateway is disabled and a personal `GEMINI_API_KEY` is present.
 */
export async function mintLiveVoiceToken(opts: {
  apiKey?: string | null;
  preferGateway?: boolean;
  systemInstruction: string;
  resumeHandle?: string | null;
  voiceName?: string;
  tools?: readonly LiveToolDeclaration[];
}): Promise<LiveTokenGrant> {
  const tools = opts.tools ?? LIVE_VOICE_TOOL_DECLARATIONS;
  let baseModel: string;
  try {
    baseModel = resolveLiveVoiceModelName().replace(/^google\//, "");
  } catch (err) {
    throw new LiveVoiceSetupError(
      "model_blocked",
      err instanceof Error ? err.message : "Blocked voice model"
    );
  }
  const voiceName =
    opts.voiceName ??
    (process.env.GEMINI_LIVE_VOICE?.trim() || DEFAULT_LIVE_VOICE);

  if (opts.preferGateway ?? gatewayEnabled()) {
    const gatewayModel = `google/${baseModel}`;
    try {
      let token = "";
      let wsUrl = "";
      let expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      try {
        const secret = await gateway.experimental_realtime.getToken({
          model: gatewayModel,
        });
        token = secret.token;
        wsUrl = secret.url;
        if (secret.expiresAt) {
          expiresAt = String(secret.expiresAt);
        }
      } catch {
        // Vercel OIDC deployment mode: use short-lived OIDC subprotocol auth.
        const rtModel = gateway.experimental_realtime(
          gatewayModel
        ) as unknown as {
          getServerWebSocketConfig: () => Promise<{
            url: string;
            headers: Record<string, string>;
          }>;
        };
        const serverCfg = await rtModel.getServerWebSocketConfig();
        const rawAuth =
          serverCfg.headers.authorization ??
          serverCfg.headers.Authorization ??
          "";
        token = rawAuth.replace(/^Bearer\s+/i, "").trim();
        wsUrl = serverCfg.url;
      }
      if (token && wsUrl) {
        return {
          transport: "gateway",
          token,
          model: gatewayModel,
          wsUrl,
          protocols: ["ai-gateway-realtime-v1", `ai-gateway-auth.${token}`],
          setup: buildGatewayLiveSetupMessage({
            systemInstruction: opts.systemInstruction,
            voiceName,
            tools,
          }),
          expiresAt,
        };
      }
    } catch {
      if (!opts.apiKey) {
        throw new LiveVoiceSetupError(
          "token_failed",
          "Live voice couldn't connect right now. Please try again in a moment."
        );
      }
    }
  }

  if (!opts.apiKey) {
    throw new LiveVoiceSetupError(
      "key_missing",
      "Live voice isn't active yet. Open Setup to check connection status."
    );
  }

  const config = buildLiveConnectConfig({
    systemInstruction: opts.systemInstruction,
    voiceName,
    resumeHandle: opts.resumeHandle,
    tools,
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
          model: baseModel,
          config: config as any,
        },
        lockAdditionalFields: [],
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    tokenName = created.name;
  } catch {
    throw new LiveVoiceSetupError(
      "token_failed",
      "Live voice couldn't connect right now. Please try again in a moment."
    );
  }
  if (!tokenName) {
    throw new LiveVoiceSetupError(
      "token_failed",
      "Live voice token response was empty."
    );
  }

  return {
    transport: "google-direct",
    token: tokenName,
    model: baseModel,
    wsUrl: liveConstrainedSocketUrl(tokenName),
    setup: buildLiveSetupMessage({
      model: baseModel,
      systemInstruction: opts.systemInstruction,
      voiceName,
      resumeHandle: opts.resumeHandle,
      tools,
    }),
    expiresAt: expireTime,
  };
}
