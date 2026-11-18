"use client";

import {
  AlertTriangleIcon,
  BookOpenIcon,
  CheckIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  GitCompareArrowsIcon,
  GitMergeIcon,
  Loader2Icon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  UserCheckIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import {
  buildMemoriesExportMarkdown,
  defaultPinnedForCategory,
  deriveFactKey,
  formatMemorySourceLabel,
  IMPORT_MEMORY_SOURCES,
  type ImportMemorySource,
  inferImportSourceFromFileName,
  MEMORY_CATEGORY_LABELS,
  normalizeMemoryCategory,
  ORDERED_MEMORY_CATEGORIES,
  type SensitiveMemoryReason,
  type SkippedSensitiveLine,
} from "@/lib/memory/bulk-import";
import type {
  FailedMergeChunk,
  MergedMemoryPreviewItem,
  MultiSourceMergeCounts,
  MultiSourceMergeResult,
} from "@/lib/memory/multi-source-merge";
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

type SourceSlotState = {
  id: string;
  source: ImportMemorySource;
  rawText: string;
  exportedAt: string;
  fileName?: string;
};

const QUICK_ADD_SOURCES: readonly ImportMemorySource[] = [
  "chatgpt",
  "claude",
  "gemini",
  "grok_bot",
] as const;

const LABELS = {
  en: {
    title: "Memory",
    subtitle:
      "Durable single-sentence facts grouped by category (Rules & Preferences first). Pinned facts are always included; searchable facts are pulled in when relevant.",
    autoBadge: "Active in chat & voice",
    pasteTitle: "Import & merge memories",
    pasteHint:
      "Paste or upload exports from ChatGPT, Claude, Gemini, or Grok Bot (JSON, Markdown, CSV, or bullets in English or Turkish). Duplicates are merged, conflicts keep the newest and flag choices, Korn Ferry entries keep only short role/region context, and passwords/cards/addresses are skipped.",
    uploadFiles: "Upload exports",
    addSource: "Add source",
    exportDateOptional: "Export date (optional)",
    removeSource: "Remove source",
    pastePlaceholderBySource: {
      chatgpt:
        "Paste ChatGPT memory list or memories.json…\n- [2025-09-12] Uses Google AI Pro tier\n- Lives in London (Europe/London)",
      claude:
        "Paste Claude memory summary or Markdown…\n- [2026-11-01] Uses Google AI Ultra tier ($40/mo Cloud credit)\n- Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, and Turkey",
      gemini:
        "Paste Gemini Saved Info (EN or TR)…\n- Kızım Ece GCSE Tarih sınavına hazırlanıyor\n- Kahvemi sade ve şekersiz içerim",
      grok_bot:
        "Paste Grok Bot memory export…\n- Never use pay-per-use API models without asking first",
      pasted:
        "- Never use pay-per-use API models without asking first\n- Prefer concise comparison tables with clear takeaways\n- I live in London (Europe/London)\n- Daughter's name is Ece…",
    } as Record<ImportMemorySource, string>,
    previewBtnSingle: "Merge & preview",
    mergingBtn: "Merging on Vertex…",
    previewHeading: "Merged memory preview",
    statNew: "new",
    statMerged: "merged",
    statConflicts: "conflicts",
    statSensitive: "skipped as sensitive",
    selectedReady: "ready to save",
    duplicatesSkipped: "already saved",
    selectAllNew: "Select active",
    clearSelection: "Clear",
    alreadySaved: "Already saved",
    mergedPrefix: "Merged",
    viewOriginals: "Merged lines",
    conflictBadge: "Conflict · Newest kept",
    newestBadge: "Newest",
    olderBadge: "Older",
    sensitiveWarningTitle:
      "Skipped sensitive or restricted lines — never sent to the model or stored in memory:",
    sensitiveReasons: {
      password: "Password / secret",
      card_number: "Card number",
      address: "Street / postal address",
      korn_ferry_data: "Korn Ferry data skipped (role/regions only)",
    } as Record<SensitiveMemoryReason, string>,
    approveOneTap: "Approve & save",
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
      "No memories saved yet. Paste or upload exports above, or say “remember this: …” in chat or voice.",
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
    pasteTitle: "Bellekleri içe aktar ve birleştir",
    pasteHint:
      "ChatGPT, Claude, Gemini veya Grok Bot dışa aktarımlarını (JSON, Markdown, CSV veya Türkçe/İngilizce maddeler) yapıştırın ya da yükleyin. Benzerler birleştirilir, çakışmalarda en yenisi seçilip onayınıza sunulur, Korn Ferry için yalnızca kısa görev/bölge bilgisi tutulur, şifre/kart/adres satırları atlanır.",
    uploadFiles: "Dosya yükle",
    addSource: "Kaynak ekle",
    exportDateOptional: "Tarih (isteğe bağlı)",
    removeSource: "Kaynağı kaldır",
    pastePlaceholderBySource: {
      chatgpt:
        "ChatGPT bellek listesini veya memories.json içeriğini yapıştırın…\n- [2025-09-12] Google AI Pro aboneliği kullanıyor\n- Londra'da yaşıyor (Europe/London)",
      claude:
        "Claude bellek özetini yapıştırın…\n- [2026-11-01] Google AI Ultra ($40/ay bulut kredisi) kullanıyor\n- Korn Ferry'de MENA Finans Kontrolörü olarak çalışıyor (BAE, Suudi Arabistan, Türkiye)",
      gemini:
        "Gemini Kayıtlı Bilgiler listesini yapıştırın…\n- Kızım Ece GCSE Tarih sınavına hazırlanıyor\n- Kahvemi sade ve şekersiz içerim",
      grok_bot:
        "Grok Bot bellek dışa aktarımını yapıştırın…\n- Onayım olmadan kullandıkça öde API modeli kullanma",
      pasted:
        "- Onayım olmadan asla kullandıkça öde API modeli kullanma\n- Kısa ve net karşılaştırma tablolarını tercih ederim\n- Londra'da yaşıyorum (Europe/London)\n- Kızımın adı Ece…",
    } as Record<ImportMemorySource, string>,
    previewBtnSingle: "Birleştir ve önizle",
    mergingBtn: "Vertex ile birleştiriliyor…",
    previewHeading: "Birleştirilmiş bellek önizlemesi",
    statNew: "yeni",
    statMerged: "birleştirilen",
    statConflicts: "çakışma",
    statSensitive: "hassas / atlanan",
    selectedReady: "kaydedilecek",
    duplicatesSkipped: "zaten kayıtlı",
    selectAllNew: "Aktifleri seç",
    clearSelection: "Temizle",
    alreadySaved: "Zaten kayıtlı",
    mergedPrefix: "Birleştirildi",
    viewOriginals: "Birleştirilen satırlar",
    conflictBadge: "Çakışma · En yenisi seçili",
    newestBadge: "En yeni",
    olderBadge: "Eski",
    sensitiveWarningTitle:
      "Hassas veya kısıtlı satırlar atlandı — modele gönderilmez ve bellekte saklanmaz:",
    sensitiveReasons: {
      password: "Şifre / gizli anahtar",
      card_number: "Kart numarası",
      address: "Açık adres / posta kodu",
      korn_ferry_data: "Korn Ferry verisi atlandı (yalnızca görev/bölge)",
    } as Record<SensitiveMemoryReason, string>,
    approveOneTap: "Onayla ve kaydet",
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
      "Henüz kayıtlı bilgi yok. Yukarıdan dışa aktarım yapıştırıp yükleyebilir veya sohbette “bunu hatırla: …” diyebilirsin.",
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

function formatModelUsedBadge(
  modelUsed: MultiSourceMergeResult["modelUsed"] | null
): string | null {
  if (modelUsed === "gemini-4-argon") {
    return "Gemini 4 Argon · Vertex";
  }
  if (modelUsed === "gemini-4-hydrogen") {
    return "Gemini 4 Hydrogen · Vertex";
  }
  if (modelUsed === "claude-haiku-5.5") {
    return "Claude Haiku 5.5 · Copilot";
  }
  return null;
}

let slotCounter = 1;
function createSlot(
  source: ImportMemorySource = "pasted",
  rawText = "",
  exportedAt = "",
  fileName?: string
): SourceSlotState {
  return {
    id: `slot_${slotCounter++}`,
    source,
    rawText,
    exportedAt,
    fileName,
  };
}

export default function MemoryPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [lang, setLang] = useState<"en" | "tr">("en");
  const [tab, setTab] = useState<"profile" | "journal">("profile");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | CanonicalMemoryCategory
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Multi-source import slots (starts with 1 clean slot; supports adding/uploading 3-4+ sources)
  const [slots, setSlots] = useState<SourceSlotState[]>(() => [
    { id: "slot_0", source: "pasted", rawText: "", exportedAt: "" },
  ]);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [failedChunks, setFailedChunks] = useState<FailedMergeChunk[]>([]);
  const [previewItems, setPreviewItems] = useState<
    MergedMemoryPreviewItem[] | null
  >(null);
  const [mergeCounts, setMergeCounts] = useState<MultiSourceMergeCounts | null>(
    null
  );
  const [skippedSensitive, setSkippedSensitive] = useState<
    SkippedSensitiveLine[]
  >([]);
  const [mergeModelUsed, setMergeModelUsed] = useState<
    MultiSourceMergeResult["modelUsed"] | null
  >(null);
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
    fetcher,
    { dedupingInterval: 2000, revalidateOnMount: true }
  );

  const allFacts = data?.profileFacts ?? [];
  const allJournal = data?.journalEntries ?? [];

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
          fact.source.toLowerCase().includes(q) ||
          formatMemorySourceLabel(fact.source, lang).toLowerCase().includes(q)
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
  }, [allFacts, categoryFilter, searchQuery, catLabels, lang]);

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

  function clearPreviewState() {
    if (
      previewItems !== null ||
      mergeCounts !== null ||
      skippedSensitive.length > 0 ||
      failedChunks.length > 0
    ) {
      setPreviewItems(null);
      setMergeCounts(null);
      setSkippedSensitive([]);
      setFailedChunks([]);
      setMergeModelUsed(null);
    }
  }

  function handleQuickAddSource(source: ImportMemorySource) {
    clearPreviewState();
    setSlots((prev) => {
      if (
        prev.length === 1 &&
        !prev[0]?.rawText.trim() &&
        prev[0]?.source === "pasted"
      ) {
        return [{ ...(prev[0] as SourceSlotState), source }];
      }
      if (prev.length >= 10) {
        return prev;
      }
      return [...prev, createSlot(source)];
    });
  }

  function handleUpdateSlot(
    slotId: string,
    patch: Partial<Omit<SourceSlotState, "id">>
  ) {
    clearPreviewState();
    setSlots((prev) =>
      prev.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot))
    );
  }

  function handleRemoveSlot(slotId: string) {
    clearPreviewState();
    setSlots((prev) => {
      if (prev.length <= 1) {
        return [
          { id: "slot_0", source: "pasted", rawText: "", exportedAt: "" },
        ];
      }
      return prev.filter((slot) => slot.id !== slotId);
    });
  }

  async function handleFilesSelected(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }
    clearPreviewState();
    const files = Array.from(fileList).slice(0, 8);
    const loadedSlots: SourceSlotState[] = [];
    for (const file of files) {
      try {
        const text = (await file.text()).slice(0, 250_000);
        if (!text.trim()) {
          continue;
        }
        const source = inferImportSourceFromFileName(file.name);
        const exportedAt = file.lastModified
          ? new Date(file.lastModified).toISOString().slice(0, 10)
          : "";
        loadedSlots.push(createSlot(source, text, exportedAt, file.name));
      } catch {
        /* ignore unreadable file */
      }
    }
    event.target.value = "";
    if (loadedSlots.length === 0) {
      return;
    }
    setSlots((prev) => {
      const nonEmptyPrev = prev.filter((s) => s.rawText.trim().length > 0);
      return [...nonEmptyPrev, ...loadedSlots].slice(0, 10);
    });
  }

  const hasAnySourceText = slots.some((s) => s.rawText.trim().length > 0);

  async function handleBuildPreview(event: React.FormEvent) {
    event.preventDefault();
    const nonEmpty = slots.filter((s) => s.rawText.trim().length > 0);
    if (nonEmpty.length === 0) {
      return;
    }
    setMerging(true);
    setMergeProgress(null);
    try {
      const response = await fetch(`${basePath}/api/memory/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        body: JSON.stringify({
          sources: nonEmpty.map((s) => ({
            id: s.id,
            source: s.source,
            rawText: s.rawText,
            fileName: s.fileName,
            exportedAt: s.exportedAt || undefined,
          })),
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      let resJson: Partial<MultiSourceMergeResult & { error?: string }> = {};

      if (contentType.includes("application/x-ndjson") && response.body) {
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buf += value;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }
            const msg = JSON.parse(trimmed) as {
              type?: string;
              completedChunks?: number;
              totalChunks?: number;
              data?: MultiSourceMergeResult;
              error?: string;
            };
            if (
              msg.type === "progress" &&
              typeof msg.totalChunks === "number" &&
              msg.totalChunks > 1
            ) {
              setMergeProgress({
                completed: msg.completedChunks ?? 0,
                total: msg.totalChunks,
              });
            } else if (msg.type === "result" && msg.data) {
              resJson = msg.data;
            } else if (msg.type === "error") {
              resJson = { error: msg.error };
            }
          }
        }
        if (buf.trim()) {
          const msg = JSON.parse(buf.trim()) as {
            type?: string;
            data?: MultiSourceMergeResult;
            error?: string;
          };
          if (msg.type === "result" && msg.data) {
            resJson = msg.data;
          } else if (msg.type === "error") {
            resJson = { error: msg.error };
          }
        }
      } else {
        resJson = (await response.json().catch(() => ({}))) as Partial<
          MultiSourceMergeResult & { error?: string }
        >;
      }

      if (!response.ok || !Array.isArray(resJson.items) || !resJson.counts) {
        throw new Error(
          resJson.error ??
            "Could not merge memory exports right now. Please try again."
        );
      }
      setPreviewItems(resJson.items);
      setMergeCounts(resJson.counts);
      setSkippedSensitive(resJson.skippedSensitive ?? []);
      setFailedChunks(resJson.failedChunks ?? []);
      setMergeModelUsed(resJson.modelUsed ?? null);
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not merge memory exports",
      });
    } finally {
      setMerging(false);
      setMergeProgress(null);
    }
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

  function selectConflictOption(itemId: string, optionIndex: number) {
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) => {
            if (item.id !== itemId || !item.conflictOptions?.[optionIndex]) {
              return item;
            }
            const chosen = item.conflictOptions[optionIndex];
            return {
              ...item,
              selectedOptionIndex: optionIndex,
              value: chosen.fact,
              key: deriveFactKey(chosen.fact),
              source: chosen.source,
              learnedAt: chosen.observedAt,
              checked: true,
            };
          })
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
      setMergeCounts(null);
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
            source: item.source,
            pinned: item.pinned,
            learnedAt: item.learnedAt ?? undefined,
            replaceFactId: item.replaceFactId,
            sharedAcrossBots: true,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save memories");
      }
      const resJson = (await response.json()) as { savedCount?: number };
      const remainingFailedText = failedChunks
        .map((fc) => fc.retryText)
        .filter(Boolean)
        .join("\n");
      setSlots([
        {
          id: "slot_0",
          source: "pasted",
          rawText: remainingFailedText,
          exportedAt: "",
        },
      ]);
      setPreviewItems(null);
      setMergeCounts(null);
      setSkippedSensitive([]);
      setFailedChunks([]);
      setMergeModelUsed(null);
      await mutate();
      toast({
        type: "success",
        description: remainingFailedText
          ? lang === "tr"
            ? `${resJson.savedCount ?? selected.length} bilgi kaydedildi. Başarısız kalan bölüm kutuda hazır.`
            : `Saved ${resJson.savedCount ?? selected.length} facts. The failed section is ready in the box to retry.`
          : lang === "tr"
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
  const alreadySavedPreviewCount =
    previewItems?.filter((item) => item.status === "already_saved").length ?? 0;
  const modelBadge = formatModelUsedBadge(mergeModelUsed);

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

        {/* Multi-Source Import & One-Tap Vertex Merge Card */}
        <section className="rounded-2xl border border-[color:var(--hairline)] bg-card p-4">
          <form className="space-y-3" onSubmit={handleBuildPreview}>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-[15px] text-foreground">
                  {t.pasteTitle}
                </h2>
                <div>
                  <input
                    accept=".txt,.md,.markdown,.json,.csv,text/plain,application/json,text/csv"
                    className="sr-only"
                    data-testid="memory-upload-files-input"
                    multiple
                    onChange={handleFilesSelected}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted"
                    data-testid="memory-upload-files-button"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <UploadIcon className="size-3.5" />
                    <span>{t.uploadFiles}</span>
                  </button>
                </div>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t.pasteHint}
              </p>
            </div>

            {/* Quick-add source pills */}
            <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
              {QUICK_ADD_SOURCES.map((src) => (
                <button
                  className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-2.5 font-medium text-foreground text-xs transition-colors hover:bg-muted"
                  data-testid={`memory-add-source-${src}`}
                  key={src}
                  onClick={() => handleQuickAddSource(src)}
                  type="button"
                >
                  <PlusIcon className="size-3 text-muted-foreground" />
                  <span>{formatMemorySourceLabel(src, lang)}</span>
                </button>
              ))}
              {slots.length < 10 && (
                <button
                  className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-[color:var(--hairline)] px-2.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
                  data-testid="memory-add-source-other"
                  onClick={() =>
                    setSlots((prev) => [...prev, createSlot("pasted")])
                  }
                  type="button"
                >
                  <PlusIcon className="size-3" />
                  <span>{t.addSource}</span>
                </button>
              )}
            </div>

            {/* Source Slots */}
            <div className="space-y-2.5">
              {slots.map((slot, idx) => (
                <div
                  className="space-y-2 rounded-xl border border-[color:var(--hairline)] bg-background p-2.5"
                  data-testid={`memory-source-slot-${idx}`}
                  key={slot.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <select
                        aria-label="Export source"
                        className="min-h-9 rounded-full border border-[color:var(--hairline)] bg-card px-3 font-medium text-[14px] text-foreground"
                        data-testid={`memory-source-select-${idx}`}
                        onChange={(e) =>
                          handleUpdateSlot(slot.id, {
                            source: e.target.value as ImportMemorySource,
                          })
                        }
                        value={slot.source}
                      >
                        {IMPORT_MEMORY_SOURCES.map((src) => (
                          <option key={src} value={src}>
                            {formatMemorySourceLabel(src, lang)}
                          </option>
                        ))}
                      </select>

                      <input
                        aria-label={t.exportDateOptional}
                        className="min-h-9 rounded-full border border-[color:var(--hairline)] bg-card px-2.5 text-[13px] text-muted-foreground"
                        data-testid={`memory-source-date-${idx}`}
                        onChange={(e) =>
                          handleUpdateSlot(slot.id, {
                            exportedAt: e.target.value,
                          })
                        }
                        type="date"
                        value={slot.exportedAt}
                      />

                      {slot.fileName && (
                        <span className="max-w-40 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {slot.fileName}
                        </span>
                      )}
                    </div>

                    {slots.length > 1 && (
                      <button
                        aria-label={t.removeSource}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        data-testid={`memory-source-remove-${idx}`}
                        onClick={() => handleRemoveSlot(slot.id)}
                        type="button"
                      >
                        <XIcon className="size-4" />
                      </button>
                    )}
                  </div>

                  <textarea
                    aria-label={`${formatMemorySourceLabel(slot.source, lang)} export`}
                    className="min-h-28 w-full rounded-lg border border-[color:var(--hairline)] bg-card/50 p-2.5 text-[16px] text-foreground leading-relaxed placeholder:text-muted-foreground"
                    data-slot-index={idx}
                    data-testid={
                      idx === 0
                        ? "memory-bulk-textarea"
                        : `memory-source-textarea-${idx}`
                    }
                    onChange={(e) =>
                      handleUpdateSlot(slot.id, { rawText: e.target.value })
                    }
                    placeholder={t.pastePlaceholderBySource[slot.source]}
                    value={slot.rawText}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <SparklesIcon className="size-3.5 shrink-0" />
                <span>{t.tipRemember}</span>
              </p>
              <button
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                data-testid="memory-preview-button"
                disabled={
                  !hasAnySourceText ||
                  merging ||
                  submitting ||
                  data?.status === "setup_required"
                }
                type="submit"
              >
                {merging ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    <span>
                      {mergeProgress && mergeProgress.total > 1
                        ? lang === "tr"
                          ? `Bölüm ${Math.min(mergeProgress.total, mergeProgress.completed + 1)}/${mergeProgress.total} birleştiriliyor…`
                          : `Merging part ${Math.min(mergeProgress.total, mergeProgress.completed + 1)}/${mergeProgress.total}…`
                        : t.mergingBtn}
                    </span>
                  </>
                ) : (
                  <>
                    <GitMergeIcon className="size-4" />
                    <span>{t.previewBtnSingle}</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {(previewItems !== null || skippedSensitive.length > 0) && (
            <div
              className="mt-4 space-y-3 border-[color:var(--hairline)] border-t pt-4"
              data-testid="memory-import-preview"
            >
              {/* Header + 4-stat summary + One-tap Approve button */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground text-sm">
                        {t.previewHeading}
                      </h3>
                      {modelBadge && (
                        <span
                          className="rounded-full border border-[color:var(--hairline)] bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                          data-testid="memory-merge-model"
                        >
                          {modelBadge}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-muted-foreground text-xs tabular-nums"
                      data-testid="memory-preview-summary"
                    >
                      {selectedPreviewCount} {t.selectedReady}
                      {alreadySavedPreviewCount > 0
                        ? ` · ${alreadySavedPreviewCount} ${t.duplicatesSkipped}`
                        : ""}
                    </p>
                  </div>

                  {/* One-tap Approve CTA at top for instant iPhone approval */}
                  <div className="flex items-center gap-1.5">
                    <button
                      className="inline-flex min-h-10 items-center rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                      onClick={() => {
                        setPreviewItems(null);
                        setMergeCounts(null);
                        setSkippedSensitive([]);
                        setMergeModelUsed(null);
                      }}
                      type="button"
                    >
                      {t.cancel}
                    </button>
                    {previewItems && previewItems.length > 0 && (
                      <button
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs disabled:opacity-50"
                        data-testid="memory-confirm-save"
                        disabled={selectedPreviewCount === 0 || submitting}
                        onClick={handleConfirmBatchSave}
                        type="button"
                      >
                        <CheckIcon className="size-3.5" />
                        <span>
                          {submitting
                            ? t.saving
                            : `${t.approveOneTap} (${selectedPreviewCount})`}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {mergeCounts && (
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                    data-testid="memory-merge-stats"
                  >
                    <div
                      className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2"
                      data-testid="memory-stat-new"
                    >
                      <div className="font-semibold text-base text-emerald-700 tabular-nums dark:text-emerald-300">
                        {mergeCounts.newCount}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.statNew}
                      </div>
                    </div>
                    <div
                      className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-3 py-2"
                      data-testid="memory-stat-merged"
                    >
                      <div className="font-semibold text-base text-sky-700 tabular-nums dark:text-sky-300">
                        {mergeCounts.mergedCount}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.statMerged}
                      </div>
                    </div>
                    <div
                      className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2"
                      data-testid="memory-stat-conflicts"
                    >
                      <div className="font-semibold text-amber-800 text-base tabular-nums dark:text-amber-300">
                        {mergeCounts.conflictCount}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.statConflicts}
                      </div>
                    </div>
                    <div
                      className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2"
                      data-testid="memory-stat-sensitive"
                    >
                      <div className="font-semibold text-base text-rose-700 tabular-nums dark:text-rose-300">
                        {mergeCounts.skippedSensitiveCount}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.statSensitive}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {failedChunks.length > 0 && (
                <div
                  className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
                  data-testid="memory-failed-chunks-banner"
                >
                  <div className="flex items-start gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {lang === "tr"
                        ? `${failedChunks.length} bölüm şu anda birleştirilemedi — diğer başarılı bölümler aşağıda kaydetmeye hazır:`
                        : `${failedChunks.length} section${failedChunks.length === 1 ? "" : "s"} could not be merged right now — all other sections succeeded and are ready to save below:`}
                    </span>
                  </div>
                  <ul className="space-y-1 pl-6 text-foreground/85">
                    {failedChunks.map((fc) => (
                      <li className="break-words" key={fc.chunkNumber}>
                        <span className="font-semibold">
                          {lang === "tr"
                            ? `Bölüm ${fc.chunkNumber}/${fc.totalChunks} (${fc.lineCount} satır): `
                            : `Part ${fc.chunkNumber}/${fc.totalChunks} (${fc.lineCount} lines): `}
                        </span>
                        <span className="text-muted-foreground">
                          “{fc.preview}…”
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
                        <span className="mr-1.5 inline-block rounded-full bg-amber-500/20 px-2 py-0.5 font-medium text-[11px] text-amber-900 dark:text-amber-200">
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
                  <div className="flex items-center justify-end gap-1.5 text-xs">
                    <button
                      className="min-h-8 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground hover:bg-muted"
                      onClick={() =>
                        setPreviewItems((prev) =>
                          prev
                            ? prev.map((i) => ({
                                ...i,
                                checked: i.status !== "already_saved",
                              }))
                            : null
                        )
                      }
                      type="button"
                    >
                      {t.selectAllNew}
                    </button>
                    <button
                      className="min-h-8 rounded-full border border-[color:var(--hairline)] bg-background px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
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

                  <div className="max-h-96 divide-y divide-[color:var(--hairline)] overflow-y-auto rounded-xl border border-[color:var(--hairline)] bg-background">
                    {previewItems.map((item) => {
                      const isConflict =
                        item.status === "conflict" &&
                        item.conflictOptions &&
                        item.conflictOptions.length >= 2;
                      return (
                        <div
                          className={cn(
                            "flex items-start gap-3 px-3 py-3 text-sm",
                            item.status === "already_saved" &&
                              !item.checked &&
                              "opacity-60",
                            isConflict && "bg-amber-500/[0.04]"
                          )}
                          data-testid={
                            isConflict
                              ? "memory-conflict-item"
                              : "memory-preview-item"
                          }
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
                          <div className="min-w-0 flex-1 space-y-2">
                            {isConflict ? (
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 font-medium text-[11px] text-amber-900 dark:text-amber-200"
                                    data-testid="memory-conflict-badge"
                                  >
                                    <GitCompareArrowsIcon className="size-3" />
                                    <span>{t.conflictBadge}</span>
                                  </span>
                                  {item.conflictTopic && (
                                    <span className="text-muted-foreground text-xs">
                                      {item.conflictTopic}
                                    </span>
                                  )}
                                </div>

                                <div className="space-y-1.5">
                                  {item.conflictOptions?.map((opt, optIdx) => {
                                    const selected =
                                      (item.selectedOptionIndex ?? 0) ===
                                      optIdx;
                                    return (
                                      <button
                                        className={cn(
                                          "flex min-h-11 w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
                                          selected
                                            ? "border-primary/45 bg-primary/[0.06]"
                                            : "border-[color:var(--hairline)] bg-card/60 hover:bg-muted/60"
                                        )}
                                        data-testid="memory-conflict-option"
                                        key={`${item.id}_opt_${optIdx}`}
                                        onClick={() =>
                                          selectConflictOption(item.id, optIdx)
                                        }
                                        type="button"
                                      >
                                        <span
                                          className={cn(
                                            "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                                            selected
                                              ? "border-primary bg-primary text-primary-foreground"
                                              : "border-muted-foreground/40"
                                          )}
                                        >
                                          {selected && (
                                            <CheckIcon className="size-2.5" />
                                          )}
                                        </span>
                                        <span className="min-w-0 flex-1 space-y-1">
                                          <span className="block break-words text-[13.5px] text-foreground leading-snug">
                                            {opt.fact}
                                          </span>
                                          <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                            <span
                                              className={cn(
                                                "rounded-full px-2 py-0.5 font-medium",
                                                opt.isNewest
                                                  ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                                                  : "bg-muted text-muted-foreground"
                                              )}
                                            >
                                              {opt.isNewest
                                                ? t.newestBadge
                                                : t.olderBadge}
                                            </span>
                                            <span className="rounded-full border border-[color:var(--hairline)] px-2 py-0.5 text-muted-foreground">
                                              {formatMemorySourceLabel(
                                                opt.source,
                                                lang
                                              )}
                                            </span>
                                            {opt.observedAt && (
                                              <span className="text-muted-foreground tabular-nums">
                                                {opt.observedAt.slice(0, 10)}
                                              </span>
                                            )}
                                          </span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <p className="break-words text-[14px] text-foreground leading-snug">
                                {item.value}
                              </p>
                            )}

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

                              {item.status === "merged" ? (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-[11px] text-sky-800 dark:text-sky-300"
                                  data-testid="memory-merged-badge"
                                >
                                  <GitMergeIcon className="size-3" />
                                  <span>
                                    {t.mergedPrefix} ·{" "}
                                    {formatMemorySourceLabel(item.source, lang)}
                                  </span>
                                </span>
                              ) : (
                                <span className="rounded-full border border-[color:var(--hairline)] px-2 py-0.5 text-[11px] text-muted-foreground">
                                  {formatMemorySourceLabel(item.source, lang)}
                                </span>
                              )}

                              {item.status === "already_saved" && (
                                <span
                                  className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-[11px] text-amber-800 dark:text-amber-300"
                                  data-testid="memory-duplicate-badge"
                                >
                                  {t.alreadySaved}
                                </span>
                              )}
                            </div>

                            {item.status === "merged" &&
                              item.mergedOriginals &&
                              item.mergedOriginals.length >= 2 && (
                                <details className="text-muted-foreground text-xs">
                                  <summary className="cursor-pointer select-none hover:text-foreground">
                                    {t.viewOriginals} (
                                    {item.mergedOriginals.length})
                                  </summary>
                                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px]">
                                    {item.mergedOriginals.map((orig, oIdx) => (
                                      <li
                                        className="break-words"
                                        key={`${item.id}_orig_${oIdx}`}
                                      >
                                        {orig}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
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
