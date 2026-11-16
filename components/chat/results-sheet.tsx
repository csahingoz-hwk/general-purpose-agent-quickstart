"use client";

import { LayersIcon, Share2Icon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
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
import { fetcher } from "@/lib/utils";

type PublishedRow = {
  id: string;
  title: string;
  itemCount: number;
  createdAt: string;
  revokedAt: string | null;
};

export function ConversationResultsPanel() {
  const { messages } = useActiveChat();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);

  const results = extractConversationResults(messages);
  const sharableResults = results.filter(
    (r) => r.kind !== "draft" && r.kind !== "inbox"
  );

  const { data: shareData, mutate: mutateShares } = useSWR<{
    pages: PublishedRow[];
  }>(open ? `${basePath}/api/share` : null, fetcher);

  async function handlePublishSnapshot() {
    if (sharableResults.length === 0) {
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch(`${basePath}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: sharableResults[0]?.title ?? "Shared Assistant Results",
          items: sharableResults.map((r) => ({
            kind: r.kind,
            title: r.title,
            subtitle: r.subtitle,
          })),
        }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? "Could not publish snapshot");
      }
      setLastShareUrl(json.url);
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(json.url).catch(() => null);
      }
      await mutateShares();
      toast.success("Published read-only snapshot link (copied to clipboard).");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not publish snapshot"
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleRevoke(id: string) {
    const res = await fetch(
      `${basePath}/api/share?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      await mutateShares();
      toast.success("Share link revoked immediately.");
    }
  }

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

        {sharableResults.length > 0 && (
          <div className="mt-4 space-y-2 rounded-2xl border border-[color:var(--hairline)] bg-muted/30 p-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3.5 font-medium text-background text-xs disabled:opacity-50"
              disabled={publishing}
              onClick={handlePublishSnapshot}
              type="button"
            >
              <Share2Icon className="size-3.5" />
              {publishing
                ? "Publishing snapshot…"
                : "Publish read-only snapshot (/share)"}
            </button>
            {lastShareUrl && (
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {lastShareUrl}
              </p>
            )}
          </div>
        )}

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

        {(shareData?.pages ?? []).filter((p) => !p.revokedAt).length > 0 && (
          <div className="mt-6 space-y-2 border-t border-[color:var(--hairline)] pt-4">
            <p className="font-medium text-xs">Active Published Snapshots</p>
            {(shareData?.pages ?? [])
              .filter((p) => !p.revokedAt)
              .map((page) => (
                <div
                  className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--hairline)] bg-card px-3 py-2 text-xs"
                  key={page.id}
                >
                  <span className="truncate">{page.title}</span>
                  <button
                    aria-label={`Revoke ${page.title}`}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-destructive hover:bg-destructive/10"
                    onClick={() => handleRevoke(page.id)}
                    type="button"
                  >
                    <Trash2Icon className="size-3.5" />
                    Revoke
                  </button>
                </div>
              ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
