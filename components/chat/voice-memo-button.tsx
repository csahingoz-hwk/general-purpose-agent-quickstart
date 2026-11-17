"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  AudioLinesIcon,
  MicIcon,
  MicOffIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/types";
import { cn, fetcher, generateUUID } from "@/lib/utils";
import { AgentMascot } from "./agent-mascot";
import { useMascotPreference } from "./mascot-preference";

export type VoiceReadiness = {
  serverSttReady: boolean;
  liveReady: boolean;
};

type BrowserSpeechResultItem = {
  0: { transcript: string };
  isFinal: boolean;
};

type BrowserSpeechEvent = {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechResultItem>;
};

type BrowserSpeechErrorEvent = {
  error?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

// 1-sample silent WAV used to unlock iOS Safari HTMLAudioElement synchronously inside tap gesture
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function setIosAudioSessionType(
  mode: "play-and-record" | "playback" | "auto"
): void {
  if (typeof navigator === "undefined") {
    return;
  }
  const nav = navigator as unknown as {
    audioSession?: { type?: string };
  };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = mode;
    } catch {
      /* ignore unsupported browsers */
    }
  }
}

function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

function extensionForAudioMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a")) {
    return "m4a";
  }
  if (lower.includes("ogg")) {
    return "ogg";
  }
  if (lower.includes("wav")) {
    return "wav";
  }
  if (lower.includes("mpeg") || lower.includes("mp3")) {
    return "mp3";
  }
  return "webm";
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function useVoiceReadiness(): VoiceReadiness {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const { data } = useSWR<VoiceReadiness>(
    `${basePath}/api/voice/transcribe`,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
  return {
    serverSttReady: data?.serverSttReady === true,
    liveReady: data?.liveReady === true,
  };
}

/**
 * Left-hand Mic button: dictates text into the message composer before sending.
 */
export function VoiceMemoControls({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const { serverSttReady } = useVoiceReadiness();
  const [hasSpeechApi, setHasSpeechApi] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const latestTranscriptRef = useRef<string>("");
  const deliveredRef = useRef<boolean>(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setHasSpeechApi(Boolean(getSpeechRecognitionCtor()));
  }, []);

  const cleanupMedia = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  const stopCapture = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        recognitionRef.current = null;
      }
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setRecording(false);
  }, []);

  const startServerMemo = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = pickSupportedRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const effectiveType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: effectiveType });
        chunksRef.current = [];
        cleanupMedia();
        if (blob.size === 0) {
          return;
        }
        setTranscribing(true);
        try {
          const ext = extensionForAudioMime(effectiveType);
          const form = new FormData();
          form.append("audio", blob, `voice-memo.${ext}`);
          const res = await fetch(`${basePath}/api/voice/transcribe`, {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as {
            transcript?: string;
            message?: string;
          };
          if (res.ok && data.transcript?.trim()) {
            onTranscript(data.transcript.trim());
          } else {
            toast.error(
              data.message ?? "Could not transcribe that voice clip."
            );
          }
        } catch {
          toast.error("Could not transcribe that voice clip.");
        } finally {
          setTranscribing(false);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      cleanupMedia();
      setRecording(false);
      toast.error("Allow microphone access in browser settings to dictate.");
    }
  }, [basePath, cleanupMedia, onTranscript]);

  const startDictation = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      if (serverSttReady) {
        startServerMemo().catch(() => null);
      }
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang =
        (typeof navigator !== "undefined" && navigator.language) || "en-GB";

      latestTranscriptRef.current = "";
      deliveredRef.current = false;

      recognition.onresult = (event) => {
        let full = "";
        for (const item of Array.from(event.results)) {
          full += item?.[0]?.transcript ?? "";
        }
        latestTranscriptRef.current = full.trim();
      };

      recognition.onerror = (event) => {
        const code = event.error ?? "";
        setRecording(false);
        recognitionRef.current = null;
        if (
          (code === "service-not-allowed" || code === "network") &&
          serverSttReady
        ) {
          startServerMemo().catch(() => null);
        } else if (code === "not-allowed") {
          toast.error(
            "Allow microphone access in browser settings to dictate."
          );
        }
      };

      recognition.onend = () => {
        const finalText = latestTranscriptRef.current.trim();
        latestTranscriptRef.current = "";
        recognitionRef.current = null;
        setRecording(false);
        if (finalText && !deliveredRef.current) {
          deliveredRef.current = true;
          onTranscript(finalText);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
    } catch {
      setRecording(false);
      if (serverSttReady) {
        startServerMemo().catch(() => null);
      }
    }
  }, [onTranscript, serverSttReady, startServerMemo]);

  useEffect(() => {
    return () => {
      cleanupMedia();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, [cleanupMedia]);

  if (!hasSpeechApi && !serverSttReady) {
    return null;
  }

  return (
    <Button
      aria-label={recording ? "Stop dictation" : "Dictate message"}
      aria-pressed={recording}
      className={cn(
        "size-11! rounded-full border-transparent bg-control p-0 shadow-none transition-colors motion-reduce:transition-none hover:bg-control",
        recording
          ? "bg-destructive/15 text-destructive ring-2 ring-destructive/30"
          : "text-foreground"
      )}
      data-recording={recording ? "true" : "false"}
      data-testid="voice-memo-button"
      disabled={(disabled && !recording) || transcribing}
      onClick={(e) => {
        e.preventDefault();
        if (recording) {
          stopCapture();
        } else {
          startDictation();
        }
      }}
      title={recording ? "Tap to finish dictation" : "Dictate into message box"}
      type="button"
      variant="ghost"
    >
      {recording ? (
        <SquareIcon aria-hidden="true" className="size-4 fill-current" />
      ) : (
        <MicIcon aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}

type LivePhase = "listening" | "thinking" | "speaking" | "muted";

type AudioQueueItem =
  | { kind: "mp3"; base64: string }
  | { kind: "tts-fallback"; text: string };

/**
 * Right-hand Waveform button: ONE tap enters full-screen hands-free Live Voice Mode
 * (like Gemini Live / ChatGPT Voice) — immediately listening, streaming fast spoken
 * replies with real neural TTS audio, and automatically looping turn-by-turn.
 */
export function LiveVoiceButton({
  disabled,
  chatId,
  messages,
  setMessages,
}: {
  disabled: boolean;
  chatId: string;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const { variant } = useMascotPreference();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<LivePhase>("listening");
  const [muted, setMuted] = useState(false);
  const [userCaption, setUserCaption] = useState("");
  const [assistantCaption, setAssistantCaption] = useState("");

  const openRef = useRef(false);
  const mutedRef = useRef(false);
  const phaseRef = useRef<LivePhase>("listening");
  const messagesRef = useRef<UIMessage[]>(messages);
  messagesRef.current = messages;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTextRef = useRef<string>("");
  const committedTurnRef = useRef<boolean>(false);
  const abortTurnRef = useRef<AbortController | null>(null);

  // MediaRecorder + AnalyserNode VAD fallback for browsers without SpeechRecognition
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadRecorderRef = useRef<MediaRecorder | null>(null);
  const vadRafRef = useRef<number | null>(null);

  const audioQueueRef = useRef<AudioQueueItem[]>([]);
  const playingQueueRef = useRef(false);
  const streamDoneRef = useRef(false);

  const updatePhase = useCallback((next: LivePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopListeningHardware = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (vadRecorderRef.current && vadRecorderRef.current.state !== "inactive") {
      vadRecorderRef.current.onstop = null;
      try {
        vadRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    vadRecorderRef.current = null;
    if (vadStreamRef.current) {
      for (const track of vadStreamRef.current.getTracks()) {
        track.stop();
      }
      vadStreamRef.current = null;
    }
  }, [clearSilenceTimer]);

  const stopPlaybackAndAbortTurn = useCallback(() => {
    if (abortTurnRef.current) {
      abortTurnRef.current.abort();
      abortTurnRef.current = null;
    }
    audioQueueRef.current = [];
    playingQueueRef.current = false;
    streamDoneRef.current = true;

    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {
        /* ignore */
      }
      activeSourceRef.current = null;
    }
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.removeAttribute("src");
      } catch {
        /* ignore */
      }
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const playSingleQueueItem = useCallback(
    async (item: AudioQueueItem): Promise<void> => {
      if (!openRef.current) {
        return;
      }
      updatePhase("speaking");
      setIosAudioSessionType("playback");

      if (item.kind === "mp3") {
        const bytes = base64ToUint8Array(item.base64);
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        // Primary on iOS Safari & desktop: tap-unlocked HTMLAudioElement (plays through loud main speaker even on silent switch)
        const el = audioElRef.current;
        if (el) {
          const blob = new Blob([ab], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);
          const playedViaElement = await new Promise<boolean>((resolve) => {
            const cleanup = () => {
              el.onended = null;
              el.onerror = null;
              URL.revokeObjectURL(url);
            };
            el.onended = () => {
              cleanup();
              resolve(true);
            };
            el.onerror = () => {
              cleanup();
              resolve(false);
            };
            el.src = url;
            el.volume = 1;
            el.play().catch(() => {
              cleanup();
              resolve(false);
            });
          });
          if (playedViaElement) {
            return;
          }
        }

        // Secondary fallback: tap-unlocked Web AudioContext
        const ctx = audioCtxRef.current;
        if (ctx) {
          try {
            if (ctx.state === "suspended") {
              await ctx.resume();
            }
            const decoded = await ctx.decodeAudioData(ab.slice(0));
            await new Promise<void>((resolve) => {
              const source = ctx.createBufferSource();
              source.buffer = decoded;
              source.connect(ctx.destination);
              activeSourceRef.current = source;
              source.onended = () => {
                if (activeSourceRef.current === source) {
                  activeSourceRef.current = null;
                }
                resolve();
              };
              source.start(0);
            });
            return;
          } catch {
            /* fall through to speechSynthesis */
          }
        }
      }

      if (
        item.kind === "tts-fallback" &&
        item.text &&
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
        await new Promise<void>((resolve) => {
          try {
            const u = new SpeechSynthesisUtterance(item.text);
            u.onend = () => resolve();
            u.onerror = () => resolve();
            window.speechSynthesis.speak(u);
          } catch {
            resolve();
          }
        });
      }
    },
    [updatePhase]
  );

  // Forward reference for mutual recursion between playback drain and listening restart
  const beginListeningRef = useRef<() => void>(() => undefined);

  const drainAudioQueue = useCallback(async () => {
    if (playingQueueRef.current) {
      return;
    }
    playingQueueRef.current = true;
    try {
      while (openRef.current && audioQueueRef.current.length > 0) {
        const next = audioQueueRef.current.shift();
        if (!next) {
          break;
        }
        await playSingleQueueItem(next);
      }
    } finally {
      playingQueueRef.current = false;
      if (
        openRef.current &&
        streamDoneRef.current &&
        audioQueueRef.current.length === 0
      ) {
        if (mutedRef.current) {
          updatePhase("muted");
        } else {
          beginListeningRef.current();
        }
      }
    }
  }, [playSingleQueueItem, updatePhase]);

  const sendVoiceTurn = useCallback(
    async (spokenText: string) => {
      const cleaned = spokenText.trim();
      if (!cleaned || !openRef.current) {
        return;
      }

      stopListeningHardware();
      stopPlaybackAndAbortTurn();
      updatePhase("thinking");
      setUserCaption(cleaned);
      setAssistantCaption("");

      const userMsgId = generateUUID();
      const assistantMsgId = generateUUID();
      const nowIso = new Date().toISOString();

      window.history.pushState({}, "", `${basePath}/chat/${chatId}`);

      const priorTurns = messagesRef.current
        .slice(-8)
        .map((m) => {
          const text = m.parts
            .filter(
              (p): p is { type: "text"; text: string } =>
                p.type === "text" && "text" in p
            )
            .map((p) => p.text)
            .join(" ")
            .trim();
          return text
            ? {
                role:
                  m.role === "assistant"
                    ? ("assistant" as const)
                    : ("user" as const),
                text,
              }
            : null;
        })
        .filter(
          (item): item is { role: "user" | "assistant"; text: string } =>
            item !== null
        );

      // Optimistically show the user's spoken turn in chat history immediately
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: "user",
          parts: [{ type: "text", text: cleaned }],
          metadata: { createdAt: nowIso },
        } as ChatMessage,
      ]);

      let activeBotSlug: string | undefined;
      try {
        activeBotSlug =
          window.localStorage.getItem("assistant-active-bot")?.trim() ||
          undefined;
      } catch {
        activeBotSlug = undefined;
      }

      let timeZone = "Europe/London";
      try {
        timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
      } catch {
        /* default */
      }

      const controller = new AbortController();
      abortTurnRef.current = controller;
      streamDoneRef.current = false;
      audioQueueRef.current = [];

      try {
        const res = await fetch(`${basePath}/api/voice/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            userMessageId: userMsgId,
            assistantMessageId: assistantMsgId,
            selectedBotSlug: activeBotSlug,
            timeZone,
            turns: [...priorTurns, { role: "user", text: cleaned }],
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error("Voice turn failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let lineBuf = "";
        let replyAcc = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          lineBuf += decoder.decode(value, { stream: true });
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }
            const evt = JSON.parse(line) as {
              type: string;
              delta?: string;
              base64?: string;
              text?: string;
              fullText?: string;
            };

            if (evt.type === "text-delta" && evt.delta) {
              replyAcc += evt.delta;
              setAssistantCaption(replyAcc);
              const snapshot = replyAcc;
              setMessages((prev) => {
                const exists = prev.some((m) => m.id === assistantMsgId);
                if (exists) {
                  return prev.map((m) =>
                    m.id === assistantMsgId
                      ? ({
                          ...m,
                          parts: [{ type: "text", text: snapshot }],
                        } as ChatMessage)
                      : m
                  );
                }
                return [
                  ...prev,
                  {
                    id: assistantMsgId,
                    role: "assistant",
                    parts: [{ type: "text", text: snapshot }],
                    metadata: { createdAt: new Date().toISOString() },
                  } as ChatMessage,
                ];
              });
            } else if (evt.type === "audio" && evt.base64) {
              audioQueueRef.current.push({ kind: "mp3", base64: evt.base64 });
              drainAudioQueue().catch(() => null);
            } else if (evt.type === "tts-fallback" && evt.text) {
              audioQueueRef.current.push({
                kind: "tts-fallback",
                text: evt.text,
              });
              drainAudioQueue().catch(() => null);
            }
          }
        }

        streamDoneRef.current = true;
        if (!playingQueueRef.current && audioQueueRef.current.length === 0) {
          if (openRef.current && !mutedRef.current) {
            beginListeningRef.current();
          } else if (openRef.current) {
            updatePhase("muted");
          }
        }
      } catch {
        if (!controller.signal.aborted && openRef.current) {
          streamDoneRef.current = true;
          if (!mutedRef.current) {
            beginListeningRef.current();
          }
        }
      }
    },
    [
      basePath,
      chatId,
      drainAudioQueue,
      setMessages,
      stopListeningHardware,
      stopPlaybackAndAbortTurn,
      updatePhase,
    ]
  );

  const startMediaRecorderVadFallback = useCallback(async () => {
    if (
      !openRef.current ||
      mutedRef.current ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!openRef.current || mutedRef.current) {
        for (const t of stream.getTracks()) {
          t.stop();
        }
        return;
      }
      vadStreamRef.current = stream;
      const chunks: Blob[] = [];
      const mimeType = pickSupportedRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      vadRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const effectiveType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: effectiveType });
        stopListeningHardware();
        if (blob.size < 400 || !openRef.current) {
          if (openRef.current && !mutedRef.current) {
            beginListeningRef.current();
          }
          return;
        }
        updatePhase("thinking");
        try {
          const ext = extensionForAudioMime(effectiveType);
          const form = new FormData();
          form.append("audio", blob, `voice-turn.${ext}`);
          const res = await fetch(`${basePath}/api/voice/transcribe`, {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as { transcript?: string };
          if (res.ok && data.transcript?.trim()) {
            await sendVoiceTurn(data.transcript.trim());
          } else if (openRef.current && !mutedRef.current) {
            beginListeningRef.current();
          }
        } catch {
          if (openRef.current && !mutedRef.current) {
            beginListeningRef.current();
          }
        }
      };

      recorder.start();

      // Web Audio RMS Voice Activity Detection
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = audioCtxRef.current ?? new AudioCtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let spoke = false;
      let silenceSince = 0;

      const tick = () => {
        if (
          !openRef.current ||
          mutedRef.current ||
          vadRecorderRef.current !== recorder
        ) {
          return;
        }
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const sample of buf) {
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();

        if (rms > 0.02) {
          spoke = true;
          silenceSince = 0;
          setUserCaption("Listening…");
        } else if (spoke) {
          if (silenceSince === 0) {
            silenceSince = now;
          } else if (
            now - silenceSince > 1050 &&
            recorder.state === "recording"
          ) {
            recorder.stop();
            return;
          }
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {
      toast.error(
        "Microphone access is blocked. Allow microphone permission in browser settings."
      );
    }
  }, [basePath, sendVoiceTurn, stopListeningHardware, updatePhase]);

  const beginListeningTurn = useCallback(() => {
    if (!openRef.current || mutedRef.current) {
      return;
    }

    stopListeningHardware();
    setIosAudioSessionType("play-and-record");
    updatePhase("listening");
    turnTextRef.current = "";
    committedTurnRef.current = false;
    setUserCaption("");

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      startMediaRecorderVadFallback().catch(() => null);
      return;
    }

    try {
      const recognition = new Ctor();
      // Native Siri / browser single-utterance endpointing avoids iOS WebKit's continuous-mode garbling
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang =
        (typeof navigator !== "undefined" && navigator.language) || "en-GB";

      const commitIfReady = () => {
        if (committedTurnRef.current) {
          return;
        }
        const finalSpoken = turnTextRef.current.trim();
        if (!finalSpoken) {
          return;
        }
        committedTurnRef.current = true;
        clearSilenceTimer();
        sendVoiceTurn(finalSpoken).catch(() => null);
      };

      recognition.onresult = (event) => {
        let combined = "";
        for (const item of Array.from(event.results)) {
          combined += item?.[0]?.transcript ?? "";
        }
        const trimmed = combined.trim();
        if (!trimmed) {
          return;
        }
        turnTextRef.current = trimmed;
        setUserCaption(trimmed);

        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          commitIfReady();
        }, 1050);
      };

      recognition.onerror = (event) => {
        const code = event.error ?? "";
        recognitionRef.current = null;
        clearSilenceTimer();
        if (code === "not-allowed") {
          toast.error(
            "Allow microphone access in browser settings to use live voice."
          );
          updatePhase("muted");
          setMuted(true);
          mutedRef.current = true;
          return;
        }
        if (code === "service-not-allowed" || code === "network") {
          startMediaRecorderVadFallback().catch(() => null);
          return;
        }
        if (
          openRef.current &&
          !mutedRef.current &&
          phaseRef.current === "listening" &&
          !committedTurnRef.current
        ) {
          setTimeout(() => {
            if (
              openRef.current &&
              !mutedRef.current &&
              phaseRef.current === "listening"
            ) {
              beginListeningRef.current();
            }
          }, 180);
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        clearSilenceTimer();
        if (!openRef.current || mutedRef.current) {
          return;
        }
        if (turnTextRef.current.trim() && !committedTurnRef.current) {
          commitIfReady();
          return;
        }
        if (!committedTurnRef.current && phaseRef.current === "listening") {
          setTimeout(() => {
            if (
              openRef.current &&
              !mutedRef.current &&
              phaseRef.current === "listening"
            ) {
              beginListeningRef.current();
            }
          }, 140);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      startMediaRecorderVadFallback().catch(() => null);
    }
  }, [
    clearSilenceTimer,
    sendVoiceTurn,
    startMediaRecorderVadFallback,
    stopListeningHardware,
    updatePhase,
  ]);

  beginListeningRef.current = beginListeningTurn;

  const closeLiveVoice = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    stopListeningHardware();
    stopPlaybackAndAbortTurn();
    setIosAudioSessionType("auto");
  }, [stopListeningHardware, stopPlaybackAndAbortTurn]);

  useEffect(() => {
    return () => {
      openRef.current = false;
      stopListeningHardware();
      stopPlaybackAndAbortTurn();
    };
  }, [stopListeningHardware, stopPlaybackAndAbortTurn]);

  const handleOpenLiveVoice = () => {
    // 1. Unlock iOS Safari audio output SYNCHRONOUSLY inside this single tap gesture
    try {
      setIosAudioSessionType("play-and-record");
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        const ctx = audioCtxRef.current ?? new AudioCtx();
        audioCtxRef.current = ctx;
        ctx.resume().catch(() => null);
        const silent = ctx.createBuffer(1, 1, 22_050);
        const src = ctx.createBufferSource();
        src.buffer = silent;
        src.connect(ctx.destination);
        src.start(0);
      }

      if (!audioElRef.current) {
        audioElRef.current = new Audio(SILENT_WAV_DATA_URI);
        audioElRef.current.setAttribute("playsinline", "true");
      }
      audioElRef.current.volume = 0.01;
      audioElRef.current.play().catch(() => null);

      if ("speechSynthesis" in window) {
        const prime = new SpeechSynthesisUtterance("");
        prime.volume = 0;
        window.speechSynthesis.speak(prime);
      }
    } catch {
      /* ignore audio prime errors */
    }

    // 2. Open full-screen Live Voice Mode and start listening IMMEDIATELY (zero extra taps)
    openRef.current = true;
    mutedRef.current = false;
    setMuted(false);
    setUserCaption("");
    setAssistantCaption("");
    setOpen(true);
    beginListeningTurn();
  };

  const handleOrbTap = () => {
    if (phase === "speaking" || phase === "thinking") {
      // Barge-in: interrupt assistant immediately and listen to user
      stopPlaybackAndAbortTurn();
      mutedRef.current = false;
      setMuted(false);
      beginListeningTurn();
      return;
    }
    if (phase === "listening" && turnTextRef.current.trim()) {
      // Commit spoken turn immediately without waiting for silence timer
      const text = turnTextRef.current.trim();
      committedTurnRef.current = true;
      sendVoiceTurn(text).catch(() => null);
      return;
    }
    if (muted) {
      mutedRef.current = false;
      setMuted(false);
      beginListeningTurn();
    }
  };

  const toggleMute = () => {
    if (muted) {
      mutedRef.current = false;
      setMuted(false);
      beginListeningTurn();
    } else {
      mutedRef.current = true;
      setMuted(true);
      stopListeningHardware();
      if (phase === "listening") {
        updatePhase("muted");
      }
    }
  };

  const mascotState: "idle" | "thinking" | "working" =
    phase === "thinking"
      ? "thinking"
      : phase === "speaking"
        ? "working"
        : "idle";

  return (
    <>
      <Button
        aria-label="Live voice chat"
        className="size-11! rounded-full border-transparent bg-send p-0 text-send-foreground shadow-none transition-colors duration-150 hover:bg-send/90 motion-reduce:transition-none"
        data-testid="live-voice-button"
        disabled={disabled}
        onClick={handleOpenLiveVoice}
        title="Start live voice chat"
        type="button"
        variant="secondary"
      >
        <AudioLinesIcon aria-hidden="true" className="size-5" />
      </Button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-label="Live voice conversation"
            aria-modal="true"
            className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-background px-6 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))] pb-[max(2.25rem,calc(env(safe-area-inset-bottom)+1.25rem))]"
            data-phase={phase}
            data-testid="live-voice-overlay"
            role="dialog"
          >
            <div className="flex items-center gap-2 rounded-full border border-[color:var(--hairline)] bg-card px-4 py-1.5 shadow-[var(--shadow-float)]">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-full",
                  phase === "listening"
                    ? "animate-pulse bg-emerald-500"
                    : phase === "thinking"
                      ? "animate-pulse bg-amber-500"
                      : phase === "speaking"
                        ? "animate-pulse bg-primary"
                        : "bg-muted-foreground"
                )}
              />
              <span className="font-medium text-foreground text-xs">
                {phase === "listening"
                  ? "Listening…"
                  : phase === "thinking"
                    ? "Thinking…"
                    : phase === "speaking"
                      ? "Speaking · tap orb to interrupt"
                      : "Microphone muted"}
              </span>
            </div>

            <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 text-center">
              <button
                aria-label={
                  phase === "speaking"
                    ? "Interrupt assistant"
                    : "Voice assistant orb"
                }
                className="group relative flex items-center justify-center rounded-full focus:outline-none"
                onClick={handleOrbTap}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute -inset-6 rounded-full transition-transform duration-500",
                    phase === "speaking"
                      ? "scale-115 animate-pulse bg-primary/18"
                      : phase === "listening"
                        ? "scale-105 animate-pulse bg-emerald-500/12"
                        : phase === "thinking"
                          ? "scale-100 bg-amber-500/12"
                          : "scale-95 bg-muted/40"
                  )}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute -inset-2.5 rounded-full border transition-transform duration-300",
                    phase === "speaking"
                      ? "scale-105 border-primary/35"
                      : phase === "listening"
                        ? "border-emerald-500/30"
                        : "border-[color:var(--hairline)]"
                  )}
                />
                <AgentMascot
                  animated={phase !== "muted"}
                  className="relative rounded-full shadow-[var(--shadow-float)]"
                  size={132}
                  state={mascotState}
                  variant={variant}
                />
              </button>

              <div className="min-h-24 w-full space-y-2.5 px-2">
                {phase === "speaking" ||
                (phase === "thinking" && assistantCaption) ? (
                  <p
                    className="font-medium text-[19px] text-foreground leading-relaxed"
                    data-testid="live-voice-assistant-caption"
                  >
                    {assistantCaption}
                  </p>
                ) : userCaption ? (
                  <p
                    className="text-[18px] text-foreground leading-relaxed"
                    data-testid="live-voice-user-caption"
                  >
                    {userCaption}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {muted
                      ? "Tap the microphone below to resume speaking"
                      : "Start speaking naturally — I'm listening"}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center gap-6">
              <button
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                aria-pressed={muted}
                className={cn(
                  "inline-flex size-14 items-center justify-center rounded-full border transition-colors",
                  muted
                    ? "border-transparent bg-muted text-muted-foreground"
                    : "border-[color:var(--hairline)] bg-card text-foreground shadow-[var(--shadow-float)] hover:bg-muted"
                )}
                onClick={toggleMute}
                type="button"
              >
                {muted ? (
                  <MicOffIcon className="size-6" />
                ) : (
                  <MicIcon className="size-6" />
                )}
              </button>

              <button
                aria-label="End live voice"
                className="inline-flex size-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-[var(--shadow-float)] transition-opacity hover:opacity-90"
                data-testid="live-voice-close"
                onClick={closeLiveVoice}
                type="button"
              >
                <XIcon className="size-6" />
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
