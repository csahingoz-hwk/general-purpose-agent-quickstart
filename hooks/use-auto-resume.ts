"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useEffect, useRef } from "react";
import { useDataStream } from "@/components/chat/data-stream-provider";
import type { ChatMessage } from "@/lib/types";

export type UseAutoResumeParams = {
  autoResume: boolean;
  initialMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
};

const MAX_AUTO_RESUME_AGE_MS = 60_000;

export function useAutoResume({
  autoResume,
  initialMessages,
  resumeStream,
  setMessages,
}: UseAutoResumeParams) {
  const { dataStream } = useDataStream();
  const attemptedMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoResume) {
      return;
    }

    const mostRecentMessage = initialMessages.at(-1);
    if (mostRecentMessage?.role !== "user") {
      return;
    }
    if (attemptedMessageIdRef.current === mostRecentMessage.id) {
      return;
    }
    const createdAtIso = mostRecentMessage.metadata?.createdAt;
    if (createdAtIso) {
      const ageMs = Date.now() - new Date(createdAtIso).getTime();
      if (Number.isFinite(ageMs) && ageMs > MAX_AUTO_RESUME_AGE_MS) {
        return;
      }
    }

    attemptedMessageIdRef.current = mostRecentMessage.id;
    resumeStream();
  }, [autoResume, initialMessages, resumeStream]);

  useEffect(() => {
    if (!dataStream || dataStream.length === 0) {
      return;
    }

    const dataPart = dataStream[0];

    if (dataPart.type === "data-appendMessage") {
      const message = JSON.parse(dataPart.data);
      setMessages([...initialMessages, message]);
    }
  }, [dataStream, initialMessages, setMessages]);
}
