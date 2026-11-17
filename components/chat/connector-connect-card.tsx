"use client";

import {
  CalendarIcon,
  FolderIcon,
  GitPullRequestIcon,
  MailIcon,
} from "lucide-react";
import {
  connectGithubAccount,
  connectGoogleWorkspace,
} from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

export function isSetupRequiredOutput(output: unknown): output is {
  status: "setup_required";
  message?: string;
  connectProvider?: "google" | "github";
} {
  return (
    Boolean(output) &&
    typeof output === "object" &&
    (output as { status?: string }).status === "setup_required"
  );
}

export function ConnectorConnectCard({
  provider,
  chatId,
  locale = "en",
}: {
  provider: "google" | "github";
  chatId: string;
  locale?: "en" | "tr";
}) {
  const isGoogle = provider === "google";
  const returnTo = chatId ? `/chat/${chatId}` : "/setup";

  const title = isGoogle
    ? locale === "tr"
      ? "Google hesabınız henüz bağlı değil"
      : "Google isn't connected yet"
    : locale === "tr"
      ? "GitHub hesabınız henüz bağlı değil"
      : "GitHub isn't connected yet";

  const subtitle = isGoogle
    ? locale === "tr"
      ? "Gmail, Takvim ve Drive'ı tek dokunuşla bağlayın."
      : "Tap once to connect Gmail, Calendar & Drive."
    : locale === "tr"
      ? "Pull request'leri okumak için tek dokunuşla bağlayın."
      : "Tap once to connect your GitHub repositories.";

  const cta = isGoogle
    ? locale === "tr"
      ? "Google'ı Bağla"
      : "Connect Google"
    : locale === "tr"
      ? "GitHub'ı Bağla"
      : "Connect GitHub";

  return (
    <div
      className="flex w-[min(100%,440px)] flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--hairline)] bg-card px-4 py-3.5 text-sm shadow-2xs"
      data-provider={provider}
      data-testid="connector-connect-card"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2.5 shrink-0 rounded-full bg-amber-500"
        />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-muted-foreground text-xs">{subtitle}</p>
        </div>
      </div>

      <form
        action={isGoogle ? connectGoogleWorkspace : connectGithubAccount}
        className="shrink-0"
      >
        <input name="returnTo" type="hidden" value={returnTo} />
        <button
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
          data-testid={`connect-${provider}-button`}
          type="submit"
        >
          {cta}
        </button>
      </form>
    </div>
  );
}

function stripFence(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/<untrusted_content[^>]*>/gi, "")
    .replace(/<\/untrusted_content>/gi, "")
    .trim();
}

export function ConnectorSummaryCard({
  toolName,
  output,
  locale = "en",
}: {
  toolName: string;
  output: Record<string, unknown>;
  locale?: "en" | "tr";
}) {
  if (toolName === "gmailReadMessages" && Array.isArray(output.messages)) {
    const items = output.messages as Record<string, unknown>[];
    return (
      <div
        className="w-[min(100%,450px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
        data-testid="connector-summary-gmail"
      >
        <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs">
          <MailIcon className="size-3.5" />
          <span>
            {locale === "tr"
              ? `Gmail · ${items.length} ileti`
              : `Gmail · ${items.length} message${items.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {locale === "tr" ? "Eşleşen e-posta yok." : "No matching emails."}
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {items.slice(0, 5).map((m, idx) => (
              <li
                className="py-2 first:pt-0 last:pb-0"
                key={String(m.id ?? idx)}
              >
                <p className="truncate font-medium text-foreground text-xs">
                  {stripFence(m.subject) || "(No subject)"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {stripFence(m.from)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (toolName === "calendarReadEvents" && Array.isArray(output.events)) {
    const events = output.events as Record<string, unknown>[];
    return (
      <div
        className="w-[min(100%,450px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
        data-testid="connector-summary-calendar"
      >
        <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs">
          <CalendarIcon className="size-3.5" />
          <span>
            {locale === "tr"
              ? `Takvim · ${events.length} etkinlik`
              : `Calendar · ${events.length} event${events.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {locale === "tr" ? "Yaklaşan etkinlik yok." : "No upcoming events."}
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {events.slice(0, 5).map((e, idx) => (
              <li
                className="py-2 first:pt-0 last:pb-0"
                key={String(e.id ?? idx)}
              >
                <p className="truncate font-medium text-foreground text-xs">
                  {stripFence(e.summary) || "(Untitled event)"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {String(e.start ?? "")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (toolName === "driveReadFiles" && Array.isArray(output.files)) {
    const files = output.files as Record<string, unknown>[];
    return (
      <div
        className="w-[min(100%,450px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
        data-testid="connector-summary-drive"
      >
        <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs">
          <FolderIcon className="size-3.5" />
          <span>
            {locale === "tr"
              ? `Google Drive · ${files.length} dosya`
              : `Google Drive · ${files.length} file${files.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {files.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {locale === "tr" ? "Eşleşen dosya yok." : "No matching files."}
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {files.slice(0, 5).map((f, idx) => (
              <li
                className="py-2 first:pt-0 last:pb-0"
                key={String(f.id ?? idx)}
              >
                <p
                  className={cn("truncate font-medium text-foreground text-xs")}
                >
                  {stripFence(f.name) || "Document"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (
    toolName === "githubReadPullRequests" &&
    Array.isArray(output.pullRequests)
  ) {
    const prs = output.pullRequests as Record<string, unknown>[];
    return (
      <div
        className="w-[min(100%,450px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
        data-testid="connector-summary-github"
      >
        <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs">
          <GitPullRequestIcon className="size-3.5" />
          <span>
            {locale === "tr"
              ? `GitHub · ${prs.length} açık PR`
              : `GitHub · ${prs.length} open PR${prs.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {prs.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {locale === "tr" ? "Açık PR bulunamadı." : "No open pull requests."}
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {prs.slice(0, 5).map((pr, idx) => (
              <li
                className="py-2 first:pt-0 last:pb-0"
                key={String(pr.number ?? idx)}
              >
                <p className="truncate font-medium text-foreground text-xs">
                  #{String(pr.number ?? "")} {stripFence(pr.title)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return null;
}
