import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  executeSharedVoiceToolCall,
  fillerPhraseForTool,
} from "@/lib/ai/tools/shared-registry";
import {
  getChatById,
  getUserHomeLocation,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import { validTimeZone } from "@/lib/temporal";
import { generateUUID } from "@/lib/utils";
import { executeVoiceTextAgentHandoff } from "@/lib/voice/text-agent-handoff";

const requestSchema = z.object({
  chatId: z.string().uuid(),
  toolCallId: z.string().min(1).max(160),
  toolName: z.string().min(1).max(80),
  args: z.record(z.string(), z.unknown()).default({}),
  timeZone: z.string().max(80).optional(),
  locale: z.enum(["en", "tr"]).default("en"),
});

/**
 * Executes a Gemini 3.8 Live function call against the SAME shared tool
 * registry as text chat, persists the resulting card into chat history, and
 * returns the compact structured tool response for the Live WebSocket.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid tool call" }, { status: 400 });
  }

  const userId = session.user.id;
  const resolvedTz = validTimeZone(body.timeZone) ?? "Europe/London";
  const hasDb = Boolean(process.env.POSTGRES_URL?.trim());
  const homeLocation = hasDb
    ? await getUserHomeLocation({ userId }).catch(() => null)
    : null;

  const isTextAgentHandoff = body.toolName === "handOffToTextAgent";
  const handoffOutcome = isTextAgentHandoff
    ? await executeVoiceTextAgentHandoff({
        session,
        userId,
        chatId: body.chatId,
        request: typeof body.args.request === "string" ? body.args.request : "",
        locale: body.locale,
        timeZone: resolvedTz,
        homeLocation,
      })
    : null;

  const outcome = handoffOutcome
    ? {
        blocked: handoffOutcome.blocked,
        toolPart: handoffOutcome.toolPart,
        parts: handoffOutcome.parts,
        voiceResult: handoffOutcome.voiceResult,
      }
    : {
        ...(await executeSharedVoiceToolCall({
          session,
          userId,
          timeZone: resolvedTz,
          homeLocation,
          toolCallId: body.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
          toolName: body.toolName,
          args: body.args,
        })),
        parts: undefined as Record<string, unknown>[] | undefined,
      };

  const assistantMessageId = generateUUID();
  const persistedParts = outcome.parts ?? [outcome.toolPart];

  if (hasDb && !outcome.blocked) {
    try {
      let existing = await getChatById({ id: body.chatId });
      if (!existing) {
        try {
          await saveChat({
            id: body.chatId,
            userId,
            title: fillerPhraseForTool(body.toolName, body.locale).replace(
              "…",
              ""
            ),
            visibility: "private",
          });
        } catch {
          existing = await getChatById({ id: body.chatId });
        }
      }
      if (!existing || existing.userId === userId) {
        await saveMessages({
          messages: [
            {
              id: assistantMessageId,
              chatId: body.chatId,
              role: "assistant",
              parts: persistedParts,
              attachments: [],
              createdAt: new Date(),
            },
          ],
        });
      }
    } catch {
      /* non-fatal: UI still mirrors the card immediately via setMessages */
    }
  }

  return NextResponse.json(
    {
      status: "ok",
      assistantMessageId,
      filler: fillerPhraseForTool(body.toolName, body.locale),
      toolPart: outcome.toolPart,
      parts: persistedParts,
      voiceResult: outcome.voiceResult,
      blocked: outcome.blocked === true,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
