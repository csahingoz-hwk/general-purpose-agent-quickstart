"use client";

import { HelpCircleIcon } from "lucide-react";
import { useState } from "react";
import type { ClarifyingQuestionResult } from "@/lib/ai/tools/ask-question";
import { cn } from "@/lib/utils";

export function QuestionCard({
  isReadonly = false,
  locale = "en",
  onSelectOption,
  payload,
}: {
  isReadonly?: boolean;
  locale?: "en" | "tr";
  onSelectOption?: (answer: string) => void;
  payload: ClarifyingQuestionResult;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <section
      className="w-[min(100%,36rem)] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 text-foreground shadow-[var(--shadow-card)]"
      data-testid="question-widget-card"
    >
      <div className="flex items-start gap-2">
        <HelpCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <h3 className="font-semibold text-[15px] leading-snug">
          {payload.question}
        </h3>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {payload.options.map((option) => {
          const isSelected = picked === option.label;
          return (
            <button
              className={cn(
                "flex min-h-11 w-full flex-col items-start justify-center rounded-2xl border px-3.5 py-2 text-left transition-colors motion-reduce:transition-none",
                isSelected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-[color:var(--hairline)] bg-background hover:bg-muted/60",
                (isReadonly || picked !== null) && !isSelected && "opacity-60"
              )}
              disabled={isReadonly || picked !== null || !onSelectOption}
              key={option.label}
              onClick={() => {
                if (!onSelectOption || picked !== null) {
                  return;
                }
                setPicked(option.label);
                onSelectOption(option.label);
              }}
              type="button"
            >
              <span className="font-medium text-[14px]">{option.label}</span>
              {option.description ? (
                <span className="text-[12px] text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {payload.allowCustom && picked === null && (
        <p className="mt-2.5 text-muted-foreground text-xs">
          {locale === "tr"
            ? "Bir seçenek belirleyin veya aşağıya kendi yanıtınızı yazın."
            : "Tap an option or type your own answer in the composer."}
        </p>
      )}
    </section>
  );
}
