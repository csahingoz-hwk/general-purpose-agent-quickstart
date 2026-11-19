import { GoogleGenAI } from "@google/genai";
import {
  type CapabilityManifest,
  formatCapabilityManifestPrompt,
} from "@/lib/ai/capability-manifest";
import { vertexEnabled } from "@/lib/ai/routing/catalog";
import {
  getVertexProjectId,
  getVertexWifAccessToken,
} from "@/lib/ai/vertex-auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  formatKickoffLocal,
  formatTimeZoneLabel,
  resolveFixtureTimeZone,
  TURKEY_TIME_ZONE,
} from "@/lib/fixtures";
import { validTimeZone } from "@/lib/temporal";
import {
  createPostgresVaultStore,
  isVaultConfigured,
} from "@/lib/vault/secret-vault";
import {
  type buildGatewayLiveSetupMessage,
  buildLiveConnectConfig,
  buildLiveSetupMessage,
  DEFAULT_LIVE_VOICE,
  isFillerOnlyUtterance,
  LIVE_VOICE_TOOL_DECLARATIONS,
  type LiveToolDeclaration,
  type LiveTransportKind,
  liveConstrainedSocketUrl,
  vertexLiveSocketUrl,
} from "./live-protocol";
import {
  resolveLiveVoiceModelName,
  VOICE_VAULT_SECRET_NAMES,
} from "./voice-service";

export type VoiceRecentTurn = {
  role: "user" | "assistant";
  text: string;
};

export type StoredVoiceMessageRow = {
  role: string;
  parts: unknown;
};

const DEFAULT_RECENT_ROWS = 20;
const DEFAULT_RECENT_MAX_CHARS = 6000;
const DEFAULT_RECENT_PER_TURN_CHARS = 900;

