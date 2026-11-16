"use client";

import { MicIcon, PhoneCallIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSessionInfo | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  const stopAndTranscribe = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error(
        "Microphone recording is not supported in this browser; use text input instead."
      );
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
        cleanupStream();

        if (blob.size === 0) {
          return;
        }

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "voice-memo.webm");
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/voice/transcribe`,
            {
              method: "POST",
              body: form,
            }
          );
          const data = (await res.json()) as {
            status?: string;
            transcript?: string;
            message?: string;
            error?: string;
          };
          if (res.ok && data.transcript) {
            onTranscript(data.transcript);
            toast.success("Voice memo transcribed — review before sending.");
          } else {
            toast.error(
              data.message ??
                data.error ??
                "Voice transcription is not configured yet."
            );
          }
        } catch {
          toast.error("Failed to transcribe voice memo.");
        } finally {
          setTranscribing(false);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      cleanupStream();
      setRecording(false);
      toast.error(
        "Microphone permission denied or unavailable; continuing with text chat."
      );
    }
  }, [cleanupStream, onTranscript]);

  const initializeLiveSession = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/voice/live-session`,
        { method: "POST" }
      );
      const data = (await res.json()) as LiveSessionInfo;
      setLiveSession(data);
    } catch {
      setLiveSession({
        status: "error",
        message: "Could not reach /api/voice/live-session.",
      });
    } finally {
      setLiveLoading(false);
    }
  }, []);

  return (
    <>
      <Button
        aria-label={recording ? "Stop voice memo" : "Record voice memo"}
        className={cn(
          "size-11! rounded-full border-transparent bg-control p-0 shadow-none transition-colors motion-reduce:transition-none hover:bg-control",
          recording ? "bg-destructive/15 text-destructive" : "text-foreground"
        )}
        data-testid="voice-memo-button"
        disabled={(disabled && !recording) || transcribing}
        onClick={(e) => {
          e.preventDefault();
          if (recording) {
            stopAndTranscribe();
          } else {
            startRecording().catch(() => null);
          }
        }}
        title={
          recording
            ? "Stop recording & transcribe"
            : transcribing
              ? "Transcribing voice memo…"
              : "Dictate voice memo (personal use)"
        }
        type="button"
        variant="ghost"
      >
        {recording ? (
          <SquareIcon aria-hidden="true" className="size-4" />
        ) : (
          <MicIcon aria-hidden="true" className="size-4" />
        )}
      </Button>

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
            title="Gemini Live API voice sheet (personal use)"
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
              Gemini Live API (current model) · personal assistant use only.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-4 text-sm">
            <div className="rounded-2xl border border-[color:var(--hairline)] bg-muted/40 p-3.5 text-muted-foreground text-xs leading-relaxed">
              <p className="font-medium text-foreground">
                Confidentiality & Billing Guardrail
              </p>
              <p className="mt-1">
                Paid per-use Gemini API usage billed against your Google Cloud
                credit. Never discuss Korn Ferry or employer confidential
                material in personal voice sessions.
              </p>
            </div>

            {liveLoading ? (
              <p className="text-muted-foreground text-sm">
                Checking Secret Vault voice session readiness…
              </p>
            ) : liveSession?.status === "ready" ? (
              <div className="space-y-3 rounded-2xl border border-[color:var(--hairline)] bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Session Ready</span>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-300">
                    {liveSession.model}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Est. ~{liveSession.estimatedTokensPerMinute} audio tokens/min
                  · Session expires at{" "}
                  {liveSession.expiresAt
                    ? new Date(liveSession.expiresAt).toLocaleTimeString()
                    : "soon"}
                  .
                </p>
                <p className="text-muted-foreground text-xs">
                  Use the microphone button in the composer to dictate bilingual
                  EN/TR memos into editable text immediately, or connect your
                  preferred WebRTC audio client to session{" "}
                  <code className="font-mono">
                    {liveSession.sessionId?.slice(0, 8)}
                  </code>
                  .
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-muted-foreground text-xs leading-relaxed">
                {liveSession?.message ??
                  "Set VOICE_ENABLED=true and save GEMINI_API_KEY in /routines -> Secret Vault to activate live voice."}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
