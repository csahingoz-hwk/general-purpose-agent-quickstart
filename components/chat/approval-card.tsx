"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  FilmIcon,
  GitPullRequestIcon,
  MailIcon,
  PencilIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { RiskLevel } from "@/lib/safety/action-review";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<RiskLevel, string> = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium:
    "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-300",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Düşük risk",
  medium: "İnceleme",
  high: "Yüksek etki",
  critical: "Kritik inceleme",
};

const GENERIC_KEY_LABELS: Record<string, string> = {
  recipient: "Kime",
  to: "Kime",
  subject: "Konu",
  body: "İleti",
  content: "İçerik",
  title: "Başlık",
  description: "Açıklama",
  startIso: "Başlangıç",
  endIso: "Bitiş",
  cronExpression: "Zamanlama",
  timezone: "Saat dilimi",
  prompt: "Yönerge",
  owner: "Hesap",
  repo: "Depo",
  pullNumber: "PR numarası",
  city: "Konum",
  command: "Komut",
  url: "Bağlantı",
  aspectRatio: "Oran",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean).join(", ");
  }
  return "";
}

function formatTurkishDateTime(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) {
    return "—";
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return trimmed;
  }
}

function humanizeKey(key: string): string {
  if (GENERIC_KEY_LABELS[key]) {
    return GENERIC_KEY_LABELS[key];
  }
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DraftInputPatch = {
  recipient: string;
  subject: string;
  body: string;
};

export type ApprovalCardProps = {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  approvalId?: string;
  approved?: boolean;
  input?: unknown;
  output?: unknown;
  isReadonly?: boolean;
  locale?: "en" | "tr";
  onUpdateDraftInput?: (patch: DraftInputPatch) => void;
  reasons?: readonly string[];
  riskLevel?: RiskLevel;
  state: string;
  title: string;
  toolName: string;
};

function ToolIcon({ toolName }: { toolName: string }) {
  if (toolName === "gmailCreateDraft") {
    return <MailIcon className="size-4 shrink-0 text-primary" />;
  }
  if (toolName === "calendarCreateDraftEvent") {
    return <CalendarIcon className="size-4 shrink-0 text-primary" />;
  }
  if (toolName === "driveCreateDraftDoc") {
    return <FileTextIcon className="size-4 shrink-0 text-primary" />;
  }
  if (toolName === "githubCreateDraftReview") {
    return <GitPullRequestIcon className="size-4 shrink-0 text-primary" />;
  }
  if (toolName === "scheduleTask") {
    return <ClockIcon className="size-4 shrink-0 text-primary" />;
  }
  if (toolName === "generateVideoClip") {
    return <FilmIcon className="size-4 shrink-0 text-primary" />;
  }
  return <ShieldAlertIcon className="size-4 shrink-0 text-muted-foreground" />;
}

function resolveBadge(
  toolName: string,
  riskLevel: RiskLevel
): { label: string; className: string; testId?: string } {
  if (toolName === "gmailCreateDraft") {
    return {
      label: "Asla göndermez",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      testId: "approval-never-sends-badge",
    };
  }
  if (toolName === "calendarCreateDraftEvent") {
    return {
      label: "Davet göndermez",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (toolName === "driveCreateDraftDoc") {
    return {
      label: "Özel taslak · Paylaşılmaz",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (toolName === "githubCreateDraftReview") {
    return {
      label: "Yayınlanmaz · Taslak",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  return {
    label: RISK_LABELS[riskLevel],
    className: RISK_STYLES[riskLevel],
  };
}

const SAVE_CTA_TOOLS = new Set([
  "gmailCreateDraft",
  "calendarCreateDraftEvent",
  "driveCreateDraftDoc",
  "githubCreateDraftReview",
  "scheduleTask",
]);

export function ApprovalCard({
  addToolApprovalResponse,
  approvalId,
  approved,
  input,
  output,
  isReadonly = false,
  onUpdateDraftInput,
  reasons = [],
  riskLevel = "high",
  state,
  title,
  toolName,
}: ApprovalCardProps) {
  const inputRec = asRecord(input);
  const outputRec = asRecord(output);

  const initialTo = asString(outputRec.recipient ?? inputRec.recipient);
  const initialSubject = asString(outputRec.subject ?? inputRec.subject);
  const initialBody = asString(outputRec.body ?? inputRec.body);

  const [isEditing, setIsEditing] = useState(false);
  const [draftTo, setDraftTo] = useState(initialTo);
  const [draftSubject, setDraftSubject] = useState(initialSubject);
  const [draftBody, setDraftBody] = useState(initialBody);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasUserEdited) {
      setDraftTo(initialTo);
      setDraftSubject(initialSubject);
      setDraftBody(initialBody);
    }
  }, [hasUserEdited, initialTo, initialSubject, initialBody]);

  const isEmailDraft = toolName === "gmailCreateDraft";
  const isDenied =
    state === "output-denied" ||
    (state === "approval-responded" && approved === false);
  const isPending = state === "approval-requested" && Boolean(approvalId);
  const isSaving = state === "approval-responded" && approved === true;
  const isCompleted = state === "output-available";
  const outputStatus = asString(outputRec.status);
  const isBlockedBoundary = outputStatus === "blocked_data_boundary";
  const isActionError =
    outputStatus === "error" || outputStatus === "connector_error";

  const badge = resolveBadge(toolName, riskLevel);
  const primaryLabel = SAVE_CTA_TOOLS.has(toolName) ? "Kaydet" : "Onayla";

  function handleSaveOrApprove() {
    if (!approvalId) {
      return;
    }
    if (isEmailDraft) {
      const cleanTo = draftTo.trim();
      const cleanSubject = draftSubject.trim();
      const cleanBody = draftBody.trim();
      if (!SIMPLE_EMAIL_RE.test(cleanTo) || !cleanSubject || !cleanBody) {
        setEditError(
          "Lütfen geçerli bir alıcı e-postası, konu ve ileti metni girin."
        );
        setIsEditing(true);
        return;
      }
      setEditError(null);
      setIsEditing(false);
      const editedChanged =
        cleanTo !== initialTo.trim() ||
        cleanSubject !== initialSubject.trim() ||
        draftBody !== initialBody;
      if (editedChanged) {
        onUpdateDraftInput?.({
          recipient: cleanTo,
          subject: cleanSubject,
          body: draftBody,
        });
      }
      addToolApprovalResponse({
        id: approvalId,
        approved: true,
        ...(editedChanged
          ? {
              options: {
                body: {
                  editedDraftApproval: {
                    approvalId,
                    recipient: cleanTo,
                    subject: cleanSubject,
                    body: draftBody,
                  },
                },
              },
            }
          : {}),
      });
      return;
    }

    addToolApprovalResponse({
      id: approvalId,
      approved: true,
    });
  }

  function renderHumanPreview() {
    if (isEmailDraft) {
      if (isEditing && isPending && !isReadonly) {
        return (
          <div
            className="mt-3 space-y-3 rounded-2xl border border-[color:var(--hairline)] bg-muted/20 p-3.5"
            data-testid="email-draft-editor"
          >
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                Kime
              </span>
              <input
                className="w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="email-edit-to"
                onChange={(e) => {
                  setHasUserEdited(true);
                  setDraftTo(e.target.value);
                  if (editError) {
                    setEditError(null);
                  }
                }}
                placeholder="ornek@alanadi.com"
                type="email"
                value={draftTo}
              />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                Konu
              </span>
              <input
                className="w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="email-edit-subject"
                onChange={(e) => {
                  setHasUserEdited(true);
                  setDraftSubject(e.target.value);
                  if (editError) {
                    setEditError(null);
                  }
                }}
                type="text"
                value={draftSubject}
              />
            </label>
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                İleti
              </span>
              <textarea
                className="w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 py-2 text-base text-foreground leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="email-edit-body"
                onChange={(e) => {
                  setHasUserEdited(true);
                  setDraftBody(e.target.value);
                  if (editError) {
                    setEditError(null);
                  }
                }}
                rows={5}
                value={draftBody}
              />
            </label>
            {editError ? (
              <p
                className="text-destructive text-xs"
                data-testid="email-edit-error"
                role="alert"
              >
                {editError}
              </p>
            ) : null}
          </div>
        );
      }

      return (
        <div
          className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]"
          data-testid="email-draft-preview"
        >
          <div
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5"
            data-testid="email-preview-to"
          >
            <span className="w-12 shrink-0 font-medium text-muted-foreground text-xs">
              Kime
            </span>
            <span className="min-w-0 flex-1 break-all text-foreground">
              {draftTo || "—"}
            </span>
          </div>
          <div
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5"
            data-testid="email-preview-subject"
          >
            <span className="w-12 shrink-0 font-medium text-muted-foreground text-xs">
              Konu
            </span>
            <span className="min-w-0 flex-1 break-words font-medium text-foreground">
              {draftSubject || "—"}
            </span>
          </div>
          <div
            className="whitespace-pre-wrap break-words px-3.5 py-3 text-[15px] text-foreground leading-relaxed"
            data-testid="email-preview-body"
          >
            {draftBody}
          </div>
        </div>
      );
    }

    if (toolName === "calendarCreateDraftEvent") {
      const eventTitle = asString(outputRec.summary ?? inputRec.title);
      const startIso = asString(inputRec.startIso);
      const endIso = asString(inputRec.endIso);
      const description = asString(inputRec.description);
      return (
        <div
          className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]"
          data-testid="calendar-draft-preview"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs">
              Başlık
            </span>
            <span className="min-w-0 flex-1 break-words font-medium text-foreground">
              {eventTitle || "—"}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs">
              Başlangıç
            </span>
            <span className="min-w-0 flex-1 text-foreground tabular-nums">
              {formatTurkishDateTime(startIso)}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs">
              Bitiş
            </span>
            <span className="min-w-0 flex-1 text-foreground tabular-nums">
              {formatTurkishDateTime(endIso)}
            </span>
          </div>
          {description ? (
            <div className="whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] text-foreground leading-relaxed">
              {description}
            </div>
          ) : null}
        </div>
      );
    }

    if (toolName === "driveCreateDraftDoc") {
      const docTitle = asString(outputRec.name ?? inputRec.title);
      const docContent = asString(inputRec.content);
      return (
        <div
          className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]"
          data-testid="drive-draft-preview"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs">
              Belge adı
            </span>
            <span className="min-w-0 flex-1 break-words font-medium text-foreground">
              {docTitle || "—"}
            </span>
          </div>
          {docContent ? (
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] text-foreground leading-relaxed">
              {docContent}
            </div>
          ) : null}
        </div>
      );
    }

    if (toolName === "githubCreateDraftReview") {
      const repoPath = [asString(inputRec.owner), asString(inputRec.repo)]
        .filter(Boolean)
        .join("/");
      const prNum = asString(inputRec.pullNumber);
      const reviewBody = asString(inputRec.body);
      return (
        <div
          className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]"
          data-testid="github-draft-preview"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs">
              Depo
            </span>
            <span className="min-w-0 flex-1 break-all font-medium text-foreground">
              {repoPath || "—"}
              {prNum ? ` · PR #${prNum}` : ""}
            </span>
          </div>
          {reviewBody ? (
            <div className="whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] text-foreground leading-relaxed">
              {reviewBody}
            </div>
          ) : null}
        </div>
      );
    }

    if (toolName === "scheduleTask") {
      const cron = asString(inputRec.cronExpression);
      const tz = asString(inputRec.timezone) || "Europe/London";
      const routinePrompt = asString(inputRec.prompt);
      return (
        <div
          className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]"
          data-testid="schedule-draft-preview"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-24 shrink-0 font-medium text-muted-foreground text-xs">
              Zamanlama
            </span>
            <span className="min-w-0 flex-1 font-mono text-[13px] text-foreground">
              {cron || "—"} ({tz})
            </span>
          </div>
          {routinePrompt ? (
            <div className="whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] text-foreground leading-relaxed">
              {routinePrompt}
            </div>
          ) : null}
        </div>
      );
    }

    const entries = Object.entries(inputRec).filter(
      ([, v]) => v !== undefined && v !== null && asString(v).trim() !== ""
    );
    if (entries.length === 0) {
      return null;
    }

    return (
      <div
        className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]"
        data-testid="generic-approval-preview"
      >
        {entries.map(([k, v]) => (
          <div
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5"
            key={k}
          >
            <span className="w-24 shrink-0 font-medium text-muted-foreground text-xs">
              {humanizeKey(k)}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
              {asString(v)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section
      className="w-[min(100%,40rem)] rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-foreground"
      data-testid={`approval-card-${toolName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ToolIcon toolName={toolName} />
          <h3 className="font-semibold text-[15px] leading-snug">{title}</h3>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
            badge.className
          )}
          data-testid={badge.testId}
        >
          {badge.label}
        </span>
      </div>

      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      )}

      {renderHumanPreview()}

      {isPending && !isReadonly && approvalId && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-1.5 border-[color:var(--hairline)] border-t pt-3">
          {isEmailDraft ? (
            <button
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-[13px] text-foreground transition-colors hover:bg-muted motion-reduce:transition-none"
              data-testid="approval-edit-button"
              onClick={() => {
                setEditError(null);
                setIsEditing((prev) => !prev);
              }}
              type="button"
            >
              {isEditing ? (
                <>
                  <EyeIcon className="size-3.5 shrink-0" />
                  <span>Önizle</span>
                </>
              ) : (
                <>
                  <PencilIcon className="size-3.5 shrink-0" />
                  <span>Düzenle</span>
                </>
              )}
            </button>
          ) : (
            <span />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-[13px] text-foreground transition-colors hover:bg-muted motion-reduce:transition-none"
              data-testid="approval-deny-button"
              onClick={() => {
                setIsEditing(false);
                addToolApprovalResponse({
                  id: approvalId,
                  approved: false,
                  reason: "Declined by owner",
                });
              }}
              type="button"
            >
              Vazgeç
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 font-medium text-[13px] text-primary-foreground transition-colors hover:bg-primary/90 motion-reduce:transition-none"
              data-testid="approval-allow-button"
              onClick={handleSaveOrApprove}
              type="button"
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      )}

      {isDenied && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <XCircleIcon className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>Vazgeçildi — hiçbir taslak kaydedilmedi.</span>
        </div>
      )}

      {isSaving && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>Kaydediliyor…</span>
        </div>
      )}

      {isCompleted && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]",
            isBlockedBoundary || isActionError
              ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          )}
          data-testid="approval-saved-receipt"
        >
          {isBlockedBoundary || isActionError ? (
            <ShieldAlertIcon className="size-4 shrink-0" />
          ) : (
            <CheckCircle2Icon className="size-4 shrink-0" />
          )}
          <span>
            {isBlockedBoundary || isActionError
              ? asString(outputRec.message ?? outputRec.error) ||
                "Taslak kaydedilemedi."
              : isEmailDraft
                ? "Gmail taslağı kaydedildi (gönderilmedi)."
                : toolName === "calendarCreateDraftEvent"
                  ? "Takvim taslak etkinliği kaydedildi."
                  : toolName === "driveCreateDraftDoc"
                    ? "Google Drive taslak belgesi kaydedildi."
                    : "Kaydedildi."}
          </span>
        </div>
      )}

      {input !== undefined && (
        <details
          className="mt-3 rounded-xl border border-[color:var(--hairline)] bg-muted/20 px-3 py-2 text-xs"
          data-testid="approval-technical-details"
        >
          <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
            Teknik ayrıntı
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(
              isEmailDraft
                ? {
                    ...inputRec,
                    recipient: draftTo,
                    subject: draftSubject,
                    body: draftBody,
                  }
                : input,
              null,
              2
            )}
          </pre>
        </details>
      )}
    </section>
  );
}