function cleanContextText(value: string): string {
  return value
    .replace(/<\/?untrusted_content\b[^>]*>/gi, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeToolPartForVoiceContext(
  part: Record<string, unknown>,
  fallbackTimeZone?: string
): string | null {
  if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
    return null;
  }
  if (part.state === "input-available") {
    return null;
  }
  const toolName = part.type.slice(5);
  const input =
    part.input && typeof part.input === "object"
      ? (part.input as Record<string, unknown>)
      : {};
  const output = part.output;
  if (!output || typeof output !== "object") {
    return null;
  }
  const out = output as Record<string, unknown>;

  if (toolName === "webSearch") {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (out.searchUnavailable === true) {
      return `[webSearch${query ? ` "${query}"` : ""}] search unavailable`;
    }
    const results = Array.isArray(out.results)
      ? (out.results as Record<string, unknown>[])
      : [];
    const titles = results
      .slice(0, 4)
      .map((r) => (typeof r?.title === "string" ? r.title.trim() : ""))
      .filter(Boolean);
    const rawSummary =
      typeof out.summary === "string" && out.summary.trim()
        ? cleanContextText(out.summary)
        : cleanContextText(
            results
              .slice(0, 3)
              .map((r) =>
                typeof r?.snippet === "string" ? r.snippet.trim() : ""
              )
              .filter(Boolean)
              .join(" ")
          );
    const trimmedSummary = rawSummary.slice(0, 300).trim();
    if (titles.length === 0 && !trimmedSummary) {
      return `[webSearch${query ? ` "${query}"` : ""}] no results`;
    }
    const titlePart = titles.length > 0 ? ` Sources: ${titles.join(", ")}` : "";
    const summaryPart = trimmedSummary ? ` — ${trimmedSummary}` : "";
    return `[webSearch${query ? ` "${query}"` : ""}]${titlePart}${summaryPart}`.trim();
  }

  if (toolName === "getFixtures") {
    const teamInput = typeof input.team === "string" ? input.team.trim() : "";
    if (typeof out.error === "string") {
      return `[getFixtures ${teamInput || String(out.team ?? "")}] ${out.error}`.trim();
    }
    const teamObj =
      out.team && typeof out.team === "object"
        ? (out.team as { name?: string })
        : null;
    const teamName = teamObj?.name?.trim() || teamInput || "club";
    const competitions = Array.isArray(out.competitions)
      ? (out.competitions as unknown[]).filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0
        )
      : [];
    const tz =
      validTimeZone(out.timeZone) ??
      validTimeZone(fallbackTimeZone) ??
      resolveFixtureTimeZone({ teamName, competitions });
    const tzLabel =
      typeof out.kickoffTimeZone === "string" && out.kickoffTimeZone.trim()
        ? out.kickoffTimeZone.trim()
        : formatTimeZoneLabel(tz);
    const upcoming = Array.isArray(out.upcoming)
      ? (out.upcoming as Record<string, unknown>[])
      : [];
    const matchStrings = upcoming.slice(0, 3).map((m) => {
      const home =
        m.home && typeof m.home === "object"
          ? String((m.home as { name?: unknown }).name ?? "?")
          : "?";
      const away =
        m.away && typeof m.away === "object"
          ? String((m.away as { name?: unknown }).name ?? "?")
          : "?";
      const local =
        (typeof m.kickoffLocal === "string" && m.kickoffLocal.trim()) ||
        (typeof m.kickoffUtc === "string"
          ? formatKickoffLocal(
              m.kickoffUtc,
              tz,
              tz === TURKEY_TIME_ZONE ? "tr" : "en"
            )
          : null) ||
        "";
      const matchTz =
        typeof m.kickoffTimeZone === "string" && m.kickoffTimeZone.trim()
          ? m.kickoffTimeZone.trim()
          : tzLabel;
      const comp =
        typeof m.competition === "string" && m.competition.trim()
          ? `, ${m.competition.trim()}`
          : "";
      return `${home} vs ${away}${local ? ` (${local} ${matchTz}${comp})` : ""}`;
    });
    const compSuffix =
      competitions.length > 0
        ? ` | Competitions: ${competitions.join(", ")}`
        : "";
    return `[getFixtures ${teamName}] Next: ${matchStrings.length > 0 ? matchStrings.join("; ") : "none"}${compSuffix}`;
  }

  if (toolName === "getWeather") {
    const city =
      typeof out.cityName === "string" && out.cityName.trim()
        ? out.cityName.trim()
        : typeof input.city === "string"
          ? input.city.trim()
          : "weather";
    const cur =
      out.current && typeof out.current === "object"
        ? (out.current as { temperature_2m?: unknown })
        : null;
    const units =
      out.current_units && typeof out.current_units === "object"
        ? (out.current_units as { temperature_2m?: unknown })
        : null;
    if (cur?.temperature_2m !== undefined) {
      return `[getWeather ${city}] ${String(cur.temperature_2m)}${String(units?.temperature_2m ?? "°C")}`;
    }
    return null;
  }

  if (toolName === "handOffToTextAgent") {
    const spoken =
      typeof out.spokenSummary === "string"
        ? cleanContextText(out.spokenSummary).slice(0, 260)
        : "";
    return spoken ? `[handOffToTextAgent] ${spoken}` : null;
  }

  if (toolName === "saveProfileFact" || toolName === "addJournalEntry") {
    if (out.saved === true) {
      const factVal =
        out.fact && typeof out.fact === "object"
          ? String((out.fact as { value?: unknown }).value ?? "")
          : String(input.value ?? input.title ?? "");
      const cleaned = cleanContextText(factVal).slice(0, 180);
      return cleaned ? `[memory saved] ${cleaned}` : null;
    }
    return null;
  }

  if (out.status === "setup_required") {
    return `[${toolName}] setup_required`;
  }
  if (typeof out.count === "number") {
    return `[${toolName}] ${out.count} items`;
  }
  if (typeof out.summary === "string" && out.summary.trim()) {
    return `[${toolName}] ${cleanContextText(out.summary).slice(0, 240)}`;
  }
  return null;
}

/**
 * Builds compact recent conversation turns from persisted DB message rows:
 * - Scans the last `maxRows` (default 20) rows
 * - Skips filler-only assistant utterances
 * - Includes compact one-line summaries of tool outputs (webSearch, getFixtures, etc.)
 * - Drops employer-restricted work data
 * - Caps total rendered size to `maxChars` (default 6000), preserving the newest turns.
 */
