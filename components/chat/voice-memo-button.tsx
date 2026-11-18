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
import type { CommittedLiveTurn } from "@/lib/voice/live-protocol";
import { AgentMascot } from "./agent-mascot";
import {
  type LivePhase,
  type LiveToolDoneEvent,
  type LiveToolStartEvent,
  LiveVoiceEngine,
} from "./live-voice-engine";
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

const PHASE_LABEL: Record<LivePhase, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  "user-speaking": "Listening",
  thinking: "Thinking…",
  speaking: "Speaking · tap to interrupt",
  reconnecting: "Reconnecting…",
  paused: "Paused",
  error: "Voice unavailable",
  ended: "Ended",
};

/**
 * Right-hand waveform button → ONE tap opens full-screen, hands-free Live
 * Voice over the Gemini Live speech-to-speech API (streamed audio both ways,
 * server VAD, barge-in, echo-gated mic). Turns are mirrored into the chat.
 */
export function LiveVoiceButton({
  disabled,
  chatId,
  setMessages,
}: {
  disabled: boolean;
  chatId: string;
  messages?: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const { variant } = useMascotPreference();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<LivePhase>("connecting");
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState({ user: "", assistant: "" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [pendingChatCardHint, setPendingChatCardHint] = useState<string | null>(
    null
  );
  const [level, setLevel] = useState(0);
  const engineRef = useRef<LiveVoiceEngine | null>(null);
  const toolPlaceholderIdsRef = useRef<Map<string, string>>(new Map());
  const lastVoiceMemoryToolAtRef = useRef<number>(0);
  const urlPushedRef = useRef(false);
  const persistChainRef = useRef<Promise<void>>(Promise.resolve());

  const sessionBody = useCallback(() => {
    let selectedBotSlug: string | undefined;
    let timeZone = "Europe/London";
    try {
      selectedBotSlug =
        window.localStorage.getItem("assistant-active-bot")?.trim() ||
        undefined;
      timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
    } catch {
      /* defaults */
    }
    return {
      chatId,
      timeZone,
      ...(selectedBotSlug ? { selectedBotSlug } : {}),
    };
  }, [chatId]);

  const persistTurn = useCallback(
    (turn: CommittedLiveTurn) => {
      const userMessageId = generateUUID();
      const assistantMessageId = generateUUID();
      const createdAt = new Date().toISOString();
      if (!urlPushedRef.current) {
        urlPushedRef.current = true;
        window.history.pushState({}, "", `${basePath}/chat/${chatId}`);
      }
      setMessages((prev) => [
        ...prev,
        ...(turn.user
          ? [
              {
                id: userMessageId,
                role: "user",
                parts: [{ type: "text", text: turn.user }],
                metadata: { createdAt },
              } as ChatMessage,
            ]
          : []),
        ...(turn.assistant
          ? [
              {
                id: assistantMessageId,
                role: "assistant",
                parts: [
                  {
                    type: "text",
                    text: turn.interrupted
                      ? `${turn.assistant} …`
                      : turn.assistant,
                  },
                ],
                metadata: { createdAt },
              } as ChatMessage,
            ]
          : []),
      ]);
      persistChainRef.current = persistChainRef.current
        .then(async () => {
          const skipAutoMemorySave =
            Date.now() - lastVoiceMemoryToolAtRef.current < 35_000;
          const res = await fetch(`${basePath}/api/voice/live-transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              userMessageId,
              assistantMessageId,
              userText: turn.user,
              assistantText: turn.assistant,
              interrupted: turn.interrupted,
              skipAutoMemorySave,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            blocked?: boolean;
            savedMemoryPart?: Record<string, unknown> | null;
          };
          if (data.blocked) {
            engineRef.current?.stop();
            toast.error(
              "Voice mode stopped: employer work material can't go to the personal voice service."
            );
            return;
          }
          if (data.savedMemoryPart) {
            setMessages((prev) => {
              // Skip if Gemini Live already emitted a saveProfileFact card in the last 2 messages
              const recentHasSaveCard = prev
                .slice(-3)
                .some((m) =>
                  m.parts?.some(
                    (p) => (p.type as string) === "tool-saveProfileFact"
                  )
                );
              if (recentHasSaveCard) {
                return prev;
              }
              return prev.map((m) =>
                m.id === assistantMessageId
                  ? ({
                      ...m,
                      parts: [
                        data.savedMemoryPart as unknown as ChatMessage["parts"][number],
                        ...m.parts,
                      ],
                    } as ChatMessage)
                  : m
              );
            });
          }
        })
        .catch(() => undefined);
    },
    [basePath, chatId, setMessages]
  );

  const close = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    setOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  const handleToolStart = useCallback(
    (ev: LiveToolStartEvent) => {
      if (ev.name === "saveProfileFact" || ev.name === "addJournalEntry") {
        lastVoiceMemoryToolAtRef.current = Date.now();
      }
      const placeholderId = generateUUID();
      const safeCallId = ev.callId.replace(/[^a-zA-Z0-9_-]/g, "_");
      toolPlaceholderIdsRef.current.set(ev.callId, placeholderId);
      if (!urlPushedRef.current) {
        urlPushedRef.current = true;
        window.history.pushState({}, "", `${basePath}/chat/${chatId}`);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: placeholderId,
          role: "assistant",
          parts: [
            {
              type: `tool-${ev.name}`,
              toolCallId: safeCallId,
              state: "input-available",
              input: ev.args,
            } as unknown as ChatMessage["parts"][number],
          ],
          metadata: { createdAt: new Date().toISOString() },
        } as ChatMessage,
      ]);
    },
    [basePath, chatId, setMessages]
  );

  const handleToolDone = useCallback(
    (ev: LiveToolDoneEvent) => {
      if (
        ev.name === "saveProfileFact" ||
        ev.name === "addJournalEntry" ||
        ev.parts?.some(
          (p) =>
            p.type === "tool-saveProfileFact" ||
            p.type === "tool-addJournalEntry"
        )
      ) {
        lastVoiceMemoryToolAtRef.current = Date.now();
      }
      if (ev.blocked) {
        toast.error(
          "Voice mode stopped: employer work material can't go to the personal voice service."
        );
        return;
      }
      const placeholderId = toolPlaceholderIdsRef.current.get(ev.callId);
      toolPlaceholderIdsRef.current.delete(ev.callId);
      const status = String(ev.voiceResult?.status ?? "");
      if (status === "setup_required") {
        setPendingChatCardHint("Tap to connect account in chat");
      } else if (status === "awaiting_approval") {
        setPendingChatCardHint("Tap to review approval card in chat");
      }
      setMessages((prev) => {
        const nextParts =
          ev.parts && ev.parts.length > 0 ? ev.parts : [ev.toolPart];
        const nextMsg: ChatMessage = {
          id: ev.assistantMessageId,
          role: "assistant",
          parts: nextParts as unknown as ChatMessage["parts"],
          metadata: { createdAt: new Date().toISOString() },
        };
        if (placeholderId && prev.some((m) => m.id === placeholderId)) {
          return prev.map((m) => (m.id === placeholderId ? nextMsg : m));
        }
        return [...prev, nextMsg];
      });
    },
    [setMessages]
  );

  const launch = () => {
    engineRef.current?.stop();
    toolPlaceholderIdsRef.current.clear();
    setErrorMessage(null);
    setToolActivity(null);
    setPendingChatCardHint(null);
    setCaptions({ user: "", assistant: "" });
    setMuted(false);
    setPhase("connecting");
    const engine = new LiveVoiceEngine({
      basePath,
      sessionBody: sessionBody(),
      callbacks: {
        onPhase: setPhase,
        onCaptions: setCaptions,
        onLevel: setLevel,
        onTurn: (turn) => {
          persistTurn(turn);
        },
        onError: setErrorMessage,
        onToolActivity: setToolActivity,
        onToolStart: handleToolStart,
        onToolDone: handleToolDone,
      },
    });
    engineRef.current = engine;
    setOpen(true);
    // Synchronous inside the tap: unlocks AudioContext + mic + audio session.
    engine.start();
  };

  const onOrbTap = () => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    if (phase === "speaking") {
      engine.interrupt();
    } else if (phase === "paused" || phase === "error") {
      setErrorMessage(null);
      engine.resume();
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.setMuted(next);
  };

  const listeningLike = phase === "listening" || phase === "user-speaking";
  const mascotState: "idle" | "thinking" | "working" =
    phase === "thinking" || phase === "connecting" || phase === "reconnecting"
      ? "thinking"
      : phase === "speaking"
        ? "working"
        : "idle";
  const orbScale =
    phase === "user-speaking" && !muted ? 1 + Math.min(0.18, level * 0.35) : 1;

  return (
    <>
      <Button
        aria-label="Live voice chat"
        className="size-11! rounded-full border-transparent bg-send p-0 text-send-foreground shadow-none transition-colors duration-150 hover:bg-send/90 motion-reduce:transition-none"
        data-testid="live-voice-button"
        disabled={disabled}
        onClick={launch}
        onFocus={() => LiveVoiceEngine.prefetch(basePath, sessionBody())}
        onPointerDown={() => LiveVoiceEngine.prefetch(basePath, sessionBody())}
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
            <div
              aria-live="polite"
              className="flex items-center gap-2 rounded-full border border-[color:var(--hairline)] bg-card px-4 py-1.5 shadow-[var(--shadow-float)]"
              data-testid="live-voice-status"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-full",
                  muted
                    ? "bg-muted-foreground"
                    : listeningLike
                      ? "bg-emerald-500"
                      : phase === "speaking"
                        ? "animate-pulse bg-primary"
                        : phase === "error"
                          ? "bg-destructive"
                          : "animate-pulse bg-amber-500"
                )}
              />
              <span className="font-medium text-foreground text-xs">
                {toolActivity
                  ? toolActivity
                  : muted && listeningLike
                    ? "Microphone muted"
                    : PHASE_LABEL[phase]}
              </span>
            </div>

            <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 text-center">
              <button
                aria-label={
                  phase === "speaking"
                    ? "Interrupt assistant"
                    : phase === "paused" || phase === "error"
                      ? "Resume live voice"
                      : "Live voice assistant"
                }
                className="relative flex items-center justify-center rounded-full focus:outline-none"
                data-testid="live-voice-orb"
                onClick={onOrbTap}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute -inset-6 rounded-full transition-[transform,background-color] duration-150",
                    phase === "speaking"
                      ? "animate-pulse bg-primary/18"
                      : listeningLike && !muted
                        ? "bg-emerald-500/12"
                        : "bg-muted/40"
                  )}
                  style={{ transform: `scale(${orbScale})` }}
                />
                <AgentMascot
                  animated={phase !== "paused" && phase !== "error"}
                  className="relative rounded-full shadow-[var(--shadow-float)]"
                  size={132}
                  state={mascotState}
                  variant={variant}
                />
              </button>

              <div className="min-h-28 w-full space-y-3 px-2">
                {errorMessage ? (
                  <p
                    className="text-[16px] text-destructive leading-relaxed"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                ) : captions.assistant &&
                  (phase === "speaking" || !captions.user) ? (
                  <p
                    className="line-clamp-5 font-medium text-[19px] text-foreground leading-relaxed"
                    data-testid="live-voice-assistant-caption"
                  >
                    {captions.assistant}
                  </p>
                ) : captions.user ? (
                  <p
                    className="line-clamp-4 text-[18px] text-foreground leading-relaxed"
                    data-testid="live-voice-user-caption"
                  >
                    {captions.user}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {phase === "connecting"
                      ? "Getting ready…"
                      : phase === "paused"
                        ? "Tap the assistant to continue"
                        : muted
                          ? "Unmute to keep talking"
                          : "Talk naturally. You can interrupt anytime."}
                  </p>
                )}
                {pendingChatCardHint ? (
                  <div className="pt-2">
                    <button
                      className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs shadow-sm transition-colors hover:bg-primary/90"
                      data-testid="live-voice-open-chat-card"
                      onClick={close}
                      type="button"
                    >
                      {pendingChatCardHint}
                    </button>
                  </div>
                ) : null}
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
                data-testid="live-voice-mute"
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
                onClick={close}
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
