import { randomUUID } from "node:crypto";
import { createGateway, experimental_transcribe as transcribeAudio } from "ai";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { gatewayEnabled, LUNA, openAIEnabled } from "@/lib/ai/routing/catalog";
import { createUsageLedger } from "@/lib/ai/routing/ledger";
import { createPostgresVaultStore } from "@/lib/vault/secret-vault";
import {
  isVoiceEnabled,
  transcribeVoiceMemo,
  VOICE_VAULT_SECRET_NAMES,
  validateAudioUpload,
} from "@/lib/voice/voice-service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json(
      { serverSttReady: false, liveReady: false },
      { status: 401 }
    );
  }

  const gatewayReady = gatewayEnabled() || openAIEnabled();

  if (!isVoiceEnabled()) {
    return NextResponse.json({
      serverSttReady: gatewayReady,
      liveReady: false,
    });
  }

  try {
    const store = createPostgresVaultStore();
    const [geminiKey, openAiKey] = await Promise.all([
      store
        .resolveSecret({
          userId: session.user.id,
          name: VOICE_VAULT_SECRET_NAMES.geminiApiKey,
        })
        .catch(() => null),
      store
        .resolveSecret({
          userId: session.user.id,
          name: VOICE_VAULT_SECRET_NAMES.openaiApiKey,
        })
        .catch(() => null),
    ]);
    const hasGemini = Boolean(geminiKey?.trim());
    const hasOpenAi = Boolean(openAiKey?.trim());
    return NextResponse.json({
      serverSttReady: gatewayReady || hasGemini || hasOpenAi,
      liveReady: gatewayReady || hasGemini || hasOpenAi,
    });
  } catch {
    return NextResponse.json({
      serverSttReady: gatewayReady,
      liveReady: gatewayReady,
    });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await audio.arrayBuffer());
    const validated = validateAudioUpload({
      declaredType: audio.type,
      bytes,
    });

    if (!validated.valid) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const result = await transcribeVoiceMemo({
      userId: session.user.id,
      mimeType: validated.mimeType,
      bytes,
    });

    if (
      (result.status === "setup_required" || result.status === "error") &&
      gatewayEnabled()
    ) {
      const ledger = createUsageLedger(session.user.id, randomUUID());
      let reservationId: string | null = null;
      try {
        reservationId = await ledger.reserve({
          model: LUNA,
          reserveUsd: 0.01,
          fallbackReason: "voice:stt",
        });
        const gateway = createGateway();
        const stt = await transcribeAudio({
          model: gateway.transcriptionModel("openai/gpt-4o-mini-transcribe"),
          audio: bytes,
        });
        await ledger.settle(reservationId, LUNA, "voice_stt_ok");
        return NextResponse.json(
          {
            status: "ok",
            transcript: stt.text.trim(),
            provider: "openai",
            model: "openai/gpt-4o-mini-transcribe",
          },
          { status: 200 }
        );
      } catch {
        if (reservationId) {
          await ledger
            .settle(reservationId, LUNA, "voice_stt_failed", undefined, 0)
            .catch(() => null);
        }
        return NextResponse.json(
          {
            status: "error",
            message: "Voice transcription could not complete right now.",
          },
          { status: 502 }
        );
      }
    }

    if (result.status === "setup_required") {
      return NextResponse.json(
        {
          status: "setup_required",
          message:
            "Server voice transcription isn't active on this preview yet.",
        },
        { status: 503 }
      );
    }
    if (result.status === "blocked_data_boundary") {
      return NextResponse.json(result, { status: 422 });
    }
    if (result.status === "error") {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to process voice memo" },
      { status: 500 }
    );
  }
}