export function buildCompactVoiceRecentTurns(
  rows: readonly StoredVoiceMessageRow[],
  opts?: {
    maxRows?: number;
    maxChars?: number;
    maxPerTurnChars?: number;
    timeZone?: string;
  }
): VoiceRecentTurn[] {
  const maxRows = opts?.maxRows ?? DEFAULT_RECENT_ROWS;
  const maxChars = opts?.maxChars ?? DEFAULT_RECENT_MAX_CHARS;
  const maxPerTurnChars =
    opts?.maxPerTurnChars ?? DEFAULT_RECENT_PER_TURN_CHARS;

  const candidates: VoiceRecentTurn[] = [];
  for (const row of rows.slice(-maxRows)) {
    const role: "user" | "assistant" =
      row.role === "assistant" ? "assistant" : "user";
    const parts = Array.isArray(row.parts)
      ? (row.parts as Record<string, unknown>[])
      : [];

    const textSegments: string[] = [];
    const toolSegments: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      if (part.type === "text" && typeof part.text === "string") {
        const cleaned = cleanContextText(part.text);
        if (!cleaned) {
          continue;
        }
        if (role === "assistant" && isFillerOnlyUtterance(cleaned)) {
          continue;
        }
        textSegments.push(cleaned);
      } else if (
        typeof part.type === "string" &&
        part.type.startsWith("tool-")
      ) {
        const toolSummary = summarizeToolPartForVoiceContext(
          part,
          opts?.timeZone
        );
        if (toolSummary) {
          const cleanedSummary = cleanContextText(toolSummary);
          if (cleanedSummary) {
            toolSegments.push(cleanedSummary);
          }
        }
      }
    }

    const joinedText = textSegments.join(" ").trim();
    const combined = [...toolSegments, ...(joinedText ? [joinedText] : [])]
      .join(" | ")
      .slice(0, maxPerTurnChars)
      .trim();

    if (!combined || containsRestrictedWorkData(combined)) {
      continue;
    }
    candidates.push({ role, text: combined });
  }

  return capVoiceRecentTurns(candidates, {
    maxTurns: maxRows,
    maxChars,
    maxPerTurnChars,
  });
}

function capVoiceRecentTurns(
  turns: readonly VoiceRecentTurn[],
  opts?: {
    maxTurns?: number;
    maxChars?: number;
    maxPerTurnChars?: number;
  }
): VoiceRecentTurn[] {
  const maxTurns = opts?.maxTurns ?? DEFAULT_RECENT_ROWS;
  const maxChars = opts?.maxChars ?? DEFAULT_RECENT_MAX_CHARS;
  const maxPerTurnChars =
    opts?.maxPerTurnChars ?? DEFAULT_RECENT_PER_TURN_CHARS;

  const sanitized: VoiceRecentTurn[] = [];
  for (const turn of turns.slice(-maxTurns)) {
    const text = cleanContextText(turn.text).slice(0, maxPerTurnChars).trim();
    if (!text) {
      continue;
    }
    if (turn.role === "assistant" && isFillerOnlyUtterance(text)) {
      continue;
    }
    if (containsRestrictedWorkData(text)) {
      continue;
    }
    sanitized.push({ role: turn.role, text });
  }

  const keptReversed: VoiceRecentTurn[] = [];
  let totalChars = 0;
  for (let i = sanitized.length - 1; i >= 0; i -= 1) {
    const turn = sanitized[i];
    if (!turn) {
      continue;
    }
    const prefixLen = turn.role === "user" ? 7 : 5; // "Owner: " vs "You: "
    const lineCost = prefixLen + turn.text.length + 1;
    if (totalChars + lineCost <= maxChars) {
      keptReversed.push(turn);
      totalChars += lineCost;
    } else if (keptReversed.length === 0) {
      const avail = Math.max(40, maxChars - prefixLen - 1);
      keptReversed.push({ role: turn.role, text: turn.text.slice(0, avail) });
      break;
    } else {
      break;
    }
  }
  return keptReversed.reverse();
}

