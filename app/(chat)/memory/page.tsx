"use client";

import {
  AlertTriangleIcon,
  BookOpenIcon,
  CheckIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
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
  defaultPinnedForCategory,
  formatMemorySourceLabel,
  MEMORY_CATEGORY_LABELS,
  type MemoryImportPreviewItem,
  normalizeMemoryCategory,
  ORDERED_MEMORY_CATEGORIES,
  prepareMemoryImportPreview,
  type SensitiveMemoryReason,
  type SkippedSensitiveLine,
} from "@/lib/memory/bulk-import";
import type {
  CanonicalMemoryCategory,
  JournalEntry,
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
      "Durable self-contained facts grouped by category (Rules & Preferences first). Pinned facts are always included; searchable facts are pulled in when relevant.",
    autoBadge: "Active in chat & voice",
    pasteTitle: "Paste a list of facts",
    pasteHint:
      "Bullets, lines, or paragraphs are split into single-sentence facts. Passwords, card numbers, and street addresses are skipped automatically.",
    pastePlaceholder:
      "- Never use pay-per-use API models without asking first\n- Prefer concise comparison tables with clear takeaways\n- I live in London (Europe/London)\n- Daughter's name is Ece…",
    previewBtn: "Preview before saving",
    previewHeading: "Review extracted facts",
    newSelected: "new selected",
    duplicatesSkipped: "already saved",
    selectAllNew: "Select new",
    clearSelection: "Clear",
    alreadySaved: "Already saved",
    repeatInPaste: "Repeated line",
    sensitiveWarningTitle:
      "Skipped sensitive lines — passwords, card numbers, and addresses are never stored in memory:",
    sensitiveReasons: {
      password: "Password / secret",
      card_number: "Card number",
      address: "Street / postal address",
    } as Record<SensitiveMemoryReason, string>,
    saveSelected: "Save selected",
    saving: "Saving…",
    cancel: "Cancel",
    savedMemoriesTab: "Facts",
    journalTab: "Journal",
    allCategories: "All",
    searchPlaceholder: "Search facts…",
    copyAll: "Copy all",
    copiedAll: "Copied all memories to clipboard.",
    downloadAll: "Download",
    downloadedAll: "Downloaded memory export.",
    emptyMemories:
      "No memories saved yet. Paste a list above or say “remember this: …” in chat or voice.",
    emptySearch: "No saved facts match your filter.",
    pinnedLabel: "Pinned",
    searchableLabel: "Searchable",
    learnedPrefix: "Learned",
    edit: "Edit",
    delete: "Delete",
    saveEdit: "Save",
    factUpdated: "Fact updated.",
    factDeleted: "Fact deleted.",
    journalTitleLabel: "Title",
    journalNotesLabel: "Notes",
    journalTagsLabel: "Tags (optional)",
    addJournalBtn: "Add note",
    emptyJournal: "No journal notes yet.",
    tipRemember:
      "Tip: Say “remember this: …” (or “bunu hatırla: …”) in chat or voice.",
  },
  tr: {
    title: "Bellek",
    subtitle:
      "Kategorilere ayrılmış tek cümlelik kalıcı bilgiler (Kurallar ve Tercihler ilk sırada). Sabitlenenler her zaman eklenir; aranabilir olanlar ilgili olduğunda çağrılır.",
    autoBadge: "Sohbet ve seste aktif",
    pasteTitle: "Uzun bilgi listesi yapıştır",
    pasteHint:
      "Maddeler, satırlar veya paragraflar tek cümlelik bilgilere ayrılır. Şifreler, kart numaraları ve açık adresler uyarı gösterilerek atlanır.",
    pastePlaceholder:
      "- Onayım olmadan asla kullandıkça öde API modeli kullanma\n- Kısa ve net karşılaştırma tablolarını tercih ederim\n- Londra'da yaşıyorum (Europe/London)\n- Kızımın adı Ece…",
    previewBtn: "Kaydetmeden önizle",
    previewHeading: "Ayrıştırılan bilgileri kontrol et",
    newSelected: "yeni seçili",
    duplicatesSkipped: "zaten kayıtlı",
    selectAllNew: "Yenileri seç",
    clearSelection: "Temizle",
    alreadySaved: "Zaten kayıtlı",
    repeatInPaste: "Tekrarlanan satır",
    sensitiveWarningTitle:
      "Hassas satırlar atlandı — şifreler, kart numaraları ve adresler bellekte saklanmaz:",
    sensitiveReasons: {
      password: "Şifre / gizli anahtar",
      card_number: "Kart numarası",
      address: "Açık adres / posta kodu",
    } as Record<SensitiveMemoryReason, string>,
    saveSelected: "Seçilenleri kaydet",
    saving: "Kaydediliyor…",
    cancel: "Vazgeç",
    savedMemoriesTab: "Bilgiler",
    journalTab: "Günlük",
    allCategories: "Tümü",
    searchPlaceholder: "Bilgilerde ara…",
    copyAll: "Tümünü kopyala",
    copiedAll: "Tüm bellek kayıtları panoya kopyalandı.",
    downloadAll: "İndir",
    downloadedAll: "Bellek dışa aktarımı indirildi.",
    emptyMemories:
      "Henüz kayıtlı bilgi yok. Yukarıya liste yapıştırabilir veya sohbette “bunu hatırla: …” diyebilirsin.",
    emptySearch: "Filtreyle eşleşen bilgi bulunamadı.",
    pinnedLabel: "Sabit",
    searchableLabel: "Aranabilir",
    learnedPrefix: "Öğrenildi",
    edit: "Düzenle",
    delete: "Sil",
    saveEdit: "Kaydet",
    factUpdated: "Bilgi güncellendi.",
    factDeleted: "Bilgi silindi.",
    journalTitleLabel: "Başlık",
    journalNotesLabel: "Notlar",
    journalTagsLabel: "Etiketler (isteğe bağlı)",
    addJournalBtn: "Not ekle",
    emptyJournal: "Henüz günlük notu yok.",
    tipRemember:
      "İpucu: Sohbette veya seste “bunu hatırla: …” (veya “remember this: …”) diyebilirsin.",
  },
} as const;

