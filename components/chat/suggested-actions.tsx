"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { motion } from "framer-motion";
import { memo } from "react";
import useSWR from "swr";
import type { ChatModel } from "@/lib/ai/models";
import { suggestions } from "@/lib/constants";
import type { ChatMessage } from "@/lib/types";
import { Suggestion } from "../ai-elements/suggestion";
import type { VisibilityType } from "./visibility-selector";

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
};

function PureSuggestedActions({ chatId, sendMessage }: SuggestedActionsProps) {
  const { data: modelAvailability } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url: string) =>
      fetch(url).then((response) => {
        if (!response.ok) {
          throw new Error("Model check failed");
        }
        return response.json();
      }),
    { revalidateOnFocus: true, dedupingInterval: 60_000 }
  );
  const modelReady =
    modelAvailability?.status === "ready" &&
    modelAvailability.models?.some((model: ChatModel) => model.id);

  if (!modelReady) {
    return null;
  }

  return (
    <div
      className="flex w-full max-w-md flex-wrap justify-center gap-2"
      data-testid="suggested-actions"
    >
      {suggestions.map((suggestedAction, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="max-w-full"
          initial={{ opacity: 0, y: 8 }}
          key={suggestedAction}
          transition={{
            delay: 0.04 * index,
            duration: 0.3,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Suggestion
            className="h-auto! min-h-11 w-auto max-w-full whitespace-normal rounded-full border border-[color:var(--hairline)] bg-[var(--bot-tint)] px-4 py-2.5 text-left text-[15px] leading-snug text-foreground shadow-[var(--shadow-float)] hover:bg-[var(--bot-tint)]"
            onClick={(suggestion) => {
              window.history.pushState(
                {},
                "",
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
              );
              sendMessage({
                role: "user",
                parts: [{ type: "text", text: suggestion }],
              });
            }}
            suggestion={suggestedAction}
          >
            {suggestedAction}
          </Suggestion>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }

    return true;
  }
);
