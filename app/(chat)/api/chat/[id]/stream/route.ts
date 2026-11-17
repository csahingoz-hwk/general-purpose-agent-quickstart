import {
  createUIMessageStream,
  JsonToSseTransformStream,
  UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { differenceInSeconds } from "date-fns";
import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getMessagesByChatId,
  getStreamIdsByChatId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { getStreamContext } from "../../route";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chatId } = await params;

  const streamContext = getStreamContext();
  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  if (!chatId) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const streamIds = await getStreamIdsByChatId({ chatId });
  const recentStreamId = streamIds.at(-1);
  if (!recentStreamId) {
    return new Response(null, { status: 204 });
  }

  const liveStream = await streamContext.resumeExistingStream(recentStreamId);
  if (liveStream) {
    return new Response(liveStream, {
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
    });
  }

  // If the ephemeral Redis stream already finished (or RAM evicted on the 30 MB
  // non-persistent tier), fall back to the authoritative message saved in Neon Postgres.
  const messages = await getMessagesByChatId({ id: chatId });
  const mostRecentMessage = messages.at(-1);
  if (!mostRecentMessage || mostRecentMessage.role !== "assistant") {
    return new Response(null, { status: 204 });
  }

  const ageSeconds = differenceInSeconds(
    new Date(),
    new Date(mostRecentMessage.createdAt)
  );
  if (ageSeconds > 15) {
    return new Response(null, { status: 204 });
  }

  const restoredStream = createUIMessageStream<ChatMessage>({
    execute: ({ writer }) => {
      writer.write({
        type: "data-appendMessage",
        data: JSON.stringify({
          id: mostRecentMessage.id,
          role: mostRecentMessage.role,
          parts: mostRecentMessage.parts,
          metadata: {
            createdAt: new Date(mostRecentMessage.createdAt).toISOString(),
          },
        }),
        transient: true,
      });
    },
  });

  return new Response(
    restoredStream.pipeThrough(new JsonToSseTransformStream()),
    {
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
    }
  );
}
