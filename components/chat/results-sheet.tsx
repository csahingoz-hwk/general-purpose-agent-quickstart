"use client";

import { LayersIcon } from "lucide-react";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActiveChat } from "@/hooks/use-active-chat";
import { extractConversationResults } from "@/lib/results-extractor";

export function ConversationResultsPanel() {
  const { messages } = useActiveChat();
  const [open, setOpen] = useState(false);
  const results = extractConversationResults(messages);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <button
          className="flex min-h-11 w-full items-center justify-between rounded-xl border border-[color:var(--hairline)] bg-background px-3.5 py-2 text-left text-sm transition-colors hover:bg-muted"
          data-testid="conversation-results-trigger"
          type="button"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <LayersIcon className="size-4 text-muted-foreground" />
            Results in this chat
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs">
            {results.length}
          </span>
        </button>
      </SheetTrigger>
      <SheetContent
        className="w-full max-w-md overflow-y-auto sm:max-w-md"
        side="right"
      >
        <SheetHeader>
          <SheetTitle>Results in this conversation</SheetTitle>
          <SheetDescription>
            Cards, drafts, and canvas artifacts produced in this chat.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2.5">
          {results.length === 0 ? (
            <p className="rounded-2xl border border-[color:var(--hairline)] bg-muted/30 p-4 text-muted-foreground text-sm">
              No structured cards or artifacts in this conversation yet.
            </p>
          ) : (
            results.map((item) => (
              <button
                className="flex min-h-11 w-full flex-col items-start rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-left shadow-[var(--shadow-card)] transition-colors hover:bg-muted/50"
                key={item.id}
                onClick={() => {
                  setOpen(false);
                  const safeId =
                    typeof CSS !== "undefined" && "escape" in CSS
                      ? CSS.escape(item.messageId)
                      : item.messageId.replace(/[^a-zA-Z0-9_-]/g, "");
                  const target = document.querySelector(
                    `[data-message-id="${safeId}"]`
                  );
                  target?.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                  });
                }}
                type="button"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-semibold text-[14px]">
                    {item.title}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] uppercase">
                    {item.kind}
                  </span>
                </div>
                <span className="mt-0.5 text-muted-foreground text-xs">
                  {item.subtitle}
                </span>
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