function formatLearnedDate(iso: string, lang: "en" | "tr"): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function MemoryPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [lang, setLang] = useState<"en" | "tr">("en");
  const [tab, setTab] = useState<"profile" | "journal">("profile");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | CanonicalMemoryCategory
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [previewItems, setPreviewItems] = useState<
    MemoryImportPreviewItem[] | null
  >(null);
  const [skippedSensitive, setSkippedSensitive] = useState<
    SkippedSensitiveLine[]
  >([]);
  const [submitting, setSubmitting] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingCategory, setEditingCategory] =
    useState<CanonicalMemoryCategory>("about_me");
  const [editingPinned, setEditingPinned] = useState(false);
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
  const catLabels = MEMORY_CATEGORY_LABELS[lang];

  const { data, error, mutate } = useSWR<MemoryApiResponse>(
    `${basePath}/api/memory`,
    fetcher
  );

  const allFacts = data?.profileFacts ?? [];
  const allJournal = data?.journalEntries ?? [];

  // Sort facts grouped in priority order (Rules & Preferences first, then newest learnedAt)
  const sortedFilteredFacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allFacts
      .filter((fact) => {
        const normCat = normalizeMemoryCategory(fact.category);
        if (categoryFilter !== "all" && normCat !== categoryFilter) {
          return false;
        }
        if (!q) {
          return true;
        }
        return (
          fact.value.toLowerCase().includes(q) ||
          normCat.includes(q) ||
          catLabels[normCat].toLowerCase().includes(q) ||
          fact.source.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const rankA = ORDERED_MEMORY_CATEGORIES.indexOf(
          normalizeMemoryCategory(a.category)
        );
        const rankB = ORDERED_MEMORY_CATEGORIES.indexOf(
          normalizeMemoryCategory(b.category)
        );
        if (rankA !== rankB) {
          return rankA - rankB;
        }
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return (b.learnedAt ?? b.updatedAt).localeCompare(
          a.learnedAt ?? a.updatedAt
        );
      });
  }, [allFacts, categoryFilter, searchQuery, catLabels]);

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
    const result = prepareMemoryImportPreview(bulkText, allFacts);
    setSkippedSensitive(result.skippedSensitive);
    setPreviewItems(result.items);
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

  function changePreviewCategory(
    itemId: string,
    nextCategory: CanonicalMemoryCategory
  ) {
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  category: nextCategory,
                  pinned: defaultPinnedForCategory(nextCategory),
                }
              : item
          )
        : null
    );
  }

  function togglePreviewPinned(itemId: string) {
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) =>
            item.id === itemId ? { ...item, pinned: !item.pinned } : item
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
      setSkippedSensitive([]);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${basePath}/api/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "profile_batch",
          source: "pasted",
          items: selected.map((item) => ({
            category: item.category,
            key: item.key,
            value: item.value,
            source: "pasted",
            pinned: item.pinned,
            sharedAcrossBots: true,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save memories");
      }
      const resJson = (await response.json()) as { savedCount?: number };
      setBulkText("");
      setPreviewItems(null);
      setSkippedSensitive([]);
      await mutate();
      toast({
        type: "success",
        description:
          lang === "tr"
            ? `${resJson.savedCount ?? selected.length} bilgi belleğe kaydedildi.`
            : `Saved ${resJson.savedCount ?? selected.length} facts to memory.`,
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
    setEditingCategory(normalizeMemoryCategory(fact.category));
    setEditingPinned(Boolean(fact.pinned));
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
          pinned: editingPinned,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not update memory");
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

  async function handleToggleSavedPinned(fact: ProfileFact) {
    try {
      const response = await fetch(`${basePath}/api/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "profile",
          id: fact.id,
          pinned: !fact.pinned,
        }),
      });
      if (response.ok) {
        await mutate();
      }
    } catch {
      /* ignore */
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
                if (previewItems || skippedSensitive.length > 0) {
                  setPreviewItems(null);
                  setSkippedSensitive([]);
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

          {(previewItems !== null || skippedSensitive.length > 0) && (
            <div
              className="mt-4 space-y-3 border-[color:var(--hairline)] border-t pt-4"
              data-testid="memory-import-preview"
            >
              {skippedSensitive.length > 0 && (
                <div
                  className="space-y-2 rounded-xl border border-amber-500/35 bg-amber-500/[0.08] p-3 text-xs"
                  data-testid="memory-sensitive-warning"
                >
                  <div className="flex items-start gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {t.sensitiveWarningTitle} ({skippedSensitive.length})
                    </span>
                  </div>
                  <ul className="space-y-1 pl-6 text-foreground/85">
                    {skippedSensitive.map((skip) => (
                      <li className="break-words" key={skip.id}>
                        <span className="mr-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 font-medium text-[11px] text-amber-900 dark:text-amber-200">
                          {t.sensitiveReasons[skip.reason]}
                        </span>
                        <span className="text-muted-foreground">
                          {skip.preview}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {previewItems && previewItems.length > 0 && (
                <>
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
                              ? prev.map((i) => ({
                                  ...i,
                                  checked: !i.isDuplicate,
                                }))
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

                  <div className="max-h-80 divide-y divide-[color:var(--hairline)] overflow-y-auto rounded-xl border border-[color:var(--hairline)] bg-background">
                    {previewItems.map((item) => (
                      <div
                        className={cn(
                          "flex items-start gap-3 px-3 py-2.5 text-sm",
                          item.isDuplicate && !item.checked && "opacity-60"
                        )}
                        data-testid="memory-preview-item"
                        key={item.id}
                      >
                        <input
                          aria-label={item.value}
                          checked={item.checked}
                          className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
                          data-testid="memory-preview-checkbox"
                          onChange={() => togglePreviewItem(item.id)}
                          type="checkbox"
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="break-words text-[14px] text-foreground leading-snug">
                            {item.value}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select
                              aria-label="Category"
                              className="min-h-8 rounded-full border border-[color:var(--hairline)] bg-card px-2.5 text-[12px] text-foreground"
                              data-testid="memory-preview-category"
                              onChange={(e) =>
                                changePreviewCategory(
                                  item.id,
                                  e.target.value as CanonicalMemoryCategory
                                )
                              }
                              value={item.category}
                            >
                              {ORDERED_MEMORY_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                  {catLabels[cat]}
                                </option>
                              ))}
                            </select>

                            <button
                              className={cn(
                                "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 font-medium text-[11px] transition-colors",
                                item.pinned
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-[color:var(--hairline)] bg-card text-muted-foreground hover:text-foreground"
                              )}
                              data-testid="memory-preview-pin"
                              onClick={() => togglePreviewPinned(item.id)}
                              type="button"
                            >
                              {item.pinned ? (
                                <>
                                  <PinIcon className="size-3" />
                                  {t.pinnedLabel}
                                </>
                              ) : (
                                <>
                                  <SearchIcon className="size-3" />
                                  {t.searchableLabel}
                                </>
                              )}
                            </button>

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
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-sm hover:bg-muted"
                  onClick={() => {
                    setPreviewItems(null);
                    setSkippedSensitive([]);
                  }}
                  type="button"
                >
                  {t.cancel}
                </button>
                {previewItems && previewItems.length > 0 && (
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
                )}
              </div>
            </div>
          )}
        </section>

        {/* Tabs + Export + Category Filter + Search */}
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

          {tab === "profile" && (
            <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
              <button
                className={cn(
                  "inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 font-medium text-xs transition-colors",
                  categoryFilter === "all"
                    ? "border-transparent bg-foreground text-background"
                    : "border-[color:var(--hairline)] bg-card text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setCategoryFilter("all")}
                type="button"
              >
                {t.allCategories}
              </button>
              {ORDERED_MEMORY_CATEGORIES.map((cat) => (
                <button
                  className={cn(
                    "inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 font-medium text-xs transition-colors",
                    categoryFilter === cat
                      ? "border-transparent bg-foreground text-background"
                      : "border-[color:var(--hairline)] bg-card text-muted-foreground hover:text-foreground"
                  )}
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  type="button"
                >
                  {catLabels[cat]}
                </button>
              ))}
            </div>
          )}

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
          sortedFilteredFacts.length === 0 ? (
            <p className="rounded-2xl border border-[color:var(--hairline)] bg-card p-6 text-center text-muted-foreground text-sm">
              {searchQuery.trim() || categoryFilter !== "all"
                ? t.emptySearch
                : t.emptyMemories}
            </p>
          ) : (
            <div
              className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card"
              data-testid="memory-saved-list"
            >
              {sortedFilteredFacts.map((fact) => {
                const isEditing = editingId === fact.id;
                const normCat = normalizeMemoryCategory(fact.category);
                return (
                  <article
                    className="p-3.5 sm:p-4"
                    data-testid="memory-fact-row"
                    key={fact.id}
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select
                              aria-label="Category"
                              className="min-h-10 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                              onChange={(e) =>
                                setEditingCategory(
                                  e.target.value as CanonicalMemoryCategory
                                )
                              }
                              value={editingCategory}
                            >
                              {ORDERED_MEMORY_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                  {catLabels[cat]}
                                </option>
                              ))}
                            </select>
                            <button
                              className={cn(
                                "inline-flex min-h-10 items-center gap-1 rounded-full border px-3 font-medium text-xs",
                                editingPinned
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-[color:var(--hairline)] bg-background text-muted-foreground"
                              )}
                              onClick={() => setEditingPinned((p) => !p)}
                              type="button"
                            >
                              <PinIcon className="size-3.5" />
                              {editingPinned
                                ? t.pinnedLabel
                                : t.searchableLabel}
                            </button>
                          </div>

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
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="break-words text-[15px] text-foreground leading-snug">
                            {fact.value}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground/85">
                              {catLabels[normCat]}
                            </span>
                            <button
                              className={cn(
                                "inline-flex min-h-6 items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors",
                                fact.pinned
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-[color:var(--hairline)] bg-background text-muted-foreground hover:text-foreground"
                              )}
                              data-testid="memory-pin-toggle"
                              onClick={() => handleToggleSavedPinned(fact)}
                              type="button"
                            >
                              {fact.pinned ? (
                                <>
                                  <PinIcon className="size-2.5" />
                                  {t.pinnedLabel}
                                </>
                              ) : (
                                <>
                                  <SearchIcon className="size-2.5" />
                                  {t.searchableLabel}
                                </>
                              )}
                            </button>
                            <span
                              className="rounded-full border border-[color:var(--hairline)] px-2 py-0.5 text-muted-foreground"
                              data-testid="memory-source-badge"
                            >
                              {formatMemorySourceLabel(fact.source, lang)}
                            </span>
                            <time
                              className="text-muted-foreground"
                              data-testid="memory-learned-date"
                            >
                              {t.learnedPrefix}{" "}
                              {formatLearnedDate(
                                fact.learnedAt ?? fact.updatedAt,
                                lang
                              )}
                            </time>
                          </div>
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
