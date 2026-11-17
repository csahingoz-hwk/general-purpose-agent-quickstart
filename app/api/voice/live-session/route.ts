import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { vertexEnabled } from "@/lib/ai/routing/catalog";
import {
  createPostgresBotRosterStore,
  filterFactsForBot,
} from "@/lib/bots/roster";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { selectRelevantFactsForPrompt } from "@/lib/memory/bulk-import";
import { createPostgresMemoryStore } from "@/lib/memory/store";
import {
  buildVoiceSystemInstruction,
  LiveVoiceSetupError,
  mintLiveVoiceToken,
  resolveLiveGeminiKey,
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

function validTimeZone(value: string | undefined): string {
  if (!value) {
    return "Europe/London";
  }
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return value;
  } catch {
    return "Europe/London";
  }
}

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
  const [teammate, facts, recentTurns] = await Promise.all([
    body.selectedBotSlug && hasDb
      ? createPostgresBotRosterStore()
          .getBotBySlug(userId, body.selectedBotSlug)
          .catch(() => null)
      : Promise.resolve(null),
    hasDb
      ? createPostgresMemoryStore()
          .listProfileFacts({ userId })
          .catch(() => [])
      : Promise.resolve([]),
    body.chatId && hasDb
      ? (async () => {
          const chat = await getChatById({ id: body.chatId as string }).catch(
            () => null
          );
          if (!chat || chat.userId !== userId) {
            return [];
          }
          const rows = await getMessagesByChatId({
            id: body.chatId as string,
          }).catch(() => []);
          return rows
            .slice(-8)
            .map((row) => {
              const parts = Array.isArray(row.parts)
                ? (row.parts as Array<{ type?: string; text?: string }>)
                : [];
              const text = parts
                .filter((p) => p.type === "text" && typeof p.text === "string")
                .map((p) => p.text)
                .join(" ")
                .trim();
              return text
                ? {
                    role:
                      row.role === "assistant"
                        ? ("assistant" as const)
                        : ("user" as const),
                    text,
                  }
                : null;
            })
            .filter(
              (t): t is { role: "user" | "assistant"; text: string } =>
                t !== null
            );
        })()
      : Promise.resolve([]),
  ]);

  const latestRecentText = recentTurns.at(-1)?.text ?? "";
  const safeVoiceFacts = filterFactsForBot(
    facts,
    teammate?.slug ?? "chief-of-staff"
  ).filter((f) => !containsRestrictedWorkData(`${f.key} ${f.value}`));
  const scopedFacts = selectRelevantFactsForPrompt(
    safeVoiceFacts,
    latestRecentText,
    80,
    6000
  ).map((f) => `[${f.category}] ${f.value}`);

  const systemInstruction = buildVoiceSystemInstruction({
    ownerName:
      session.user.name?.trim() ||
      process.env.APP_OWNER_NAME?.trim() ||
      "Çağlar",
    timeZone: validTimeZone(body.timeZone),
    teammate: teammate ? { name: teammate.name, soul: teammate.soul } : null,
    facts: scopedFacts,
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