export function formatVoiceRecentContextBlock(
  turns: readonly VoiceRecentTurn[] | undefined,
  opts?: {
    maxTurns?: number;
    maxChars?: number;
  }
): string {
  if (!turns || turns.length === 0) {
    return "";
  }
  const kept = capVoiceRecentTurns(turns, opts);
  if (kept.length === 0) {
    return "";
  }
  return [
    "Recent conversation in this chat (continue naturally from it):",
    ...kept.map((t) => `${t.role === "user" ? "Owner" : "You"}: ${t.text}`),
  ].join("\n");
}

export function resolveLiveSessionTimeZone(
  requestedTimeZone?: string | null,
  homeTimeZone?: string | null
): string {
  return (
    validTimeZone(requestedTimeZone) ??
    validTimeZone(homeTimeZone) ??
    "Europe/London"
  );
}

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
  now?: Date;
  teammate?: { name: string; soul: string } | null;
  facts?: string[];
  groupedMemoryBlock?: string;
  capabilityManifest?: CapabilityManifest;
  recentTurns?: VoiceRecentTurn[];
}): string {
  const ownerName = opts.ownerName?.trim() || "Çağlar";
  const timeZone = resolveLiveSessionTimeZone(opts.timeZone);
  const now = opts.now ?? new Date();
  const zoneLabel = formatTimeZoneLabel(timeZone, now);
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
    `Owner name: ${ownerName}. User time zone: ${zoneLabel}. Current local time: ${localTime} (${timeZone}).`,
    "Speak like a warm, sharp human operator on a phone call: natural, concise, usually one to three sentences. Offer more detail only when asked.",
    "Always reply in the exact language the owner is speaking (English or Turkish), and switch instantly if they switch.",
    "You have real live tools connected right now, including handOffToTextAgent (hands inbox, email drafts, calendar, Drive, and multi-step requests to the exact same text agent and returns the spoken result), Gmail (gmailReadMessages), Google Calendar (calendarReadEvents), Google Drive (driveReadFiles), Weather via Open-Meteo (getWeather, defaulting to London if no city is named), Web Search (webSearch), Football Fixtures (getFixtures), Memory (recallMemories, saveProfileFact, addJournalEntry), Routines (listMySchedules, scheduleTask), Approval-gated Drafts (gmailCreateDraft, calendarCreateDraftEvent, driveCreateDraftDoc, draftOutboundMessage), and Delegated Tasks (delegateTask).",
    "Prefer calling handOffToTextAgent whenever the owner asks for real inbox, email draft, calendar, or multi-step work (for example: checking a recent email and drafting a reply, or checking tomorrow's schedule and creating an event), then speak its returned spokenSummary naturally in the owner's language.",
    "NEVER say 'I don't have access', 'I can't access your personal email', or 'I can't check the weather'. Always call the matching tool.",
    "For league-wide fixtures, schedules, or standings (for example Süper Lig this week), or for European competitions (Champions League, Europa League, Conference League), domestic cups, and national teams, use webSearch with the exact club/league/competition name verbatim in the owner's language; getFixtures is only for a single club's domestic league schedule. Never switch to or answer about a different league, team, or topic than the owner asked. If a search fails or returns empty, say so in one short sentence and offer to retry — never substitute another topic.",
    "When getFixtures and web sources disagree, or a competition (such as Champions League, Europa/Conference League, or cup) is missing from getFixtures, trust the web sources for European and cup matches. NEVER deny or contradict something you stated earlier in the conversation without re-checking with webSearch first; if a re-check still disagrees, say plainly which source says what.",
    `Always state kickoff times and other clock times in the user's local time zone (${zoneLabel}) and name the zone aloud (for example 'Türkiye saatiyle' for Europe/Istanbul or 'London time' for Europe/London); never give raw UTC times to the user. When web sources give a time in another time zone (such as UTC, GMT, or CET), convert it to ${timeZone} before speaking.`,
    "Right as you call any tool, speak a short natural filler in the owner's current language (for example: 'Checking your inbox…', 'Checking the weather…', 'Gelen kutuna bakıyorum…', 'Hava durumuna bakıyorum…'), then speak the answer naturally as soon as the tool result arrives.",
    "Whenever the owner says 'remember this: …', 'remember that …', 'bunu hatırla: …', or 'unutma: …', immediately call saveProfileFact so a 'Saved to memory' card appears in the chat. Never store passwords, card numbers, or physical street addresses in memory — warn the owner if they mention one.",
    "If a connector tool returns status 'setup_required', tell the owner in ONE short sentence that their Google (or GitHub) account isn't connected yet and they can tap the Connect button you just placed in the chat. If status is 'connector_error' with code 'service_disabled', say ONLY a short neutral sentence ('Gmail şu an kullanılamıyor, kurulum kontrol ediliyor') — NEVER mention Google Cloud Console or say the account isn't connected. Never say 'I don't have access'.",
    "If a write, send, draft, or destructive tool returns status 'awaiting_approval', tell the owner in ONE short sentence that an approval card is ready in the chat so they can tap Allow before anything runs.",
    "Never read out markdown, JSON, raw symbols, or URLs. Say numbers and dates the way people speak them.",
    "If you did not clearly hear something, say so briefly and ask the owner to repeat it. Never guess words the owner did not say. If a heard club or competition name seems implausible in context and sounds close to one discussed earlier (for example 'Schalke Dortmund' right after discussing 'Shakhtar Donetsk'), interpret it as the club discussed earlier and confirm briefly.",
    "This is a personal assistant. If the owner starts discussing employer-confidential or Korn Ferry work material, politely say in one sentence that work data can't be handled in personal voice mode.",
  ];
  if (opts.capabilityManifest) {
    lines.push(formatCapabilityManifestPrompt(opts.capabilityManifest));
  }
  if (opts.teammate) {
    lines.push(
      `Active specialist role: ${opts.teammate.name}.`,
      opts.teammate.soul.slice(0, 1200)
    );
  }
  if (opts.groupedMemoryBlock?.trim()) {
    lines.push(opts.groupedMemoryBlock.trim());
  } else if (opts.facts && opts.facts.length > 0) {
    lines.push(
      "Owner long-term memory facts (apply naturally in this voice session):",
      ...opts.facts.slice(0, 80).map((f) => `- ${f.slice(0, 260)}`)
    );
  }
  const recentBlock = formatVoiceRecentContextBlock(opts.recentTurns, {
    maxTurns: DEFAULT_RECENT_ROWS,
    maxChars: DEFAULT_RECENT_MAX_CHARS,
  });
  if (recentBlock) {
    lines.push(recentBlock);
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
 * Mints a zero-key Google Cloud Vertex AI `BidiGenerateContent` grant for
 * `gemini-3.8-live` via Workload Identity Federation (`0140A2-72DEB2-62EDCD`
 * Google AI Ultra Cloud credit — zero paid AI Gateway credits).
 * Falls back to a single-use Google Direct ephemeral token only when Vertex WIF
 * is absent and an explicit `GEMINI_API_KEY` is provided.
 */
export async function mintLiveVoiceToken(opts: {
  apiKey?: string | null;
  preferVertex?: boolean;
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

  if (opts.preferVertex ?? vertexEnabled()) {
    const projectId = getVertexProjectId();
    if (projectId) {
      try {
        const accessToken = await getVertexWifAccessToken();
        const vertexModel = `projects/${projectId}/locations/us-central1/publishers/google/models/${baseModel}`;
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        return {
          transport: "google-direct",
          token: accessToken,
          model: baseModel,
          wsUrl: vertexLiveSocketUrl(accessToken),
          setup: buildLiveSetupMessage({
            model: vertexModel,
            systemInstruction: opts.systemInstruction,
            voiceName,
            resumeHandle: opts.resumeHandle,
            tools,
          }),
          expiresAt,
        };
      } catch {
        if (!opts.apiKey) {
          throw new LiveVoiceSetupError(
            "token_failed",
            "Live voice couldn't connect to Vertex AI right now. Please try again in a moment."
          );
        }
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
