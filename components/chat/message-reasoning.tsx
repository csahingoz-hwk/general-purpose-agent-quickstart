"use client";

import { useEffect, useState } from "react";
import { getCopy, type UiLocale } from "@/lib/ui-copy";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning";
import { Shimmer } from "../ai-elements/shimmer";

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
  locale?: UiLocale;
};

export function MessageReasoning({
  isLoading,
  reasoning,
  locale = "en",
}: MessageReasoningProps) {
  const [hasBeenStreaming, setHasBeenStreaming] = useState(isLoading);
  const copy = getCopy(locale);

  useEffect(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);

  return (
    <Reasoning
      data-testid="message-reasoning"
      defaultOpen={hasBeenStreaming}
      isStreaming={isLoading}
    >
      <ReasoningTrigger
        getThinkingMessage={(isStreaming, duration) => {
          if (isStreaming || duration === 0) {
            return (
              <Shimmer className="font-medium" duration={1}>
                {copy.statusThinking}
              </Shimmer>
            );
          }
          if (duration === undefined) {
            return (
              <p>
                {locale === "tr"
                  ? "Birkaç saniye düşündü"
                  : "Thought for a few seconds"}
              </p>
            );
          }
          return (
            <p>
              {locale === "tr"
                ? `${duration} saniye düşündü`
                : `Thought for ${duration} seconds`}
            </p>
          );
        }}
      />
      <ReasoningContent>{reasoning}</ReasoningContent>
    </Reasoning>
  );
}
