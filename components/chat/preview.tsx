"use client";

import { useRouter } from "next/navigation";
import { suggestions } from "@/lib/constants";
import { SparklesIcon } from "./icons";

export function Preview() {
  const router = useRouter();

  const handleAction = (query?: string) => {
    const url = query ? `/?query=${encodeURIComponent(query)}` : "/";
    router.push(url);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-tl-2xl bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/20 px-5">
        <div className="flex size-5 items-center justify-center rounded bg-muted/60 ring-1 ring-border/50">
          <SparklesIcon size={10} />
        </div>
        <span className="text-[13px] text-muted-foreground">Chatbot</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">
            What can I help with?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ask a question, write code, or explore ideas.
          </p>
        </div>

        <div className="flex w-full max-w-md flex-wrap justify-center gap-2">
          {suggestions.map((suggestion) => (
            <button
              className="min-h-11 rounded-full border border-[color:var(--hairline)] bg-card px-4 py-2 text-[15px] text-foreground shadow-[var(--shadow-float)]"
              key={suggestion}
              onClick={() => handleAction(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-5 pb-5">
        <button
          className="flex min-h-14 w-full items-center rounded-[28px] border border-[color:var(--hairline)] bg-card px-4 text-left text-base text-muted-foreground shadow-[var(--shadow-float)]"
          onClick={() => handleAction()}
          type="button"
        >
          Ask …
        </button>
      </div>
    </div>
  );
}
