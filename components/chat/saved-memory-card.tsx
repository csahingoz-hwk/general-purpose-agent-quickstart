"use client";

import { BookmarkCheckIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

type SavedFactOutput = {
  saved?: boolean;
  logged?: boolean;
  fact?: {
    id?: string;
    category?: string;
    key?: string;
    value?: string;
  };
  entry?: {
    id?: string;
    title?: string;
    body?: string;
  };
};

export function SavedMemoryCard({
  input,
  output,
  state,
  locale = "en",
}: {
  input?: Record<string, unknown>;
  output?: unknown;
  state: string;
  locale?: "en" | "tr";
}) {
  const parsed =
    output && typeof output === "object" ? (output as SavedFactOutput) : null;
  const value =
    parsed?.fact?.value ??
    parsed?.entry?.body ??
    parsed?.entry?.title ??
    (typeof input?.value === "string"
      ? input.value
      : typeof input?.body === "string"
        ? input.body
        : "");
  const category =
    parsed?.fact?.category ??
    (typeof input?.category === "string" ? input.category : null);
  const isSaving = state === "input-streaming" || state === "input-available";

  return (
    <div
      className="flex w-full max-w-md items-start justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 text-sm"
      data-testid="saved-memory-card"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <BookmarkCheckIcon className="size-3.5" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-emerald-800 text-xs dark:text-emerald-200">
              {isSaving
                ? locale === "tr"
                  ? "Belleğe kaydediliyor…"
                  : "Saving to memory…"
                : locale === "tr"
                  ? "Belleğe kaydedildi"
                  : "Saved to memory"}
            </span>
            {category && (
              <span className="rounded-full bg-background/80 px-2 py-0.2 font-medium text-[11px] text-muted-foreground">
                {category}
              </span>
            )}
          </div>
          {value && (
            <p className="line-clamp-3 break-words text-[13.5px] text-foreground leading-snug">
              {value}
            </p>
          )}
        </div>
      </div>

      <Link
        className="inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-full border border-[color:var(--hairline)] bg-background/90 px-2.5 font-medium text-foreground text-xs transition-colors hover:bg-muted"
        href="/memory"
      >
        <span>{locale === "tr" ? "Bellek" : "Memory"}</span>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
      </Link>
    </div>
  );
}
