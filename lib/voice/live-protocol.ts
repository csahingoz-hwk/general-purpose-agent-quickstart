/**
 * Shared, dependency-free building blocks for the hands-free Live Voice mode.
 *
 * Runs in the browser (engine + UI) and in Node (unit tests + build self-check),
 * so it must not import server-only modules.
 */

export const LIVE_INPUT_SAMPLE_RATE = 16_000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;
/** 40 ms of 16 kHz mono PCM: 640 samples / 1280 bytes per realtimeInput message. */
export const LIVE_FRAME_SAMPLES = 640;
export const LIVE_FRAME_MS = 40;
export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
export const DEFAULT_GATEWAY_LIVE_MODEL = "google/gemini-3.8-live";
export const DEFAULT_LIVE_VOICE = "Kore";

export type LiveTransportKind = "gateway" | "google-direct";

/** Only Gemini Live voice models are allowed for the speech-to-speech lane. */
export function isAllowedLiveModel(model: string): boolean {
  return /^(google\/)?gemini-\d+(\.\d+)?-live(-[a-z0-9-]+)?$/.test(
    model.trim()
  );
}

export type LiveVadConfig = {
  disabled: false;
  startOfSpeechSensitivity: "START_SENSITIVITY_LOW" | "START_SENSITIVITY_HIGH";
  endOfSpeechSensitivity: "END_SENSITIVITY_LOW" | "END_SENSITIVITY_HIGH";
  prefixPaddingMs: number;
  silenceDurationMs: number;
};

/**
 * Server VAD tuned for a phone speaker in a normal room:
 * - LOW start sensitivity resists background noise and residual echo.
 * - HIGH end sensitivity commits the turn quickly (lower latency).
 * - 300 ms of speech is required before a start is committed.
 * - 550 ms of silence ends the turn.
 */
export const LIVE_VAD: LiveVadConfig = {
  disabled: false,
  startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
  endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
  prefixPaddingMs: 300,
  silenceDurationMs: 550,
};

/** SDK-shaped LiveConnectConfig (used server-side to lock ephemeral tokens). */
export function buildLiveConnectConfig(opts: {
  systemInstruction: string;
  voiceName?: string;
  resumeHandle?: string | null;
}) {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: opts.voiceName ?? DEFAULT_LIVE_VOICE,
        },
      },
    },
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    realtimeInputConfig: {
      automaticActivityDetection: { ...LIVE_VAD },
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
  };
}

/** Raw WebSocket `setup` message body matching the locked token constraints. */
export function buildLiveSetupMessage(opts: {
  model: string;
  systemInstruction: string;
  voiceName?: string;
  resumeHandle?: string | null;
}) {
  const config = buildLiveConnectConfig(opts);
  return {
    setup: {
      model: `models/${opts.model}`,
      generationConfig: {
        responseModalities: config.responseModalities,
        speechConfig: config.speechConfig,
      },
      systemInstruction: config.systemInstruction,
      realtimeInputConfig: config.realtimeInputConfig,
      inputAudioTranscription: config.inputAudioTranscription,
      outputAudioTranscription: config.outputAudioTranscription,
      contextWindowCompression: config.contextWindowCompression,
      sessionResumption: config.sessionResumption,
    },
  };
}

