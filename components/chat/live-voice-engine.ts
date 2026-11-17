"use client";

import {
  base64ToInt16,
  buildLiveAudioClientMessage,
  buildLiveCancelMessage,
  buildLiveStreamEndMessage,
  type CommittedLiveTurn,
  EchoGate,
  echoSimilarity,
  int16ToBase64,
  LIVE_FRAME_MS,
  LIVE_FRAME_SAMPLES,
  LIVE_OUTPUT_SAMPLE_RATE,
  type LiveTransportKind,
  LiveTurnAssembler,
  parseLiveServerMessage,
  pcm16ToFloat32,
} from "@/lib/voice/live-protocol";

export type LivePhase =
  | "connecting"
  | "listening"
  | "user-speaking"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "paused"
  | "error"
  | "ended";

export type LiveEngineCallbacks = {
  onPhase: (phase: LivePhase) => void;
  onCaptions: (captions: { user: string; assistant: string }) => void;
  onLevel: (level: number) => void;
  onTurn: (turn: CommittedLiveTurn) => void;
  onError: (message: string) => void;
};

type TokenGrant = {
  status: "ready";
  transport?: LiveTransportKind;
  token: string;
  wsUrl: string;
  protocols?: string[];
  model: string;
  setup: unknown;
};

/** AudioWorklet: default-rate mic → 16 kHz Int16 frames of 40 ms + RMS. */
const CAPTURE_WORKLET = `
class PcmCapture16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0; this.n = 0; this.frac = 0;
    this.buf = new Int16Array(${LIVE_FRAME_SAMPLES});
    this.idx = 0; this.sumSq = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.frac += 1;
      if (this.frac >= this.ratio) {
        this.frac -= this.ratio;
        let v = this.acc / this.n; this.acc = 0; this.n = 0;
        if (v > 1) v = 1; else if (v < -1) v = -1;
        this.buf[this.idx++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.sumSq += v * v;
        if (this.idx === ${LIVE_FRAME_SAMPLES}) {
          const rms = Math.sqrt(this.sumSq / ${LIVE_FRAME_SAMPLES});
          this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
          this.buf = new Int16Array(${LIVE_FRAME_SAMPLES});
          this.idx = 0; this.sumSq = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture-16k", PcmCapture16k);
`;

const TOKEN_CACHE_MS = 45_000;
let prefetched: {
  key: string;
  at: number;
  promise: Promise<TokenGrant>;
} | null = null;

function setAudioSessionType(type: "play-and-record" | "playback" | "auto") {
  const nav = navigator as unknown as { audioSession?: { type?: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = type;
    } catch {
      /* unsupported */
    }
  }
}

