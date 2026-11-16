"use client";

import {
  BookOpenIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  UserCheckIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { getCopy } from "@/lib/ui-copy";
import { cn, fetcher } from "@/lib/utils";

const copy = getCopy();

type ProfileFactItem = {
  id: string;
  category: string;
  key: string;
  value: string;
  sharedAcrossBots: boolean;
  updatedAt: string;
};

type JournalEntryItem = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
  createdAt: string;
};

type MemoryApiResponse = {
  status: "ready" | "setup_required";
  toolsEnabled: boolean;
  profileFacts: ProfileFactItem[];
  journalEntries: JournalEntryItem[];
};

const CATEGORIES = [
  "identity",
  "preference",
  "work",
  "finance",
  "project",
  "general",
] as const;

export default function MemoryPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [tab, setTab] = useState<"profile" | "journal">("profile");
  const [searchQuery, setSearchQuery] = useState("");
  const [factCategory, setFactCategory] = useState<string>("preference");
  const [factKey, setFactKey] = useState("");
  const [factValue, setFactValue] = useState("");
  const [sharedAcrossBots, setSharedAcrossBots] = useState(true);
  const [journalTitle, setJournalTitle] = useState("");
  const [journalBody, setJournalBody] = useState("");
  const [journalTags, setJournalTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data, error, mutate } = useSWR<MemoryApiResponse>(
    `${basePath}/api/memory${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`,
    fetcher
  );

  async function handleSaveFact(event: React.FormEvent) {
    event.preventDefault();
    if (!factKey.trim() || !factValue.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${basePath}/api/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "profile",
          category: factCategory,
          key: factKey.trim(),
          value: factValue.trim(),
          sharedAcrossBots,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save profile fact");
      }
      setFactKey("");
      setFactValue("");
      await mutate();
      toast({ type: "success", description: "Profile fact saved." });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not save profile fact",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveJournal(event: React.FormEvent) {
    event.preventDefault();
    if (!journalTitle.trim() || !journalBody.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      const tags = journalTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8);
      const response = await fetch(`${basePath}/api/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "journal",
          title: journalTitle.trim(),
          body: journalBody.trim(),
          tags,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save journal entry");
      }
      setJournalTitle("");
      setJournalBody("");
      setJournalTags("");
      await mutate();
      toast({ type: "success", description: "Journal entry added." });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not save journal entry",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(kind: "profile" | "journal", id: string) {
    const response = await fetch(
      `${basePath}/api/memory?type=${kind}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (response.ok) {
      await mutate();
    } else {
      toast({ type: "error", description: "Could not delete memory item." });
    }
  }

  return (
    <main className="h-dvh w-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6 px-4 py-6 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--hairline)] bg-card px-4 font-medium text-foreground text-sm hover:bg-muted"
            href="/"
          >
            {copy.backToChat}
          </Link>
          <span className="rounded-full border border-[color:var(--hairline)] bg-card px-3 py-1 text-muted-foreground text-xs">
            {data?.toolsEnabled
              ? "Chat memory tools: enabled"
              : "Chat memory tools: off (manual inspector)"}
          </span>
        </div>

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Long-term memory
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Split cleanly into durable Profile facts (optionally shared across
            specialist bots) and an episodic Journal timeline.
          </p>
        </div>

        {data?.status === "setup_required" && (
          <section className="rounded-[22px] border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Memory tables need one-time database setup
            </p>
            <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
              Apply <code>lib/db/parity-schema.sql</code> to your approved
              Postgres database to enable persistent Profile and Journal
              storage.
            </p>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "profile"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("profile")}
            type="button"
          >
            <UserCheckIcon className="size-4" />
            Profile facts ({data?.profileFacts.length ?? 0})
          </button>
          <button
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium text-sm transition-colors",
              tab === "journal"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
            )}
            onClick={() => setTab("journal")}
            type="button"
          >
            <BookOpenIcon className="size-4" />
            Journal ({data?.journalEntries.length ?? 0})
          </button>
          <input
            aria-label="Search memory"
            className="ml-auto min-h-11 w-full rounded-full border border-[color:var(--hairline)] bg-card px-4 text-[16px] text-foreground placeholder:text-muted-foreground sm:w-64"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search facts or journal…"
            type="search"
            value={searchQuery}
          />
        </div>

        {error ? (
          <p className="text-destructive text-sm">
            Could not load memory entries right now.
          </p>
        ) : tab === "profile" ? (
          <div className="space-y-4">
            <form
              className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
              onSubmit={handleSaveFact}
            >
              <h2 className="font-semibold text-[15px]">
                Add or update profile fact
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  aria-label="Category"
                  className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
                  onChange={(e) => setFactCategory(e.target.value)}
                  value={factCategory}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] sm:col-span-2"
                  onChange={(e) => setFactKey(e.target.value)}
                  placeholder="Key (e.g. reporting_currency, close_day_deadline)"
                  required
                  value={factKey}
                />
              </div>
              <input
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
                onChange={(e) => setFactValue(e.target.value)}
                placeholder="Fact value (e.g. Prefer concise variance tables in GBP & USD)"
                required
                value={factValue}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input
                    checked={sharedAcrossBots}
                    className="size-4"
                    onChange={(e) => setSharedAcrossBots(e.target.checked)}
                    type="checkbox"
                  />
                  <span>Share across future specialist bots</span>
                </label>
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
                  disabled={submitting || data?.status === "setup_required"}
                  type="submit"
                >
                  <PlusIcon className="size-4" />
                  Save fact
                </button>
              </div>
            </form>

            <div className="space-y-2.5">
              {(data?.profileFacts ?? []).length === 0 ? (
                <p className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                  No profile facts stored yet.
                </p>
              ) : (
                data?.profileFacts.map((fact) => (
                  <article
                    className="flex items-start justify-between gap-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
                    key={fact.id}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-xs">
                          {fact.category}
                        </span>
                        <code className="font-mono text-xs">{fact.key}</code>
                        {fact.sharedAcrossBots && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--hairline)] px-2 py-0.5 text-muted-foreground text-xs">
                            <Share2Icon className="size-3" />
                            Shared
                          </span>
                        )}
                      </div>
                      <p className="break-words text-[15px]">{fact.value}</p>
                    </div>
                    <button
                      aria-label={`Delete ${fact.key}`}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDelete("profile", fact.id)}
                      type="button"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </article>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
              onSubmit={handleSaveJournal}
            >
              <h2 className="font-semibold text-[15px]">New journal entry</h2>
              <input
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
                onChange={(e) => setJournalTitle(e.target.value)}
                placeholder="Title (e.g. Q3 audit accrual sign-off notes)"
                required
                value={journalTitle}
              />
              <textarea
                className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px]"
                onChange={(e) => setJournalBody(e.target.value)}
                placeholder="Notes, decisions, or context to recall later…"
                required
                value={journalBody}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  className="min-h-11 flex-1 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
                  onChange={(e) => setJournalTags(e.target.value)}
                  placeholder="Tags, comma-separated (e.g. close, ksa, action)"
                  value={journalTags}
                />
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
                  disabled={submitting || data?.status === "setup_required"}
                  type="submit"
                >
                  <PlusIcon className="size-4" />
                  Add entry
                </button>
              </div>
            </form>

            <div className="space-y-2.5">
              {(data?.journalEntries ?? []).length === 0 ? (
                <p className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                  No journal entries yet.
                </p>
              ) : (
                data?.journalEntries.map((entry) => (
                  <article
                    className="flex items-start justify-between gap-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
                    key={entry.id}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[15px]">
                          {entry.title}
                        </h3>
                        <time className="text-muted-foreground text-xs">
                          {new Date(entry.createdAt).toLocaleString()}
                        </time>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-[14px] text-foreground/90">
                        {entry.body}
                      </p>
                      {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {entry.tags.map((tag) => (
                            <span
                              className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs"
                              key={tag}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      aria-label={`Delete ${entry.title}`}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDelete("journal", entry.id)}
                      type="button"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </article>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
