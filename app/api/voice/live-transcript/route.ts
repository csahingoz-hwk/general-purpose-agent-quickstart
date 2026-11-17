import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { getChatById, saveChat, saveMessages } from "@/lib/db/queries";

const turnSchema = z.object({
  chatId: z.string().uuid(),
  userMessageId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
  userText: z.string().max(8000).default(""),
  assistantText: z.string().max(16_000).default(""),
  interrupted: z.boolean().default(false),
});

/** Persists one committed live-voice turn into the chat history. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof turnSchema>;
  try {
    body = turnSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
  }

  const userText = body.userText.trim();
  const assistantText = body.assistantText.trim();
  if (!userText && !assistantText) {
    return NextResponse.json({ saved: false });
  }

  // Personal Google voice endpoint: employer material must not continue there.
  if (containsRestrictedWorkData(`${userText}\n${assistantText}`)) {
    return NextResponse.json({ saved: false, blocked: true });
  }

  if (!process.env.POSTGRES_URL?.trim()) {
    return NextResponse.json({ saved: false });
  }

  try {
    let existing = await getChatById({ id: body.chatId });
    if (!existing) {
      try {
        await saveChat({
          id: body.chatId,
          userId: session.user.id,
          title: (userText || "Voice conversation").slice(0, 60),
          visibility: "private",
        });
      } catch {
        existing = await getChatById({ id: body.chatId });
      }
    }
    if (existing && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const now = Date.now();
    const rows = [
      ...(userText
        ? [
            {
              id: body.userMessageId,
              chatId: body.chatId,
              role: "user",
              parts: [{ type: "text", text: userText }],
              attachments: [],
              createdAt: new Date(now),
            },
          ]
        : []),
      ...(assistantText
        ? [
            {
              id: body.assistantMessageId,
              chatId: body.chatId,
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: body.interrupted ? `${assistantText} …` : assistantText,
                },
              ],
              attachments: [],
              createdAt: new Date(now + 1),
            },
          ]
        : []),
    ];
    await saveMessages({ messages: rows });
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ saved: false }, { status: 500 });
  }
}