export function liveConstrainedSocketUrl(token: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURI(token)}`;
}

/** Normalized AI Gateway Realtime `session-update` message for Gemini 3.8 Live. */
export function buildGatewayLiveSetupMessage(opts: {
  systemInstruction: string;
  voiceName?: string;
}) {
  return {
    type: "session-update" as const,
    config: {
      instructions: opts.systemInstruction,
      voice: opts.voiceName ?? DEFAULT_LIVE_VOICE,
      outputModalities: ["audio"],
      inputAudioFormat: { type: "audio/pcm", rate: LIVE_INPUT_SAMPLE_RATE },
      outputAudioFormat: { type: "audio/pcm", rate: LIVE_OUTPUT_SAMPLE_RATE },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

export function buildLiveAudioClientMessage(
  transport: LiveTransportKind,
  base64Pcm16k: string
) {
  if (transport === "gateway") {
    return { type: "input-audio-append", audio: base64Pcm16k };
  }
  return {
    realtimeInput: {
      audio: {
        data: base64Pcm16k,
        mimeType: "audio/pcm;rate=16000",
      },
    },
  };
}

export function buildLiveStreamEndMessage(transport: LiveTransportKind) {
  if (transport === "gateway") {
    return { type: "input-audio-commit" };
  }
  return { realtimeInput: { audioStreamEnd: true } };
}

export function buildLiveCancelMessage(transport: LiveTransportKind) {
  return transport === "gateway" ? { type: "response-cancel" } : null;
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const length = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    out[i] = (pcm[i] ?? 0) / 32_768;
  }
  return out;
}

/** Box-filter decimation to 16 kHz (same algorithm as the AudioWorklet). */
export function downsampleTo16k(
  input: Float32Array,
  inputRate: number
): Int16Array {
  const ratio = inputRate / LIVE_INPUT_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  let acc = 0;
  let count = 0;
  let frac = 0;
  let o = 0;
  for (const sample of input) {
    acc += sample;
    count += 1;
    frac += 1;
    if (frac >= ratio && o < outLength) {
      frac -= ratio;
      const v = Math.max(-1, Math.min(1, acc / count));
      out[o] = v < 0 ? v * 0x80_00 : v * 0x7f_ff;
      o += 1;
      acc = 0;
      count = 0;
    }
  }
  return out;
}

export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

// ---------------------------------------------------------------------------
// Echo-aware mic gate
// ---------------------------------------------------------------------------

export type EchoGateDecision = {
  /** Frames to forward, in order (real audio or digital silence). */
  frames: Int16Array[];
  /** True when the user started talking over the assistant. */
  bargeIn: boolean;
  /** True while real mic audio is being forwarded. */
  open: boolean;
};

export type EchoGateOptions = {
  frameMs: number;
  prerollMs: number;
  idleOffsetDb: number;
  idleMinDb: number;
  bargeOffsetDb: number;
  bargeMinDb: number;
  idleMinSpeechMs: number;
  bargeMinSpeechMs: number;
  hangoverMs: number;
};

const DEFAULT_GATE: EchoGateOptions = {
  frameMs: LIVE_FRAME_MS,
  prerollMs: 320,
  idleOffsetDb: 10,
  idleMinDb: -50,
  bargeOffsetDb: 20,
  bargeMinDb: -35,
  idleMinSpeechMs: 80,
  bargeMinSpeechMs: 280,
  hangoverMs: 480,
};

/**
 * Second line of defence after the browser's acoustic echo canceller.
 *
 * - Tracks the room noise floor (falls instantly, rises ~1 dB/s).
 * - While the assistant is silent: opens at floor+10 dB (min -50 dBFS) after
 *   80 ms of speech, keeping a 320 ms pre-roll so first syllables are kept.
 * - While the assistant is audible (incl. a short tail): requires floor+20 dB
 *   (min -35 dBFS) for 280 ms before treating it as a real barge-in.
 * - Closed gate forwards digital silence, so residual speaker echo or room
 *   noise can never be heard by the model as a "user turn".
 * - Adaptive: if an echo leak is detected, the barge-in threshold is raised.
 */
export class EchoGate {
  private readonly opts: EchoGateOptions;
  private floorDb = -62;
  private speechMs = 0;
  private hangMs = 0;
  private openMs = 0;
  private isOpen = false;
  private openedDuringAssistant = false;
  private wasAssistantAudible = false;
  private preroll: Int16Array[] = [];
  private extraBargeDb = 0;

  constructor(options: Partial<EchoGateOptions> = {}) {
    this.opts = { ...DEFAULT_GATE, ...options };
  }

  get noiseFloorDb() {
    return this.floorDb;
  }

  get bargePenaltyDb() {
    return this.extraBargeDb;
  }

  /** Called when the model's input transcript echoes its own last reply. */
  reportEchoLeak() {
    this.extraBargeDb = Math.min(18, this.extraBargeDb + 6);
  }

  /** Slowly relaxes temporary echo penalty after clean turns. */
  decayEchoPenalty() {
    this.extraBargeDb = Math.max(0, this.extraBargeDb - 3);
  }

  reset() {
    this.speechMs = 0;
    this.hangMs = 0;
    this.openMs = 0;
    this.isOpen = false;
    this.openedDuringAssistant = false;
    this.preroll = [];
  }

  thresholdDb(assistantAudible: boolean): number {
    const o = this.opts;
    return assistantAudible
      ? Math.max(this.floorDb + o.bargeOffsetDb, o.bargeMinDb) +
          this.extraBargeDb
      : Math.max(this.floorDb + o.idleOffsetDb, o.idleMinDb);
  }

  process(
    frame: Int16Array,
    rms: number,
    assistantAudible: boolean
  ): EchoGateDecision {
    const o = this.opts;
    const db = rmsToDb(rms);

    // Assistant just started talking: a gate left open by the user's own
    // trailing hangover must not keep forwarding the speaker into the mic.
    if (
      assistantAudible &&
      !this.wasAssistantAudible &&
      this.isOpen &&
      !this.openedDuringAssistant
    ) {
      this.isOpen = false;
      this.speechMs = 0;
      this.hangMs = 0;
      this.openMs = 0;
    }
    this.wasAssistantAudible = assistantAudible;

    if (!this.isOpen && !assistantAudible) {
      if (db < this.floorDb) {
        this.floorDb = db;
      } else {
        this.floorDb += o.frameMs / 1000;
      }
      this.floorDb = Math.min(-30, Math.max(-80, this.floorDb));
    }

    const threshold = this.thresholdDb(assistantAudible);
    const silence = new Int16Array(frame.length);

    if (!this.isOpen) {
      // Leaky integrator: brief inter-syllable consonant dips don't wipe out
      // a genuine barge-in, while isolated knocks/coughs still decay away.
      this.speechMs =
        db >= threshold
          ? this.speechMs + o.frameMs
          : Math.max(0, this.speechMs - o.frameMs);
      this.preroll.push(frame);
      const maxPreroll = Math.max(1, Math.round(o.prerollMs / o.frameMs));
      while (this.preroll.length > maxPreroll) {
        this.preroll.shift();
      }
      const minSpeech = assistantAudible
        ? o.bargeMinSpeechMs
        : o.idleMinSpeechMs;
      if (this.speechMs >= minSpeech) {
        this.isOpen = true;
        this.openedDuringAssistant = assistantAudible;
        this.hangMs = o.hangoverMs;
        this.openMs = o.frameMs;
        const frames = this.preroll;
        this.preroll = [];
        return { frames, bargeIn: assistantAudible, open: true };
      }
      return { frames: [silence], bargeIn: false, open: false };
    }

    // Gate open: forward real audio, close after the hangover.
    this.openMs += o.frameMs;
    if (!assistantAudible && this.openMs > 4000 && db < threshold + 4) {
      // Let the floor adapt slowly if background room noise rose (AC/TV).
      this.floorDb = Math.min(-30, this.floorDb + (o.frameMs / 1000) * 0.5);
    }
    if (db >= threshold - 6) {
      this.hangMs = o.hangoverMs;
    } else {
      this.hangMs -= o.frameMs;
    }
    if (this.hangMs <= 0) {
      this.isOpen = false;
      this.openedDuringAssistant = false;
      this.speechMs = 0;
      this.openMs = 0;
      return { frames: [frame], bargeIn: false, open: false };
    }
    return { frames: [frame], bargeIn: false, open: true };
  }
}

// ---------------------------------------------------------------------------
// Transcript assembly
// ---------------------------------------------------------------------------

export type CommittedLiveTurn = {
  user: string;
  assistant: string;
  interrupted: boolean;
};

/**
 * Turns streamed input/output transcription chunks into committed chat turns.
 * Late input transcription chunks for the current turn still attach to `input`
 * even after assistant audio starts; only words arriving after an actual
 * barge-in (`markBargeIn`) route into `nextInput` for the next turn.
 */
export class LiveTurnAssembler {
  private input = "";
  private nextInput = "";
  private output = "";
  private outputStarted = false;
  private bargedIn = false;

  get userCaption() {
    return (this.bargedIn ? this.nextInput : this.input).trim();
  }

  get assistantCaption() {
    return this.output.trim();
  }

  get hasPendingUser() {
    return (this.bargedIn ? this.nextInput : this.input).trim().length > 0;
  }

  addInput(text: string) {
    if (this.bargedIn) {
      this.nextInput += text;
    } else {
      this.input += text;
    }
  }

  addOutput(text: string) {
    this.outputStarted = true;
    this.output += text;
  }

  markOutputStarted() {
    this.outputStarted = true;
  }

  markBargeIn() {
    if (this.outputStarted) {
      this.bargedIn = true;
    }
  }

  commit(interrupted: boolean): CommittedLiveTurn | null {
    const turn = {
      user: normalizeTranscript(this.input),
      assistant: normalizeTranscript(this.output),
      interrupted,
    };
    this.input = this.nextInput;
    this.nextInput = "";
    this.output = "";
    this.outputStarted = false;
    this.bargedIn = false;
    if (!turn.user && !turn.assistant) {
      return null;
    }
    return turn;
  }
}

export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

/**
 * Share of the user's words that also appear in the assistant's last reply.
 * A high score on a short "user" turn means the speaker leaked into the mic.
 */
export function echoSimilarity(userText: string, assistantText: string) {
  const user = wordSet(userText);
  const assistant = wordSet(assistantText);
  if (user.size === 0 || assistant.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const w of user) {
    if (assistant.has(w)) {
      shared += 1;
    }
  }
  return shared / user.size;
}

// ---------------------------------------------------------------------------
// Server message parsing
// ---------------------------------------------------------------------------

export type LiveServerEvent =
  | { type: "setup-complete" }
  | { type: "audio"; data: string }
  | { type: "input-transcript"; text: string }
  | { type: "output-transcript"; text: string }
  | { type: "speech-started" }
  | { type: "interrupted" }
  | { type: "turn-complete" }
  | { type: "generation-complete" }
  | { type: "resumption"; handle: string }
  | { type: "go-away"; timeLeftMs: number }
  | { type: "error"; message: string };

type RawGoogleMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
    };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
  };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  goAway?: { timeLeft?: string };
  error?: { message?: string };
};

type RawGatewayMessage = {
  type: string;
  delta?: string;
  transcript?: string;
  speaker?: "user" | "assistant";
  message?: string;
  rawType?: string;
  raw?: RawGoogleMessage;
};

function parseDurationMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = value.match(/^([\d.]+)s$/);
  return match ? Math.round(Number.parseFloat(match[1] ?? "0") * 1000) : 0;
}

function parseGatewayMessage(msg: RawGatewayMessage): LiveServerEvent[] {
  switch (msg.type) {
    case "session-created":
    case "session-updated":
      return [{ type: "setup-complete" }];
    case "audio-delta":
    case "audio-chunk":
      return msg.delta ? [{ type: "audio", data: msg.delta }] : [];
    case "audio-transcript-delta":
      return msg.delta ? [{ type: "output-transcript", text: msg.delta }] : [];
    case "transcript-fragment":
      if (!msg.delta) {
        return [];
      }
      return [
        {
          type:
            msg.speaker === "user" ? "input-transcript" : "output-transcript",
          text: msg.delta,
        },
      ];
    case "input-transcription-completed":
      return msg.transcript
        ? [{ type: "input-transcript", text: msg.transcript }]
        : [];
    case "speech-started":
      return [{ type: "speech-started" }];
    case "response-done":
      return [{ type: "turn-complete" }];
    case "error":
      return msg.message ? [{ type: "error", message: msg.message }] : [];
    case "custom": {
      const events: LiveServerEvent[] = [];
      const raw = msg.raw;
      if (raw?.serverContent?.interrupted) {
        events.push({ type: "interrupted" });
      }
      if (raw?.serverContent?.generationComplete) {
        events.push({ type: "generation-complete" });
      }
      if (
        raw?.sessionResumptionUpdate?.resumable &&
        raw.sessionResumptionUpdate.newHandle
      ) {
        events.push({
          type: "resumption",
          handle: raw.sessionResumptionUpdate.newHandle,
        });
      }
      if (raw?.goAway) {
        events.push({
          type: "go-away",
          timeLeftMs: parseDurationMs(raw.goAway.timeLeft),
        });
      }
      return events;
    }
    default:
      return [];
  }
}

/** Splits one server frame into ordered events (supports AI Gateway & Google Direct). */
export function parseLiveServerMessage(raw: string): LiveServerEvent[] {
  let parsed: RawGoogleMessage & Partial<RawGatewayMessage>;
  try {
    parsed = JSON.parse(raw) as RawGoogleMessage & Partial<RawGatewayMessage>;
  } catch {
    return [];
  }
  if (typeof parsed.type === "string") {
    return parseGatewayMessage(parsed as RawGatewayMessage);
  }
  const msg = parsed;
  const events: LiveServerEvent[] = [];
  if (msg.setupComplete !== undefined) {
    events.push({ type: "setup-complete" });
  }
  const content = msg.serverContent;
  if (content) {
    if (content.interrupted) {
      events.push({ type: "interrupted" });
    }
    if (content.inputTranscription?.text) {
      events.push({
        type: "input-transcript",
        text: content.inputTranscription.text,
      });
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        events.push({ type: "audio", data: part.inlineData.data });
      }
    }
    if (content.outputTranscription?.text) {
      events.push({
        type: "output-transcript",
        text: content.outputTranscription.text,
      });
    }
    if (content.generationComplete) {
      events.push({ type: "generation-complete" });
    }
    if (content.turnComplete) {
      events.push({ type: "turn-complete" });
    }
  }
  if (
    msg.sessionResumptionUpdate?.resumable &&
    msg.sessionResumptionUpdate.newHandle
  ) {
    events.push({
      type: "resumption",
      handle: msg.sessionResumptionUpdate.newHandle,
    });
  }
  if (msg.goAway) {
    events.push({
      type: "go-away",
      timeLeftMs: parseDurationMs(msg.goAway.timeLeft),
    });
  }
  if (msg.error?.message) {
    events.push({ type: "error", message: msg.error.message });
  }
  return events;
}
