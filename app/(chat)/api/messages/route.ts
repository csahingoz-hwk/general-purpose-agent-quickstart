import { auth } from "@/app/(auth)/auth";
import { markMidFlightToolsInterrupted } from "@/lib/ai/conversation-state";
import { acquireChatLock } from "@/lib/db/chat-lock";
import {
  getChatById,
  getMessagesByChatId,
  updateMessage,
} from "@/lib/db/queries";
import { convertToUIMessages } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  const [session, chat, messages] = await Promise.all([
    auth(),
    getChatById({ id: chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  if (!chat) {
    return Response.json({
      messages: [],
      visibility: "private",
      userId: null,
      isReadonly: false,
    });
  }

  if (!session?.user || session.user.id !== chat.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const isReadonly = !session?.user || session.user.id !== chat.userId;
  let uiMessages = convertToUIMessages(messages);

  // If no live turn holds the chat lock (e.g. after a restart/redeploy),
  // mark any mid-flight tool calls interrupted so they never replay twice.
  const lock = await acquireChatLock(chatId).catch(() => null);
  if (lock) {
    try {
      const sweep = markMidFlightToolsInterrupted(uiMessages);
      if (sweep.interruptedMessages.length > 0) {
        uiMessages = sweep.messages;
        await Promise.all(
          sweep.interruptedMessages.map((msg) =>
            updateMessage({ id: msg.id, parts: msg.parts }).catch(() => null)
          )
        );
      }
    } finally {
      await lock();
    }
  }

  return Response.json({
    messages: uiMessages,
    visibility: chat.visibility,
    userId: chat.userId,
    isReadonly,
  });
}
