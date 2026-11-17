"use client";

import {
  BookOpenIcon,
  CheckIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UserCheckIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import {
  buildMemoriesExportMarkdown,
  type MemoryImportPreviewItem,
  prepareMemoryImportPreview,
} from "@/lib/memory/bulk-import";
import type {
  JournalEntry,
  MemoryCategory,
  ProfileFact,
} from "@/lib/memory/store";
import { cn, fetcher } from "@/lib/utils";

type MemoryApiResponse = {
  status: "ready" | "setup_required";
  toolsEnabled: boolean;
  profileFacts: ProfileFact[];
  journalEntries: JournalEntry[];
};

const LABELS = {
  en: {
    title: "Memory",
    subtitle:
      "Facts saved in your private database and included automatically in every chat and voice session.",
    autoBadge: "Active in chat & voice",
    pasteTitle: "Paste a list or notes",
    pasteHint:
      "Bullets, numbered lines, plain lines, or paragraphs. Duplicates are unchecked automatically before saving.",
    pastePlaceholder:
      "- I live in London (Europe/London)\n- Prefer concise tables with clear takeaways\n- Daughter's name is Ece\n- Coffee: black, no sugar…",
    previewBtn: "Preview before saving",
    previewHeading: "Review extracted memories",
    newSelected: "new selected",
    duplicatesSkipped: "already saved",
    selectAllNew: "Select new",
    clearSelection: "Clear",
    alreadySaved: "Already saved",
    repeatInPaste: "Repeated line",
    saveSelected: "Save selected",
    saving: "Saving…",
    cancel: "Cancel",
    savedMemoriesTab: "Memories",
    journalTab: "Journal",
    searchPlaceholder: "Search memories…",
    copyAll: "Copy all",
    copiedAll: "Copied all memories to clipboard.",
    downloadAll: "Download",
    downloadedAll: "Downloaded memory export.",
    emptyMemories:
      "No memories saved yet. Paste a list above or say “remember this: …” in chat or voice.",
    emptySearch: "No saved memories match your search.",
    edit: "Edit",
    delete: "Delete",
    saveEdit: "Save",
    factUpdated: "Memory updated.",
    factDeleted: "Memory deleted.",
    journalTitleLabel: "Title",
    journalNotesLabel: "Notes",
    journalTagsLabel: "Tags (optional)",
    addJournalBtn: "Add note",
    emptyJournal: "No journal notes yet.",
    tipRemember:
      "Tip: In chat or live voice, say “remember this: …” (or “bunu hatırla: …”) to save on the fly.",
    categories: {
      preference: "Preference",
      identity: "Identity",
      work: "Work",
      finance: "Finance",
      project: "Project",
      general: "General",
    } as Record<MemoryCategory, string>,
  },
  tr: {
    title: "Bellek",
    subtitle:
      "Özel veritabanında saklanan ve her sohbet ile sesli görüşmede otomatik kullanılan bilgiler.",
    autoBadge: "Sohbet ve seste aktif",
    pasteTitle: "Uzun liste veya not yapıştır",
    pasteHint:
      "Madde işaretleri, satırlar veya paragraflar tek tek ayrıştırılır; zaten kayıtlı olanlar kaydetmeden önce ayıklanır.",
    pastePlaceholder:
      "- Londra'da yaşıyorum (Europe/London)\n- Kısa ve net karşılaştırma tablolarını tercih ederim\n- Kızımın adı Ece\n- Kahvemi sade ve şekersiz içerim…",
    previewBtn: "Kaydetmeden önizle",
    previewHeading: "Ayrıştırılan bilgileri kontrol et",
    newSelected: "yeni seçili",
    duplicatesSkipped: "zaten kayıtlı",
    selectAllNew: "Yenileri seç",
    clearSelection: "Temizle",
    alreadySaved: "Zaten kayıtlı",
    repeatInPaste: "Tekrarlanan satır",
    saveSelected: "Seçilenleri kaydet",
    saving: "Kaydediliyor…",
    cancel: "Vazgeç",
    savedMemoriesTab: "Kayıtlar",
    journalTab: "Günlük",
    searchPlaceholder: "Bellekte ara…",
    copyAll: "Tümünü kopyala",
    copiedAll: "Tüm bellek kayıtları panoya kopyalandı.",
    downloadAll: "İndir",
    downloadedAll: "Bellek dışa aktarımı indirildi.",
    emptyMemories:
      "Henüz kayıtlı bilgi yok. Yukarıya liste yapıştırabilir veya sohbette “bunu hatırla: …” diyebilirsin.",
    emptySearch: "Aramanla eşleşen kayıt bulunamadı.",
    edit: "Düzenle",
    delete: "Sil",
    saveEdit: "Kaydet",
    factUpdated: "Kayıt güncellendi.",
    factDeleted: "Kayıt silindi.",
    journalTitleLabel: "Başlık",
    journalNotesLabel: "Notlar",
    journalTagsLabel: "Etiketler (isteğe bağlı)",
    addJournalBtn: "Not ekle",
    emptyJournal: "Henüz günlük notu yok.",
    tipRemember:
      "İpucu: Sohbette veya sesli modda “bunu hatırla: …” (veya “remember this: …”) diyerek anında kayıt ekleyebilirsin.",
    categories: {
      preference: "Tercih",
      identity: "Kimlik",
      work: "İş",
      finance: "Finans",
      project: "Proje",
      general: "Genel",
    } as Record<MemoryCategory, string>,
  },
} as const;

const CATEGORY_IDS: readonly MemoryCategory[] = [
  "preference",
  "identity",
  "project",
  "finance",
  "work",
  "general",
];

export default function MemoryPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [lang, setLang] = useState<"en" | "tr">("en");
  const [tab, setTab] = useState<"profile" | "journal">("profile");
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [previewItems, setPreviewItems] = useState<
    MemoryImportPreviewItem[] | null
  >(null);
  const [submitting, setSubmitting] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingCategory, setEditingCategory] =
    useState<MemoryCategory>("general");
  const [savingEdit, setSavingEdit] = useState(false);

  // Journal form state
  const [journalTitle, setJournalTitle] = useState("");
  const [journalBody, setJournalBody] = useState("");
  const [journalTags, setJournalTags] = useState("");

  useEffect(() => {
    try {
      if (navigator.language?.toLowerCase().startsWith("tr")) {
        setLang("tr");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const t = LABELS[lang];

  // Fetch full owner memory store once; filter instantaneously on client so
  // de-duplication and Export All always see 100% of saved memories.
  const { data, error, mutate } = useSWR<MemoryApiResponse>(
    `${basePath}/api/memory`,
    fetcher
  );

  const allFacts = data?.profileFacts ?? [];
  const allJournal = data?.journalEntries ?? [];

  const filteredFacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return allFacts;
    }
    return allFacts.filter(
      (f) =>
        f.value.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q)
    );
  }, [allFacts, searchQuery]);

  const filteredJournal = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return allJournal;
    }
    return allJournal.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.body.toLowerCase().includes(q) ||
        j.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [allJournal, searchQuery]);

  function handleBuildPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!bulkText.trim()) {
      return;
    }
    const items = prepareMemoryImportPreview(bulkText, allFacts);
    if (items.length === 0) {
      return;
    }
    setPreviewItems(items);
  }

  function togglePreviewItem(itemId: string) {
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) =>
            item.id === itemId ? { ...item, checked: !item.checked } : item
          )
        : null
    );
  }

  async function handleConfirmBatchSave() {
    if (!previewItems) {
      return;
    }
    const selected = previewItems.filter((item) => item.checked);
    if (selected.length === 0) {
      setPreviewItems(null);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${basePath}/api/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "profile_batch",
          items: selected.map((item) => ({
            category: item.category,
            key: item.key,
            value: item.value,
            sharedAcrossBots: true,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save memories");
      }
      const resJson = (await response.json()) as {
        savedCount?: number;
        skippedDuplicates?: number;
      };
      setBulkText("");
      setPreviewItems(null);
      await mutate();
      toast({
        type: "success",
        description:
          lang === "tr"
            ? `${resJson.savedCount ?? selected.length} bilgi belleğe kaydedildi.`
            : `Saved ${resJson.savedCount ?? selected.length} memories.`,
      });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not save memories",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function startEditFact(fact: ProfileFact) {
    setEditingId(fact.id);
    setEditingValue(fact.value);
    setEditingCategory(fact.category);
  }

  async function handleSaveEdit(factId: string) {
    const trimmed = editingValue.trim();
    if (!trimmed) {
      return;
    }
    setSavingEdit(true);
    try {
      const response = await fetch(`${basePath}/api/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "profile",
          id: factId,
          value: trimmed,
          category: editingCategory,
        }),
      });
      if (!response.ok) {
        throw new Error("Could not update memory");
      }
      setEditingId(null);
      await mutate();
      toast({ type: "success", description: t.factUpdated });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not update memory",
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(kind: "profile" | "journal", id: string) {
    const response = await fetch(
      `${basePath}/api/memory?type=${kind}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (response.ok) {
      await mutate();
      toast({ type: "success", description: t.factDeleted });
    } else {
      toast({ type: "error", description: "Could not delete memory item." });
    }
  }

  async function handleCopyAll() {
    const markdown = buildMemoriesExportMarkdown(allFacts, allJournal);
    try {
      await navigator.clipboard.writeText(markdown);
      toast({ type: "success", description: t.copiedAll });
    } catch {
      toast({ type: "error", description: "Clipboard copy unavailable." });
    }
  }

  function handleDownloadAll() {
    const markdown = buildMemoriesExportMarkdown(allFacts, allJournal);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateSlug = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `assistant-memories-${dateSlug}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast({ type: "success", description: t.downloadedAll });
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
        .map((tag) => tag.trim())
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
      toast({ type: "success", description: "Journal note added." });
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

  const selectedPreviewCount =
    previewItems?.filter((item) => item.checked).length ?? 0;
  const duplicatePreviewCount =
    previewItems?.filter((item) => item.isDuplicate).length ?? 0;

  return (
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-5 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader
          badge={
            <div className="flex items-center gap-1.5">
              <span className="hidden rounded-full border border-[color:var(--hairline)] bg-card px-2.5 py-1 text-muted-foreground text-xs sm:inline-flex">
                {t.autoBadge}
              </span>
              <fieldset
                aria-label="Language"
                className="inline-flex rounded-full border border-[color:var(--hairline)] bg-card p-0.5 text-xs"
              >
                <button
                  className={cn(
                    "min-h-7 rounded-full px-2.5 font-medium transition-colors",
                    lang === "en"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="memory-lang-en"
                  onClick={() => setLang("en")}
                  type="button"
                >
                  EN
                </button>
                <button
                  className={cn(
                    "min-h-7 rounded-full px-2.5 font-medium transition-colors",
                    lang === "tr"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="memory-lang-tr"
                  onClick={() => setLang("tr")}
                  type="button"
                >
                  TR
                </button>
              </fieldset>
            </div>
          }
        />

        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t.subtitle}
          </p>
        </div>

        {data?.status === "setup_required" && (
          <div className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-sm">
            <p className="font-medium text-foreground">
              Memory storage isn&apos;t connected on this database yet
            </p>
          </div>
        )}

        {/* Bulk Paste & De-duplicated Preview Box */}
        <section className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4">
          <form className="space-y-3" onSubmit={handleBuildPreview}>
            <div className="space-y-1">
              <h2 className="font-semibold text-[15px] text-foreground">
                {t.pasteTitle}
              </h2>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t.pasteHint}
              </p>
            </div>

            <textarea
              aria-label={t.pasteTitle}
              className="min-h-36 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px] text-foreground leading-relaxed placeholder:text-muted-foreground"
              data-testid="memory-bulk-textarea"
              onChange={(e) => {
                setBulkText(e.target.value);
                if (previewItems) {
                  setPreviewItems(null);
                }
              }}
              placeholder={t.pastePlaceholder}
              value={bulkText}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <SparklesIcon className="size-3.5 shrink-0" />
                <span>{t.tipRemember}</span>
              </p>
              <button
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                data-testid="memory-preview-button"
                disabled={
                  !bulkText.trim() ||
                  submitting ||
                  data?.status === "setup_required"
                }
                type="submit"
              >
                <PlusIcon className="size-4" />
                {t.previewBtn}
              </button>
            </div>
          </form>

          {previewItems && (
            <div
              className="mt-4 space-y-3 border-[color:var(--hairline)] border-t pt-4"
              data-testid="memory-import-preview"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground text-sm">
                    {t.previewHeading}
                  </h3>
                  <p
                    className="text-muted-foreground text-xs tabular-nums"
                    data-testid="memory-preview-summary"
                  >
                    {selectedPreviewCount} {t.newSelected}
                    {duplicatePreviewCount > 0
                      ? ` · ${duplicatePreviewCount} ${t.duplicatesSkipped}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    className="min-h-9 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground hover:bg-muted"
                    onClick={() =>
                      setPreviewItems((prev) =>
                        prev
                          ? prev.map((i) => ({ ...i, checked: !i.isDuplicate }))
                          : null
                      )
                    }
                    type="button"
                  >
                    {t.selectAllNew}
                  </button>
                  <button
                    className="min-h-9 rounded-full border border-[color:var(--hairline)] bg-background px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() =>
                      setPreviewItems((prev) =>
                        prev
                          ? prev.map((i) => ({ ...i, checked: false }))
                          : null
                      )
                    }
                    type="button"
                  >
                    {t.clearSelection}
                  </button>
                </div>
              </div>

              <div className="max-h-72 divide-y divide-[color:var(--hairline)] overflow-y-auto rounded-xl border border-[color:var(--hairline)] bg-background">
                {previewItems.map((item) => (
                  <label
                    className={cn(
                      "flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40",
                      item.isDuplicate && !item.checked && "opacity-60"
                    )}
                    data-testid="memory-preview-item"
                    key={item.id}
                  >
                    <input
                      checked={item.checked}
                      className="mt-1 size-4 shrink-0 accent-primary"
                      data-testid="memory-preview-checkbox"
                      onChange={() => togglePreviewItem(item.id)}
                      type="checkbox"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="break-words text-[14px] text-foreground leading-snug">
                        {item.value}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
                          {t.categories[item.category] ?? item.category}
                        </span>
                        {item.isDuplicate && (
                          <span
                            className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-[11px] text-amber-800 dark:text-amber-300"
                            data-testid="memory-duplicate-badge"
                          >
                            {item.duplicateReason === "paste_repeat"
                              ? t.repeatInPaste
                              : t.alreadySaved}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-sm hover:bg-muted"
                  onClick={() => setPreviewItems(null)}
                  type="button"
                >
                  {t.cancel}
                </button>
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
                  data-testid="memory-confirm-save"
                  disabled={selectedPreviewCount === 0 || submitting}
                  onClick={handleConfirmBatchSave}
                  type="button"
                >
                  <CheckIcon className="size-4" />
                  {submitting
                    ? t.saving
                    : `${t.saveSelected} (${selectedPreviewCount})`}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Tabs + Export Toolbar */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 font-medium text-sm transition-colors",
                  tab === "profile"
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
                )}
                onClick={() => setTab("profile")}
                type="button"
              >
                <UserCheckIcon className="size-4" />
                <span>
                  {t.savedMemoriesTab} ({allFacts.length})
                </span>
              </button>
              <button
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 font-medium text-sm transition-colors",
                  tab === "journal"
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
                )}
                onClick={() => setTab("journal")}
                type="button"
              >
                <BookOpenIcon className="size-4" />
                <span>
                  {t.journalTab} ({allJournal.length})
                </span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-card px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted disabled:opacity-50"
                data-testid="memory-export-copy"
                disabled={allFacts.length === 0 && allJournal.length === 0}
                onClick={handleCopyAll}
                type="button"
              >
                <ClipboardCopyIcon className="size-3.5" />
                <span>{t.copyAll}</span>
              </button>
              <button
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-card px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted disabled:opacity-50"
                data-testid="memory-export-download"
                disabled={allFacts.length === 0 && allJournal.length === 0}
                onClick={handleDownloadAll}
                type="button"
              >
                <DownloadIcon className="size-3.5" />
                <span>{t.downloadAll}</span>
              </button>
            </div>
          </div>

          <input
            aria-label={t.searchPlaceholder}
            className="min-h-11 w-full rounded-full border border-[color:var(--hairline)] bg-card px-4 text-[16px] text-foreground placeholder:text-muted-foreground"
            data-testid="memory-search-input"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            type="search"
            value={searchQuery}
          />
        </div>

        {error ? (
          <p className="text-destructive text-sm">
            Could not load memory entries right now.
          </p>
        ) : tab === "profile" ? (
          filteredFacts.length === 0 ? (
            <p className="rounded-2xl border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
              {searchQuery.trim() ? t.emptySearch : t.emptyMemories}
            </p>
          ) : (
            <div
              className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card"
              data-testid="memory-saved-list"
            >
              {filteredFacts.map((fact) => {
                const isEditing = editingId === fact.id;
                return (
                  <article
                    className="p-3.5 sm:p-4"
                    data-testid="memory-fact-row"
                    key={fact.id}
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <select
                            aria-label="Category"
                            className="min-h-10 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                            onChange={(e) =>
                              setEditingCategory(
                                e.target.value as MemoryCategory
                              )
                            }
                            value={editingCategory}
                          >
                            {CATEGORY_IDS.map((cat) => (
                              <option key={cat} value={cat}>
                                {t.categories[cat]}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1.5">
                            <button
                              aria-label={t.cancel}
                              className="inline-flex size-10 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background text-muted-foreground hover:text-foreground"
                              onClick={() => setEditingId(null)}
                              type="button"
                            >
                              <XIcon className="size-4" />
                            </button>
                            <button
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs disabled:opacity-50"
                              data-testid="memory-edit-save"
                              disabled={savingEdit || !editingValue.trim()}
                              onClick={() => handleSaveEdit(fact.id)}
                              type="button"
                            >
                              <CheckIcon className="size-3.5" />
                              {t.saveEdit}
                            </button>
                          </div>
                        </div>
                        <textarea
                          className="min-h-20 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px] text-foreground"
                          data-testid="memory-edit-textarea"
                          onChange={(e) => setEditingValue(e.target.value)}
                          value={editingValue}
                        />
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-[11px] text-muted-foreground">
                              {t.categories[fact.category] ?? fact.category}
                            </span>
                          </div>
                          <p className="break-words text-[15px] text-foreground leading-snug">
                            {fact.value}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            aria-label={`${t.edit} ${fact.value.slice(0, 32)}`}
                            className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            data-testid="memory-edit-button"
                            onClick={() => startEditFact(fact)}
                            type="button"
                          >
                            <PencilIcon className="size-4" />
                          </button>
                          <button
                            aria-label={`${t.delete} ${fact.value.slice(0, 32)}`}
                            className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            data-testid="memory-delete-button"
                            onClick={() => handleDelete("profile", fact.id)}
                            type="button"
                          >
                            <Trash2Icon className="size-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-4">
            <form
              className="space-y-3 rounded-2xl border border-[color:var(--hairline)] bg-card p-4"
              onSubmit={handleSaveJournal}
            >
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground text-xs">
                  {t.journalTitleLabel}
                </span>
                <input
                  className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                  onChange={(e) => setJournalTitle(e.target.value)}
                  required
                  value={journalTitle}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground text-xs">
                  {t.journalNotesLabel}
                </span>
                <textarea
                  className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px] text-foreground"
                  onChange={(e) => setJournalBody(e.target.value)}
                  required
                  value={journalBody}
                />
              </label>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="min-w-44 flex-1 space-y-1 text-sm">
                  <span className="text-muted-foreground text-xs">
                    {t.journalTagsLabel}
                  </span>
                  <input
                    className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                    onChange={(e) => setJournalTags(e.target.value)}
                    placeholder="planning, travel"
                    value={journalTags}
                  />
                </label>
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
                  disabled={submitting || data?.status === "setup_required"}
                  type="submit"
                >
                  <PlusIcon className="size-4" />
                  {t.addJournalBtn}
                </button>
              </div>
            </form>

            {filteredJournal.length === 0 ? (
              <p className="rounded-2xl border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
                {t.emptyJournal}
              </p>
            ) : (
              <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
                {filteredJournal.map((entry) => (
                  <article
                    className="flex items-start justify-between gap-3 p-4"
                    key={entry.id}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[15px]">
                          {entry.title}
                        </h3>
                        <time className="text-muted-foreground text-xs">
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </time>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-[14px] text-foreground/90">
                        {entry.body}
                      </p>
                    </div>
                    <button
                      aria-label={`${t.delete} ${entry.title}`}
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDelete("journal", entry.id)}
                      type="button"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
