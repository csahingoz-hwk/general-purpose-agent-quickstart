"use client";

import { useState } from "react";
import type {
  FictionalInboxMessage,
  FictionalInboxResult,
} from "@/lib/ai/tools/demo-inbox";

const categories: FictionalInboxMessage["category"][] = [
  "Projects",
  "Travel",
  "Personal",
];

export function FictionalInboxCard({
  result,
}: {
  result: FictionalInboxResult;
}) {
  const [minPriority, setMinPriority] = useState(3);
  const [showDraft, setShowDraft] = useState(false);

  if (
    result.kind !== "fictional-inbox" ||
    result.fixtureId !== "inbox-demo-v1" ||
    !Array.isArray(result.messages)
  ) {
    return (
      <p className="text-sm text-muted-foreground" role="alert">
        Demo data could not be displayed.
      </p>
    );
  }

  const tr = result.language === "tr";
  const filtered = result.messages.filter(
    (message) => message.priority >= minPriority
  );
  const replies = filtered.filter((message) => message.needsReply);
  const categoryLabels: Record<FictionalInboxMessage["category"], string> = {
    Projects: tr ? "Projeler" : "Projects",
    Travel: tr ? "Seyahat" : "Travel",
    Personal: tr ? "Kişisel" : "Personal",
  };

  return (
    <section
      aria-label={tr ? "Örnek gelen kutusu" : "Sample inbox"}
      className="w-full max-w-[620px] space-y-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm"
      data-testid="fictional-inbox-card"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-base">
            {tr ? "Örnek gelen kutusu" : "Fictional inbox"}
          </h3>
          <span className="rounded-full bg-muted px-2 py-1 text-xs">
            {tr ? "DEMO · Gerçek e-posta değil" : "DEMO · Not real email"}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {tr
            ? "12 tamamen hayalî mesaj. Gmail hesabına erişilmedi."
            : "12 fictional messages. No Gmail account was accessed."}
        </p>
      </div>

      <div aria-live="polite" className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-muted-foreground text-xs">
            {tr ? "Seçilen mesajlar" : "Matching messages"}
          </p>
          <p className="font-semibold text-2xl" data-testid="demo-inbox-count">
            {filtered.length}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-muted-foreground text-xs">
            {tr ? "Yanıt bekleyen" : "Need a reply"}
          </p>
          <p className="font-semibold text-2xl">{replies.length}</p>
        </div>
      </div>

      <div>
        <label
          className="mb-2 flex justify-between gap-2 text-sm"
          htmlFor="fictional-inbox-priority"
        >
          <span>{tr ? "Minimum öncelik" : "Minimum priority"}</span>
          <span className="font-medium" data-testid="demo-inbox-priority">
            {minPriority} / 5
          </span>
        </label>
        <input
          className="w-full accent-foreground"
          data-testid="demo-inbox-slider"
          id="fictional-inbox-priority"
          max={5}
          min={1}
          onChange={(event) => setMinPriority(Number(event.target.value))}
          step={1}
          type="range"
          value={minPriority}
        />
        <p className="mt-1 text-muted-foreground text-xs">
          {tr
            ? "Kaydırıcı anında güncellenir; yeni AI isteği gönderilmez."
            : "Slider updates instantly, with no new AI request."}
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-sm">
          {tr ? "Kategori dağılımı" : "Category breakdown"}
        </p>
        {categories.map((category) => {
          const count = filtered.filter(
            (message) => message.category === category
          ).length;
          const percent = (count / Math.max(1, filtered.length)) * 100;
          return (
            <div
              className="grid grid-cols-[80px_1fr_24px] items-center gap-2 text-xs"
              key={category}
            >
              <span>{categoryLabels[category]}</span>
              <div
                aria-label={`${categoryLabels[category]}: ${count}`}
                className="h-3 overflow-hidden rounded-full bg-muted"
                role="img"
              >
                <div
                  className="h-full rounded-full bg-foreground/70 transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-right tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="font-medium text-sm">
          {tr ? "Örnek mesajlar" : "Sample messages"}
        </p>
        <ul
          className="max-h-56 space-y-2 overflow-auto"
          data-testid="demo-inbox-messages"
        >
          {filtered.map((message) => (
            <li
              className="rounded-lg border border-border/60 p-2 text-sm"
              key={message.id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{message.subject}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {message.priority}/5
                </span>
              </div>
              <p className="truncate text-muted-foreground text-xs">
                {message.sender}
                {message.needsReply
                  ? tr
                    ? " · Yanıt bekliyor"
                    : " · Reply needed"
                  : ""}
              </p>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {tr ? "Bu eşikte mesaj yok." : "No messages at this threshold."}
          </p>
        )}
      </div>

      <div className="border-border border-t pt-3">
        <button
          aria-expanded={showDraft}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          onClick={() => setShowDraft((current) => !current)}
          type="button"
        >
          {showDraft
            ? tr
              ? "Örnek taslağı gizle"
              : "Hide sample draft"
            : tr
              ? "Gönderilmeyen örnek yanıtı göster"
              : "Show an unsent sample reply"}
        </button>
        {showDraft && (
          <p
            className="mt-2 rounded-xl bg-muted/50 p-3 text-sm"
            data-testid="demo-inbox-draft"
          >
            {tr
              ? "Örnek taslak (gönderilmedi): Mesajınız için teşekkürler. Hayalî proje planını inceleyip kısa süre içinde dönüş yapacağım."
              : "Sample draft (not sent): Thanks for your note. I'll review the fictional project plan and follow up shortly."}
          </p>
        )}
      </div>
    </section>
  );
}
