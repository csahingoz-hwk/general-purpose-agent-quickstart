import { createGateway, generateSpeech, streamText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getRequestModelAvailability } from "@/lib/ai/model-runtime";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { gatewayEnabled, isPremiumModel, LUNA } from "@/lib/ai/routing/catalog";
import { createUsageLedger } from "@/lib/ai/routing/ledger";
import { inferenceSession } from "@/lib/ai/routing/session";
import {
  createPostgresBotRosterStore,
  filterFactsForBot,
} from "@/lib/bots/roster";
import { getChatById, saveChat, saveMessages } from "@/lib/db/queries";
import { createPostgresMemoryStore } from "@/lib/memory/store";
import { generateUUID } from "@/lib/utils";
import { createPostgresVaultStore } from "@/lib/vault/secret-vault";
import {
  cleanTextForSpeech,
  splitCompletedSentence,
  VOICE_VAULT_SECRET_NAMES,
} from "@/lib/voice/voice-service";

const voiceTurnSchema = z.object({
  chatId: z.string().uuid(),
  userMessageId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
  selectedBotSlug: z.string().max(80).optional(),
  timeZone: z.string().max(80).optional(),
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(4000),
      })
    )
    .min(1)
    .max(16),
});

async function synthesizeSentenceMp3({
  text,
  userId,
  signal,
}: {
  text: string;
  userId: string;
  signal: AbortSignal;
}): Promise<string | null> {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) {
    return null;
  }

  if (gatewayEnabled()) {
    try {
      const gateway = createGateway();
      const res = await generateSpeech({
        model: gateway.speechModel("openai/tts-1"),
        text: cleaned,
        voice: "nova",
        outputFormat: "mp3",
        abortSignal: signal,
      });
      if (res.audio?.base64) {
        return res.audio.base64;
      }
    } catch {
      /* fall through to direct key if configured */
    }
  }

  const directKey =
    process.env.OPENAI_VOICE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    (
      await createPostgresVaultStore()
        .resolveSecret({
          userId,
          name: VOICE_VAULT_SECRET_NAMES.openaiApiKey,
        })
        .catch(() => null)
    )?.trim() ||
    "";

  if (directKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${directKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "nova",
          input: cleaned,
          response_format: "mp3",
        }),
        signal,
      });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        return bytes.toString("base64");
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof voiceTurnSchema>;
  try {
    body = voiceTurnSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid voice turn" }, { status: 400 });
  }

  const availability = await getRequestModelAvailability();
  if (availability.status !== "ready" || availability.models.length === 0) {
    return NextResponse.json(
      { error: "Assistant model lane is not ready yet." },
      { status: 503 }
    );
  }

  const chosenModel =
    availability.models.find((m) => m.id === DEFAULT_CHAT_MODEL)?.id ??
    availability.models[0].id;

  const [teammate, facts] = await Promise.all([
    body.selectedBotSlug
      ? createPostgresBotRosterStore()
          .getBotBySlug(session.user.id, body.selectedBotSlug)
          .catch(() => null)
      : Promise.resolve(null),
    process.env.POSTGRES_URL
      ? createPostgresMemoryStore()
          .listProfileFacts({ userId: session.user.id })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const scopedFacts = filterFactsForBot(
    facts,
    teammate?.slug ?? "chief-of-staff"
  ).slice(0, 10);
  const factsLine =
    scopedFacts.length > 0
      ? `\nOwner context:\n${scopedFacts
          .map((f) => `- ${f.value}`)
          .join("\n")
          .slice(0, 600)}`
      : "";

  const voiceSystemPrompt = [
    "You are in a real-time, hands-free live voice conversation with the workspace owner.",
    "CRITICAL VOICE RULES:",
    "1. Reply in the EXACT language the user just spoke (English or Turkish).",
    "2. Speak naturally like a warm, sharp human assistant on a live call — 1 to 3 concise spoken sentences.",
    "3. NEVER output markdown, bullet points, numbered lists, asterisks, code fences, or URLs. Write pure spoken prose.",
    `Current time: ${new Date().toISOString()} (${body.timeZone || "Europe/London"}).`,
    teammate ? `Active role: ${teammate.name}. ${teammate.soul}` : "",
    factsLine,
  ]
    .filter(Boolean)
    .join("\n");

  const ledger = createUsageLedger(session.user.id, generateUUID());
  const execution = {
    ledger,
    available: availability.models.map((m) => m.id).filter(isPremiumModel),
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
  };

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), {
    once: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          /* client closed */
        }
      };

      let ttsReservationId: string | null = null;
      try {
        if (isPremiumModel(chosenModel)) {
          ttsReservationId = await ledger
            .reserve({
              model: LUNA,
              reserveUsd: 0.005,
              fallbackReason: "voice:tts",
            })
            .catch(() => null);
        }

        const fullText = await inferenceSession.run(execution, async () => {
          const result = streamText({
            model: getLanguageModel(chosenModel),
            system: voiceSystemPrompt,
            messages: body.turns.map((t) => ({
              role: t.role,
              content: t.text,
            })),
            maxOutputTokens: 220,
            maxRetries: 0,
            abortSignal: AbortSignal.any([
              abortController.signal,
              AbortSignal.timeout(25_000),
            ]),
            onError: () => {
              /* handled below */
            },
          });

          let pendingSentenceBuffer = "";
          let accumulatedText = "";
          let nextIndex = 0;
          const ttsQueue: Promise<void>[] = [];
          // Chain audio emissions strictly in sentence order even when synthesized concurrently
          let emitChain = Promise.resolve();

          const queueSentenceSpeech = (sentenceText: string) => {
            const idx = nextIndex++;
            const synthPromise = synthesizeSentenceMp3({
              text: sentenceText,
              userId: session.user.id,
              signal: abortController.signal,
            });
            emitChain = emitChain.then(async () => {
              const base64 = await synthPromise;
              if (abortController.signal.aborted) {
                return;
              }
              if (base64) {
                writeEvent({
                  type: "audio",
                  index: idx,
                  base64,
                  mimeType: "audio/mpeg",
                  text: sentenceText,
                });
              } else {
                writeEvent({
                  type: "tts-fallback",
                  index: idx,
                  text: cleanTextForSpeech(sentenceText),
                });
              }
            });
            ttsQueue.push(emitChain);
          };

          for await (const delta of result.textStream) {
            if (abortController.signal.aborted) {
              break;
            }
            accumulatedText += delta;
            pendingSentenceBuffer += delta;
            writeEvent({ type: "text-delta", delta });

            while (true) {
              const split = splitCompletedSentence(pendingSentenceBuffer);
              if (!split.sentence) {
                break;
              }
              pendingSentenceBuffer = split.rest;
              queueSentenceSpeech(split.sentence);
            }
          }

          if (pendingSentenceBuffer.trim() && !abortController.signal.aborted) {
            queueSentenceSpeech(pendingSentenceBuffer.trim());
          }

          await Promise.allSettled(ttsQueue);
          return accumulatedText.trim();
        });

        if (ttsReservationId) {
          await ledger
            .settle(ttsReservationId, LUNA, "voice_tts_ok")
            .catch(() => null);
        }

        const latestUserTurn = body.turns.at(-1);
        if (
          process.env.POSTGRES_URL?.trim() &&
          latestUserTurn?.role === "user" &&
          fullText
        ) {
          try {
            const existingChat = await getChatById({ id: body.chatId });
            if (!existingChat) {
              await saveChat({
                id: body.chatId,
                userId: session.user.id,
                title: latestUserTurn.text.slice(0, 60),
                visibility: "private",
              });
            }
            if (!existingChat || existingChat.userId === session.user.id) {
              const now = new Date();
              await saveMessages({
                messages: [
                  {
                    id: body.userMessageId,
                    chatId: body.chatId,
                    role: "user",
                    parts: [{ type: "text", text: latestUserTurn.text }],
                    attachments: [],
                    createdAt: now,
                  },
                  {
                    id: body.assistantMessageId,
                    chatId: body.chatId,
                    role: "assistant",
                    parts: [{ type: "text", text: fullText }],
                    attachments: [],
                    createdAt: new Date(now.getTime() + 1),
                  },
                ],
              });
            }
          } catch {
            /* non-fatal persistence */
          }
        }

        writeEvent({ type: "done", fullText });
      } catch {
        if (ttsReservationId) {
          await ledger
            .settle(ttsReservationId, LUNA, "voice_tts_err", undefined, 0)
            .catch(() => null);
        }
        writeEvent({
          type: "error",
          message: "Voice reply interrupted — speak again whenever ready.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
