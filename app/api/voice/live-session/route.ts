import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { resolveLiveCapabilityManifest } from "@/lib/ai/capability-manifest";
import { vertexEnabled } from "@/lib/ai/routing/catalog";
import {
  createPostgresBotRosterStore,
  filterFactsForBot,
} from "@/lib/bots/roster";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  getChatById,
  getMessagesByChatId,
  getUserHomeLocation,
} from "@/lib/db/queries";
import {
  buildGroupedMemoryPromptBlock,
  isAllowedShortKornFerryContextFact,
} from "@/lib/memory/bulk-import";
import { createPostgresMemoryStore } from "@/lib/memory/store";
import {
  buildCompactVoiceRecentTurns,
  buildVoiceSystemInstruction,
  LiveVoiceSetupError,
  mintLiveVoiceToken,
  resolveLiveGeminiKey,
  resolveLiveSessionTimeZone,
} from "@/lib/voice/live-session";
import { isVoiceEnabled } from "@/lib/voice/voice-service";

const bodySchema = z
  .object({
    chatId: z.string().uuid().optional(),
    selectedBotSlug: z.string().max(80).optional(),
    timeZone: z.string().max(80).optional(),
    resumeHandle: z.string().max(2048).optional(),
  })
  .default({});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isVoiceEnabled()) {
    return NextResponse.json(
      { status: "setup_required", message: "Live voice is turned off." },
      { status: 503 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    body = bodySchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const userId = session.user.id;
  const useVertex = vertexEnabled();
  const apiKey = useVertex ? null : await resolveLiveGeminiKey(userId);
  if (!useVertex && !apiKey) {
    return NextResponse.json(
      {
        status: "setup_required",
        message: "Live voice needs Google Cloud Vertex AI WIF configured.",
      },
      { status: 503 }
    );
  }

  const hasDb = Boolean(process.env.POSTGRES_URL?.trim());
  const voiceMemoryStore = hasDb ? createPostgresMemoryStore() : null;
  const [
    teammate,
    facts,
    journalEntries,
    homeLocation,
    chatRows,
    capabilityManifest,
  ] = await Promise.all([
    body.selectedBotSlug && hasDb
      ? createPostgresBotRosterStore()
          .getBotBySlug(userId, body.selectedBotSlug)
          .catch(() => null)
      : Promise.resolve(null),
    voiceMemoryStore
      ? voiceMemoryStore.listProfileFacts({ userId }).catch(() => [])
      : Promise.resolve([]),
    voiceMemoryStore
      ? voiceMemoryStore
          .listJournalEntries({ userId, limit: 25 })
          .catch(() => [])
      : Promise.resolve([]),
    hasDb
      ? getUserHomeLocation({ userId }).catch(() => null)
      : Promise.resolve(null),
    body.chatId && hasDb
      ? (async () => {
          const [chat, rows] = await Promise.all([
            getChatById({ id: body.chatId as string }).catch(() => null),
            getMessagesByChatId({ id: body.chatId as string }).catch(() => []),
          ]);
          if (!chat || chat.userId !== userId) {
            return [];
          }
          return rows;
        })()
      : Promise.resolve([]),
    resolveLiveCapabilityManifest({
      userId,
      isGuest: false,
      webSearchAvailable: useVertex,
      skipLiveProbe: true,
    }),
  ]);

  const sessionTimeZone = resolveLiveSessionTimeZone(
    body.timeZone,
    homeLocation?.timeZone
  );
  const recentTurns = buildCompactVoiceRecentTurns(chatRows, {
    maxRows: 20,
    maxChars: 6000,
    timeZone: sessionTimeZone,
  });

  const latestRecentText = recentTurns.at(-1)?.text ?? "";
  const safeVoiceFacts = filterFactsForBot(
    facts,
    teammate?.slug ?? "chief-of-staff"
  ).filter(
    (f) =>
      !containsRestrictedWorkData(`${f.key} ${f.value}`) ||
      isAllowedShortKornFerryContextFact(f.value)
  );
  const groupedMemoryBlock = buildGroupedMemoryPromptBlock(
    safeVoiceFacts,
    latestRecentText,
    { maxFacts: 80, maxChars: 6000, journalEntries }
  );

  const systemInstruction = buildVoiceSystemInstruction({
    ownerName:
      session.user.name?.trim() ||
      process.env.APP_OWNER_NAME?.trim() ||
      "Çağlar",
    timeZone: sessionTimeZone,
    teammate: teammate ? { name: teammate.name, soul: teammate.soul } : null,
    groupedMemoryBlock,
    capabilityManifest,
    recentTurns,
  });

  try {
    const grant = await mintLiveVoiceToken({
      apiKey,
      preferVertex: useVertex,
      systemInstruction,
      resumeHandle: body.resumeHandle ?? null,
    });
    return NextResponse.json(
      { status: "ready", ...grant },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message =
      err instanceof LiveVoiceSetupError
        ? err.message
        : "Live voice could not start right now.";
    console.error("live-voice token error", {
      code: err instanceof LiveVoiceSetupError ? err.code : "unknown",
      message,
    });
    return NextResponse.json({ status: "error", message }, { status: 502 });
  }
}
