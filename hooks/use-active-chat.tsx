"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { expirePendingApprovalsOnNewUserTurn } from "@/lib/ai/conversation-state";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  error: UseChatHelpers<ChatMessage>["error"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  earlierSummary: string | null;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useState("");
  const { data: modelAvailability } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000 }
  );
  useEffect(() => {
    if (modelAvailability?.status !== "ready") {
      return;
    }
    if (
      !modelAvailability.models.some(
        (model: { id: string }) => model.id === currentModelId
      )
    ) {
      const selected = modelAvailability.defaultModelId;
      if (selected) {
        currentModelIdRef.current = selected;
        setCurrentModelId(selected);
      }
    }
  }, [modelAvailability, currentModelId]);

  const { data: chatData, isLoading } = useSWR(
    isNewChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = isNewChat
    ? []
    : (chatData?.messages ?? []);
  const visibility: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const lastErrorToastAtRef = useRef(0);

  const {
    messages,
    setMessages,
    sendMessage: rawSendMessage,
    status,
    error,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
  } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      return (
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false
      );
    },
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isRetry = request.trigger === "regenerate-message";
        const retryUserMessage = isRetry
          ? [...request.messages].reverse().find((msg) => msg.role === "user")
          : undefined;
        const isToolApprovalContinuation =
          !isRetry &&
          lastMessage?.role === "assistant" &&
          lastMessage.parts.some(
            (part) => "state" in part && part.state === "approval-responded"
          );

        let activeBotSlug: string | null = null;
        try {
          activeBotSlug =
            window.localStorage.getItem("assistant-active-bot")?.trim() || null;
        } catch {
          activeBotSlug = null;
        }

        return {
          body: {
            id: request.id,
            ...(isRetry
              ? { message: retryUserMessage, retry: true }
              : isToolApprovalContinuation
                ? { messages: request.messages }
                : { message: lastMessage }),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibility,
            timeZone: browserTimeZone(),
            ...(activeBotSlug ? { selectedBotSlug: activeBotSlug } : {}),
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      mutate(`${base}/api/memory`);
      mutate(`${base}/api/usage`);
    },
    onError: (err) => {
      // When an assistant bubble is already mounted in the transcript (e.g. after
      // a tool card like Weather rendered), `Messages` renders a single inline
      // status banner + Retry button; avoid popping a duplicate floating toast.
      if (messagesRef.current.at(-1)?.role === "assistant") {
        return;
      }
      const now = Date.now();
      if (now - lastErrorToastAtRef.current < 1500) {
        return;
      }
      lastErrorToastAtRef.current = now;
      toast({
        type: "error",
        description:
          err.message ||
          "Couldn't finish this reply. Tap Retry response to continue.",
      });
    },
  });
  messagesRef.current = messages;

  const sendMessage = useCallback<UseChatHelpers<ChatMessage>["sendMessage"]>(
    (msg, options) => {
      const hasWaitingApproval = messagesRef.current.some((m) =>
        m.parts.some(
          (p) =>
            p.type.startsWith("tool-") &&
            "state" in p &&
            p.state === "approval-requested"
        )
      );
      if (hasWaitingApproval) {
        setMessages(
          (prev) => expirePendingApprovalsOnNewUserTurn(prev).messages
        );
      }
      return rawSendMessage(msg, options);
    },
    [rawSendMessage, setMessages]
  );

  const loadedChatIds = useRef(new Set<string>());

  if (isNewChat && !loadedChatIds.current.has(newChatIdRef.current)) {
    loadedChatIds.current.add(newChatIdRef.current);
  }

  useEffect(() => {
    if (loadedChatIds.current.has(chatId)) {
      return;
    }
    if (chatData?.messages) {
      loadedChatIds.current.add(chatId);
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  useEffect(() => {
    if (modelAvailability?.status === "ready") {
      const cookieModel = document.cookie
        .split("; ")
        .find((row) => row.startsWith("chat-model-manual-v2="))
        ?.split("=")[1];
      if (cookieModel) {
        const candidate = decodeURIComponent(cookieModel);
        if (
          modelAvailability?.models?.some(
            (model: { id: string }) => model.id === candidate
          )
        ) {
          currentModelIdRef.current = candidate;
          setCurrentModelId(candidate);
        }
      }
    }
  }, [modelAvailability]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (
      query &&
      modelAvailability?.status === "ready" &&
      !hasAppendedQueryRef.current
    ) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });
    }
  }, [sendMessage, chatId, modelAvailability]);

  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);

  const earlierSummary: string | null = isNewChat
    ? null
    : (chatData?.earlierSummary ?? null);

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      error,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      setInput,
      visibilityType: visibility,
      isReadonly,
      isLoading: !isNewChat && isLoading,
      votes,
      earlierSummary,
      currentModelId,
      setCurrentModelId,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      error,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      earlierSummary,
      currentModelId,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