async function requestToken(
  basePath: string,
  body: Record<string, unknown>
): Promise<TokenGrant> {
  const res = await fetch(`${basePath}/api/voice/live-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenGrant> & {
    message?: string;
  };
  if (!res.ok || data.status !== "ready" || !data.wsUrl) {
    throw new Error(data.message ?? "Live voice could not start right now.");
  }
  return data as TokenGrant;
}

/**
 * Hands-free speech-to-speech session over the Gemini Live API.
 *
 * Defences against self-hearing loops (in order):
 *  1. Browser/OS acoustic echo cancellation (echoCancellation + play-and-record).
 *  2. A single Web Audio output graph so the AEC has one clean reference.
 *  3. EchoGate: digital silence is forwarded unless real speech is detected;
 *     a much stricter threshold + 280 ms of speech is required while the
 *     assistant is audible (plus a 450 ms tail).
 *  4. Server VAD tuned to LOW start sensitivity.
 *  5. Adaptive penalty when an input transcript repeats the last reply.
 */
export class LiveVoiceEngine {
  private readonly basePath: string;
  private readonly cb: LiveEngineCallbacks;
  private readonly sessionBody: Record<string, unknown>;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private ws: WebSocket | null = null;
  private wakeLock: { release: () => Promise<void> } | null = null;

  private readonly gate = new EchoGate();
  private readonly turns = new LiveTurnAssembler();
  private phase: LivePhase = "connecting";
  private transport: LiveTransportKind = "google-direct";
  private ready = false;
  private muted = false;
  private stopped = false;
  private resumeHandle: string | null = null;
  private reconnectAttempts = 0;
  private reconnecting = false;

  private turnGain: GainNode | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private dropStaleAudio = false;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private goAwayTimer: ReturnType<typeof setTimeout> | null = null;
  private goAwayPending = false;
  private userOverlappedAssistant = false;
  private lastAssistantText = "";
  private activeAssistantCaption = "";
  private turnCompleteReceived = true;

  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden" && !this.stopped) {
      this.pause();
    }
  };

  constructor(opts: {
    basePath: string;
    sessionBody: Record<string, unknown>;
    callbacks: LiveEngineCallbacks;
  }) {
    this.basePath = opts.basePath;
    this.sessionBody = opts.sessionBody;
    this.cb = opts.callbacks;
  }

  /** Warm the token while the finger is still on the button. */
  static prefetch(basePath: string, body: Record<string, unknown>) {
    const key = JSON.stringify(body);
    if (
      prefetched &&
      prefetched.key === key &&
      Date.now() - prefetched.at < TOKEN_CACHE_MS
    ) {
      return;
    }
    const promise = requestToken(basePath, body);
    promise.catch(() => {
      prefetched = null;
    });
    prefetched = { key, at: Date.now(), promise };
  }

  private takeToken(body: Record<string, unknown>): Promise<TokenGrant> {
    const key = JSON.stringify(body);
    if (
      prefetched &&
      prefetched.key === key &&
      Date.now() - prefetched.at < TOKEN_CACHE_MS
    ) {
      const { promise } = prefetched;
      prefetched = null; // tokens are single-use
      return promise;
    }
    return requestToken(this.basePath, body);
  }

  private setPhase(next: LivePhase) {
    if (this.phase === next) {
      return;
    }
    this.phase = next;
    this.cb.onPhase(next);
  }

  private emitCaptions() {
    this.cb.onCaptions({
      user: this.turns.userCaption,
      assistant: this.turns.assistantCaption || this.activeAssistantCaption,
    });
  }

  /**
   * MUST be called synchronously from the tap handler: the AudioContext,
   * audio session and mic request are all unlocked by that user gesture.
   */
  start() {
    this.stopped = false;
    setAudioSessionType("play-and-record");
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      this.fail("This browser can't run live voice.");
      return;
    }
    this.ctx = new AudioCtx({ latencyHint: "interactive" });
    this.ctx.resume().catch(() => null);
    this.sink = this.ctx.createGain();
    this.sink.connect(this.ctx.destination);
    this.ctx.addEventListener("statechange", () => {
      const state = this.ctx?.state as string | undefined;
      if (state === "interrupted" || state === "suspended") {
        this.ctx?.resume().catch(() => null);
      }
    });

    const micPromise = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        })
      : Promise.reject(new Error("no-media-devices"));

    const tokenPromise = this.takeToken({
      ...this.sessionBody,
      ...(this.resumeHandle ? { resumeHandle: this.resumeHandle } : {}),
    });

    document.addEventListener("visibilitychange", this.onVisibility);
    this.requestWakeLock();
    this.setPhase("connecting");

    this.boot(micPromise, tokenPromise).catch((err) => {
      this.fail(
        err instanceof Error && err.message === "mic-denied"
          ? "Microphone access is blocked. Allow it in Settings › Safari › Microphone."
          : err instanceof Error
            ? err.message
            : "Live voice could not start."
      );
    });
  }

  private async boot(
    micPromise: Promise<MediaStream>,
    tokenPromise: Promise<TokenGrant>
  ) {
    let stream: MediaStream;
    try {
      stream = await micPromise;
    } catch {
      throw new Error("mic-denied");
    }
    if (this.stopped) {
      for (const t of stream.getTracks()) {
        t.stop();
      }
      return;
    }
    this.stream = stream;
    await this.startCapture();
    const grant = await tokenPromise;
    if (this.stopped) {
      return;
    }
    this.connect(grant);
  }

  private async startCapture() {
    const ctx = this.ctx;
    const stream = this.stream;
    if (!ctx || !stream) {
      return;
    }
    this.source = ctx.createMediaStreamSource(stream);
    const silentOut = ctx.createGain();
    silentOut.gain.value = 0;
    silentOut.connect(ctx.destination);

    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const url = URL.createObjectURL(
          new Blob([CAPTURE_WORKLET], { type: "application/javascript" })
        );
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (this.stopped || this.ctx !== ctx || !this.source) {
          return;
        }
        const node = new AudioWorkletNode(ctx, "pcm-capture-16k", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
        });
        node.port.onmessage = (
          ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>
        ) => {
          this.onMicFrame(new Int16Array(ev.data.pcm), ev.data.rms);
        };
        this.source.connect(node);
        node.connect(silentOut);
        this.captureNode = node;
        return;
      } catch {
        /* fall through to ScriptProcessor fallback */
      }
    }

    if (this.stopped || this.ctx !== ctx || !this.source) {
      return;
    }

    // Fallback for very old WebKit: ScriptProcessor with the same decimation.
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const ratio = ctx.sampleRate / 16_000;
    let acc = 0;
    let n = 0;
    let frac = 0;
    let buf = new Int16Array(LIVE_FRAME_SAMPLES);
    let idx = 0;
    let sumSq = 0;
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      for (const sample of ch) {
        acc += sample;
        n += 1;
        frac += 1;
        if (frac >= ratio) {
          frac -= ratio;
          const v = Math.max(-1, Math.min(1, acc / n));
          acc = 0;
          n = 0;
          buf[idx] = v < 0 ? v * 0x80_00 : v * 0x7f_ff;
          idx += 1;
          sumSq += v * v;
          if (idx === LIVE_FRAME_SAMPLES) {
            this.onMicFrame(buf, Math.sqrt(sumSq / LIVE_FRAME_SAMPLES));
            buf = new Int16Array(LIVE_FRAME_SAMPLES);
            idx = 0;
            sumSq = 0;
          }
        }
      }
    };
    this.source.connect(proc);
    proc.connect(silentOut);
    this.captureNode = proc;
  }

  private connect(grant: TokenGrant) {
    this.ready = false;
    this.goAwayPending = false;
    this.transport = grant.transport ?? "google-direct";
    const ws =
      grant.protocols && grant.protocols.length > 0
        ? new WebSocket(grant.wsUrl, grant.protocols)
        : new WebSocket(grant.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws === ws) {
        ws.send(JSON.stringify(grant.setup));
      }
    };
    ws.onmessage = (ev: MessageEvent<string | Blob | ArrayBuffer>) => {
      if (this.ws !== ws) {
        return;
      }
      if (typeof ev.data === "string") {
        this.onServerText(ev.data);
      } else if (ev.data instanceof Blob) {
        ev.data
          .text()
          .then((t) => {
            if (this.ws === ws) {
              this.onServerText(t);
            }
          })
          .catch(() => null);
      } else if (ev.data instanceof ArrayBuffer) {
        this.onServerText(new TextDecoder().decode(ev.data));
      }
    };
    ws.onerror = () => {
      /* onclose handles recovery */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) {
        return;
      }
      this.ready = false;
      this.ws = null;
      this.clearGoAwayTimer();
      if (this.stopped || this.phase === "paused") {
        return;
      }
      if (
        ev.code === 1008 ||
        ev.code === 1007 ||
        (ev.code === 1011 && /credit|quota|billing/i.test(ev.reason))
      ) {
        if (this.resumeHandle && ev.code !== 1011) {
          // Expired or invalid session resumption handle: retry cleanly without it.
          this.resumeHandle = null;
          this.reconnect();
          return;
        }
        this.fail(
          /credit|quota|billing/i.test(ev.reason)
            ? "Voice credits are temporarily reached. Please try again shortly or check Setup."
            : "Live voice couldn't connect right now. Tap the assistant to try again."
        );
        return;
      }
      this.reconnect();
    };
  }

  private reconnect() {
    if (this.reconnecting || this.stopped) {
      return;
    }
    if (this.reconnectAttempts >= 3) {
      this.fail("Connection lost. Tap the microphone to try again.");
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    this.flushPlayback();
    this.setPhase("reconnecting");
    requestToken(this.basePath, {
      ...this.sessionBody,
      ...(this.resumeHandle ? { resumeHandle: this.resumeHandle } : {}),
    })
      .then((grant) => {
        this.reconnecting = false;
        if (!this.stopped) {
          this.connect(grant);
        }
      })
      .catch((err) => {
        this.reconnecting = false;
        this.fail(
          err instanceof Error ? err.message : "Live voice reconnect failed."
        );
      });
  }

  private onServerText(raw: string) {
    for (const event of parseLiveServerMessage(raw)) {
      switch (event.type) {
        case "setup-complete":
          if (!this.ready) {
            this.ready = true;
            this.reconnectAttempts = 0;
            this.dropStaleAudio = false;
            this.gate.reset();
            this.setPhase("listening");
          }
          break;
        case "input-transcript":
          this.dropStaleAudio = false;
          if (this.sources.size === 0) {
            this.activeAssistantCaption = "";
          }
          this.turns.addInput(event.text);
          this.emitCaptions();
          if (
            !this.assistantAudible &&
            !this.gateIsOpen &&
            this.phase === "listening"
          ) {
            this.setPhase("thinking");
            this.armThinkingTimer();
          }
          break;
        case "audio":
          if (!this.dropStaleAudio) {
            this.turns.markOutputStarted();
            this.playChunk(event.data);
          }
          break;
        case "output-transcript":
          if (!this.dropStaleAudio) {
            this.turns.addOutput(event.text);
            this.activeAssistantCaption = this.turns.assistantCaption;
            this.emitCaptions();
          }
          break;
        case "speech-started":
          if (this.sources.size > 0 || !this.turnCompleteReceived) {
            this.turns.markBargeIn();
            this.activeAssistantCaption = "";
            this.flushPlayback();
            this.dropStaleAudio = false;
            this.turnCompleteReceived = true;
            this.commitTurn(true);
            this.setPhase(this.gateIsOpen ? "user-speaking" : "listening");
          }
          break;
        case "interrupted":
          this.turns.markBargeIn();
          this.activeAssistantCaption = "";
          this.flushPlayback();
          // Ordered socket stream: no stale audio from the cancelled turn follows.
          this.dropStaleAudio = false;
          this.turnCompleteReceived = true;
          this.commitTurn(true);
          this.setPhase(this.gateIsOpen ? "user-speaking" : "listening");
          break;
        case "generation-complete":
          break;
        case "turn-complete":
          this.dropStaleAudio = false;
          this.turnCompleteReceived = true;
          this.commitTurn(false);
          this.maybeReturnToListening();
          break;
        case "resumption":
          this.resumeHandle = event.handle;
          break;
        case "go-away":
          this.goAwayPending = true;
          if (this.assistantAudible) {
            this.clearGoAwayTimer();
            this.goAwayTimer = setTimeout(
              () => {
                if (this.goAwayPending) {
                  this.ws?.close(1000, "go-away");
                }
              },
              Math.max(400, event.timeLeftMs - 1000)
            );
          } else {
            this.ws?.close(1000, "go-away");
          }
          break;
        case "error":
          this.cb.onError(event.message);
          break;
        default:
          break;
      }
    }
  }

  private gateIsOpen = false;

  private get assistantAudible(): boolean {
    const ctx = this.ctx;
    if (!ctx) {
      return false;
    }
    const tail = 0.45 + (ctx.outputLatency || 0);
    return this.sources.size > 0 || ctx.currentTime < this.nextStartTime + tail;
  }

  private onMicFrame(frame: Int16Array, rms: number) {
    if (this.stopped) {
      return;
    }
    this.cb.onLevel(Math.min(1, rms * 6));
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.muted) {
      return;
    }
    const audible = this.assistantAudible;
    const decision = this.gate.process(frame, rms, audible);
    const wasOpen = this.gateIsOpen;
    this.gateIsOpen = decision.open;

    if (decision.bargeIn) {
      this.turns.markBargeIn();
      this.userOverlappedAssistant = true;
      this.duckForBargeIn();
    }
    if (decision.open && !wasOpen) {
      this.dropStaleAudio = false;
      if (!audible || decision.bargeIn) {
        this.activeAssistantCaption = "";
        this.emitCaptions();
      }
      if (audible) {
        this.userOverlappedAssistant = true;
      }
      this.clearThinkingTimer();
      if (!audible || decision.bargeIn) {
        this.setPhase("user-speaking");
      }
    } else if (!decision.open && wasOpen) {
      if (this.sources.size > 0) {
        // False barge-in or short comment finished while assistant audio is still playing.
        this.setPhase("speaking");
      } else if (this.turns.hasPendingUser) {
        this.setPhase("thinking");
        this.armThinkingTimer();
      } else {
        this.setPhase("listening");
      }
    }

    for (const out of decision.frames) {
      this.ws.send(
        JSON.stringify(
          buildLiveAudioClientMessage(this.transport, int16ToBase64(out))
        )
      );
    }
  }

  private armThinkingTimer() {
    this.clearThinkingTimer();
    // Noise that never became a turn: quietly go back to listening.
    this.thinkingTimer = setTimeout(() => {
      if (this.phase === "thinking") {
        this.setPhase("listening");
      }
    }, 7000);
  }

  private clearThinkingTimer() {
    if (this.thinkingTimer) {
      clearTimeout(this.thinkingTimer);
      this.thinkingTimer = null;
    }
  }

  private clearGoAwayTimer() {
    if (this.goAwayTimer) {
      clearTimeout(this.goAwayTimer);
      this.goAwayTimer = null;
    }
  }

  private duckForBargeIn() {
    const ctx = this.ctx;
    if (!ctx || !this.turnGain) {
      return;
    }
    this.turnGain.gain.setTargetAtTime(0.15, ctx.currentTime, 0.02);
    if (this.duckTimer) {
      clearTimeout(this.duckTimer);
    }
    // No `interrupted` within 1.5 s → it was not a real barge-in; restore.
    this.duckTimer = setTimeout(() => {
      if (this.turnGain && this.ctx) {
        this.turnGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
      }
    }, 1500);
  }

  private playChunk(base64: string) {
    const ctx = this.ctx;
    const sink = this.sink;
    if (!ctx || !sink) {
      return;
    }
    const pcm = pcm16ToFloat32(base64ToInt16(base64));
    if (pcm.length === 0) {
      return;
    }
    if (!this.turnGain) {
      this.turnGain = ctx.createGain();
      this.turnGain.connect(sink);
    }
    const buffer = ctx.createBuffer(1, pcm.length, LIVE_OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.turnGain);

    const now = ctx.currentTime;
    if (this.nextStartTime < now + 0.02) {
      // First chunk of a turn (or underrun): small jitter lead.
      this.nextStartTime = now + (this.sources.size === 0 ? 0.08 : 0.05);
    }
    src.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.maybeReturnToListening();
    };
    this.clearThinkingTimer();
    this.turnCompleteReceived = false;
    this.setPhase("speaking");
  }

  private maybeReturnToListening() {
    if (this.sources.size > 0 || !this.turnCompleteReceived) {
      return;
    }
    const ctx = this.ctx;
    const tailMs = ctx
      ? Math.max(0, (this.nextStartTime - ctx.currentTime) * 1000)
      : 0;
    setTimeout(() => {
      if (this.stopped || this.sources.size > 0) {
        return;
      }
      if (this.goAwayPending) {
        this.goAwayPending = false;
        this.clearGoAwayTimer();
        this.ws?.close(1000, "go-away");
        return;
      }
      if (
        this.phase === "speaking" ||
        this.phase === "thinking" ||
        (this.phase === "user-speaking" && !this.gateIsOpen)
      ) {
        this.setPhase(this.gateIsOpen ? "user-speaking" : "listening");
      }
    }, tailMs + 120);
  }

  private flushPlayback() {
    const ctx = this.ctx;
    if (this.duckTimer) {
      clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }
    const gain = this.turnGain;
    this.turnGain = null;
    if (ctx && gain) {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.005);
      setTimeout(() => {
        try {
          gain.disconnect();
        } catch {
          /* already gone */
        }
      }, 60);
    }
    for (const src of this.sources) {
      try {
        src.onended = null;
        src.stop(ctx ? ctx.currentTime + 0.03 : 0);
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }

  private commitTurn(interrupted: boolean) {
    const overlapped = this.userOverlappedAssistant;
    this.userOverlappedAssistant = false;
    const turn = this.turns.commit(interrupted);
    this.emitCaptions();
    if (!turn) {
      return;
    }
    let leaked = false;
    if (
      overlapped &&
      turn.user &&
      this.lastAssistantText &&
      turn.user.split(" ").length <= 12 &&
      echoSimilarity(turn.user, this.lastAssistantText) >= 0.65
    ) {
      // Speaker leaked into the mic while assistant was audible: harden barge-in.
      this.gate.reportEchoLeak();
      turn.user = "";
      leaked = true;
    } else if (turn.user && turn.assistant) {
      this.gate.decayEchoPenalty();
    }
    if (!leaked && turn.assistant) {
      this.lastAssistantText = turn.assistant;
    }
    if (turn.user || turn.assistant) {
      this.cb.onTurn(turn);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.gate.reset();
      this.gateIsOpen = false;
      if (this.ws?.readyState === WebSocket.OPEN && this.ready) {
        this.ws.send(JSON.stringify(buildLiveStreamEndMessage(this.transport)));
      }
    }
  }

  /** User tapped the orb while the assistant talks: stop it right away. */
  interrupt() {
    const serverStillStreaming = !this.turnCompleteReceived;
    this.activeAssistantCaption = "";
    this.flushPlayback();
    this.dropStaleAudio = serverStillStreaming;
    this.turnCompleteReceived = true;
    const cancel = buildLiveCancelMessage(this.transport);
    if (cancel && this.ws?.readyState === WebSocket.OPEN && this.ready) {
      this.ws.send(JSON.stringify(cancel));
    }
    this.commitTurn(true);
    this.setPhase("listening");
  }

  private pause() {
    this.commitTurn(this.sources.size > 0);
    this.setPhase("paused");
    this.teardownTransport();
  }

  /** Resume after the app came back to the foreground (needs a tap). */
  resume() {
    this.teardownAll(false);
    this.start();
  }

  private async requestWakeLock() {
    try {
      const nav = navigator as unknown as {
        wakeLock?: {
          request: (t: "screen") => Promise<{ release: () => Promise<void> }>;
        };
      };
      this.wakeLock = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  private fail(message: string) {
    this.cb.onError(message);
    this.setPhase("error");
    this.teardownTransport();
  }

  private teardownTransport() {
    this.ready = false;
    this.goAwayPending = false;
    this.clearGoAwayTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(buildLiveStreamEndMessage(this.transport)));
        }
        ws.close(1000, "client-closed");
      } catch {
        /* ignore */
      }
    }
    this.flushPlayback();
    this.clearThinkingTimer();
    if (this.captureNode) {
      try {
        this.captureNode.disconnect();
      } catch {
        /* ignore */
      }
      if ("port" in this.captureNode) {
        this.captureNode.port.onmessage = null;
      }
      this.captureNode = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.stop();
      }
      this.stream = null;
    }
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => null);
      this.wakeLock = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => null);
      this.ctx = null;
      this.sink = null;
    }
    setAudioSessionType("auto");
  }

  private teardownAll(final: boolean) {
    this.stopped = final;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.teardownTransport();
  }

  stop() {
    if (this.stopped) {
      return;
    }
    this.commitTurn(this.sources.size > 0);
    this.teardownAll(true);
    this.setPhase("ended");
  }

  /** Test hook: frame duration used by the capture pipeline. */
  static readonly frameMs = LIVE_FRAME_MS;
}
