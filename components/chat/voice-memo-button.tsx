"use client";

import { MicIcon, PhoneCallIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn, fetcher } from "@/lib/utils";

type VoiceReadiness = {
  serverSttReady: boolean;
  liveReady: boolean;
};

type LiveSessionInfo = {
  status: "ready" | "setup_required" | "error";
  sessionId?: string;
  model?: string;
  billingNotice?: string;
  dataBoundaryNotice?: string;
  estimatedTokensPerMinute?: number;
  expiresAt?: string;
  message?: string;
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

export function VoiceMemoControls({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [hasSpeechApi, setHasSpeechApi] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSessionInfo | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const uncommittedInterimRef = useRef<string>("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { data: readiness } = useSWR<VoiceReadiness>(
    `${basePath}/api/voice/transcribe`,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  useEffect(() => {
    setHasSpeechApi(Boolean(getSpeechRecognitionCtor()));
  }, []);

  const cleanupMediaStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  const cleanupRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    uncommittedInterimRef.current = "";
  }, []);

  useEffect(() => {
    return () => {
      cleanupMediaStream();
      cleanupRecognition();
    };
  }, [cleanupMediaStream, cleanupRecognition]);

  const stopDictation = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        cleanupRecognition();
      }
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setRecording(false);
  }, [cleanupRecognition]);

  const startBrowserSpeechDictation = useCallback(
    (Ctor: SpeechRecognitionConstructor) => {
      try {
        const recognition = new Ctor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang =
          (typeof navigator !== "undefined" && navigator.language) || "en-GB";

        uncommittedInterimRef.current = "";

        recognition.onresult = (event) => {
          let finalChunk = "";
          let interimChunk = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const res = event.results[i];
            const piece = res?.[0]?.transcript ?? "";
            if (res?.isFinal) {
              finalChunk += piece;
            } else {
              interimChunk += piece;
            }
          }
          if (finalChunk.trim()) {
            uncommittedInterimRef.current = "";
            onTranscript(finalChunk.trim());
          } else {
            uncommittedInterimRef.current = interimChunk.trim();
          }
        };

        recognition.onerror = (event) => {
          const code = event.error ?? "";
          uncommittedInterimRef.current = "";
          setRecording(false);
          recognitionRef.current = null;
          if (code === "not-allowed" || code === "service-not-allowed") {
            toast.error(
              "Microphone access is turned off. Allow microphone access in browser settings or type your message."
            );
          } else if (code && code !== "aborted" && code !== "no-speech") {
            toast.error(
              "Voice dictation stopped unexpectedly. Try again or type your message."
            );
          }
        };

        recognition.onend = () => {
          // Flush any trailing interim speech iOS Safari didn't mark final before stopping
          const leftover = uncommittedInterimRef.current.trim();
          uncommittedInterimRef.current = "";
          recognitionRef.current = null;
          setRecording(false);
          if (leftover) {
            onTranscript(leftover);
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
        setRecording(true);
      } catch {
        cleanupRecognition();
        setRecording(false);
        toast.error(
          "Voice dictation could not start in this browser; please type your message."
        );
      }
    },
    [cleanupRecognition, onTranscript]
  );

  const startServerAudioMemo = useCallback(async () => {
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
        cleanupMediaStream();

        if (blob.size === 0) {
          return;
        }

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "voice-memo.webm");
          const res = await fetch(`${basePath}/api/voice/transcribe`, {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as {
            transcript?: string;
            message?: string;
          };
          if (res.ok && data.transcript) {
            onTranscript(data.transcript);
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
      cleanupMediaStream();
      setRecording(false);
      toast.error(
        "Microphone access is turned off. Allow microphone access in browser settings or type your message."
      );
    }
  }, [basePath, cleanupMediaStream, onTranscript]);

  const initializeLiveSession = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await fetch(`${basePath}/api/voice/live-session`, {
        method: "POST",
      });
      const data = (await res.json()) as LiveSessionInfo;
      setLiveSession(data);
    } catch {
      setLiveSession({
        status: "error",
        message: "Live voice session could not connect right now.",
      });
    } finally {
      setLiveLoading(false);
    }
  }, [basePath]);

  const serverSttReady = readiness?.serverSttReady === true;
  const liveReady = readiness?.liveReady === true;
  const canDictate = hasSpeechApi || serverSttReady;

  if (!canDictate && !liveReady) {
    return null;
  }

  return (
    <>
      {canDictate && (
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
              stopDictation();
              return;
            }
            const SpeechCtor = getSpeechRecognitionCtor();
            if (SpeechCtor && !serverSttReady) {
              // Synchronous start inside click handler (required by iOS Safari WebKit)
              startBrowserSpeechDictation(SpeechCtor);
              return;
            }
            if (serverSttReady) {
              startServerAudioMemo().catch(() => null);
              return;
            }
            if (SpeechCtor) {
              startBrowserSpeechDictation(SpeechCtor);
            }
          }}
          title={
            recording
              ? "Tap to finish dictation"
              : transcribing
                ? "Transcribing…"
                : "Dictate with voice"
          }
          type="button"
          variant="ghost"
        >
          {recording ? (
            <SquareIcon aria-hidden="true" className="size-4 fill-current" />
          ) : (
            <MicIcon aria-hidden="true" className="size-4" />
          )}
        </Button>
      )}

      {liveReady && (
        <Sheet
          onOpenChange={(next) => {
            setLiveOpen(next);
            if (next) {
              initializeLiveSession().catch(() => null);
            }
          }}
          open={liveOpen}
        >
          <SheetTrigger asChild>
            <Button
              aria-label="Live voice session"
              className="hidden size-11! rounded-full border-transparent bg-control p-0 text-foreground shadow-none transition-colors motion-reduce:transition-none hover:bg-control sm:inline-flex"
              data-testid="live-voice-button"
              disabled={disabled}
              title="Live voice session"
              type="button"
              variant="ghost"
            >
              <PhoneCallIcon aria-hidden="true" className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-md" side="right">
            <SheetHeader>
              <SheetTitle>Live Voice Session</SheetTitle>
              <SheetDescription>
                Real-time two-way voice · personal assistant use only.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-4 text-sm">
              {liveLoading ? (
                <p className="text-muted-foreground text-sm">
                  Preparing voice session…
                </p>
              ) : liveSession?.status === "ready" ? (
                <div className="space-y-3 rounded-2xl border border-[color:var(--hairline)] bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Session ready</span>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                      {liveSession.model}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Est. ~{liveSession.estimatedTokensPerMinute} audio
                    tokens/min
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {liveSession?.message ??
                    "Live voice is not active right now."}
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
