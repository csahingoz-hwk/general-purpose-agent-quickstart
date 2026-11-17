"use client";

import {
  AlertTriangleIcon,
  BookmarkCheckIcon,
  ChevronRightIcon,
  PinIcon,
} from "lucide-react";
import Link from "next/link";
import {
  formatMemorySourceLabel,
  MEMORY_CATEGORY_LABELS,
  normalizeMemoryCategory,
  type SensitiveMemoryReason,
} from "@/lib/memory/bulk-import";
import type { MemorySource } from "@/lib/memory/store";

type SavedFactOutput = {
  saved?: boolean;
  logged?: boolean;
  skippedSensitive?: boolean;
  reason?: SensitiveMemoryReason;
  warning?: string;
  fact?: {
    id?: string;
    category?: string;
    key?: string;
    value?: string;
    source?: MemorySource;
    pinned?: boolean;
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

  if (parsed?.skippedSensitive) {
    return (
      <div
        className="flex w-full max-w-md items-start justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/[0.08] px-3.5 py-2.5 text-sm"
        data-testid="saved-memory-warning-card"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300">
            <AlertTriangleIcon className="size-3.5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <span className="font-medium text-amber-900 text-xs dark:text-amber-200">
              {locale === "tr"
                ? "Belleğe kaydedilmedi (hassas veri)"
                : "Not saved to memory"}
            </span>
            <p className="break-words text-[13px] text-foreground/90 leading-snug">
              {parsed.reason === "korn_ferry_data"
                ? locale === "tr"
                  ? "Korn Ferry bilgileri yalnızca kısa görev ve bölge bağlamı olarak saklanır; iç veriler ve belgeler kaydedilmez."
                  : "Korn Ferry facts are stored only as short role and region context lines — never internal data or documents."
                : locale === "tr"
                  ? "Şifreler, kart numaraları ve açık adresler güvenlik nedeniyle bellekte saklanmaz."
                  : "Passwords, card numbers, and street addresses are never stored in memory."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const value =
    parsed?.fact?.value ??
    parsed?.entry?.body ??
    parsed?.entry?.title ??
    (typeof input?.value === "string"
      ? input.value
      : typeof input?.body === "string"
        ? input.body
        : "");
  const rawCategory =
    parsed?.fact?.category ??
    (typeof input?.category === "string" ? input.category : null);
  const categoryLabel = rawCategory
    ? MEMORY_CATEGORY_LABELS[locale][normalizeMemoryCategory(rawCategory)]
    : null;
  const sourceLabel = parsed?.fact?.source
    ? formatMemorySourceLabel(parsed.fact.source, locale)
    : null;
  const isPinned = parsed?.fact?.pinned === true;
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
        <div className="min-w-0 space-y-1">
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
            {categoryLabel && (
              <span className="rounded-full bg-background/85 px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
                {categoryLabel}
              </span>
            )}
            {sourceLabel && (
              <span className="rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground">
                {sourceLabel}
              </span>
            )}
            {isPinned && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground">
                <PinIcon className="size-2.5" />
                {locale === "tr" ? "Sabit" : "Pinned"}
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
