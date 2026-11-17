"use client";

import { CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { AgentMascot } from "@/components/chat/agent-mascot";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import type { BotTeammate } from "@/lib/bots/roster";
import {
  AGENT_MASCOTS,
  MASCOT_STORAGE_KEY,
  type MascotVariant,
} from "@/lib/mascot";
import { cn, fetcher } from "@/lib/utils";

const ACTIVE_BOT_STORAGE_KEY = "assistant-active-bot";

export default function TeammatesPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [activeSlug, setActiveSlug] = useState<string>("chief-of-staff");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [soul, setSoul] = useState("");
  const [defaultModel, setDefaultModel] = useState<
    "gpt-6-luna" | "gpt-6.1-terra"
  >("gpt-6-luna");
  const [mascotVariant, setMascotVariant] = useState<MascotVariant>("teal");
  const [saving, setSaving] = useState(false);

  const { data, mutate } = useSWR<{ bots: BotTeammate[] }>(
    `${basePath}/api/bots`,
    fetcher
  );

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ACTIVE_BOT_STORAGE_KEY);
      if (saved) {
        setActiveSlug(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function activateBot(bot: BotTeammate) {
    setActiveSlug(bot.slug);
    try {
      window.localStorage.setItem(ACTIVE_BOT_STORAGE_KEY, bot.slug);
      window.localStorage.setItem(
        "assistant-active-bot-name",
        bot.slug === "chief-of-staff" ? "" : bot.name
      );
      window.localStorage.setItem(MASCOT_STORAGE_KEY, bot.mascotVariant);
      document.documentElement.dataset.botTheme = bot.mascotVariant;
      const maxAge = 60 * 60 * 24 * 365;
      // biome-ignore lint/suspicious/noDocumentCookie: sync active teammate default model cookie
      document.cookie = `chat-model=${encodeURIComponent(bot.defaultModel)}; path=/; max-age=${maxAge}`;
      window.dispatchEvent(
        new CustomEvent("assistant-mascot-change", {
          detail: bot.mascotVariant,
        })
      );
      window.dispatchEvent(
        new CustomEvent("assistant-bot-change", {
          detail: { slug: bot.slug, name: bot.name },
        })
      );
    } catch {
      /* ignore */
    }
    toast({
      type: "success",
      description: `Switched to ${bot.name}.`,
    });
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          description,
          soul,
          defaultModel,
          mascotVariant,
          skillSlugs: [],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save teammate");
      }
      setSlug("");
      setName("");
      setDescription("");
      setSoul("");
      await mutate();
      toast({ type: "success", description: "Teammate saved." });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not save teammate",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(targetSlug: string) {
    const res = await fetch(
      `${basePath}/api/bots?slug=${encodeURIComponent(targetSlug)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      await mutate();
    }
  }

  return (
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader />

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Teammates</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Choose a specialist persona and mascot theme for chat, or mention{" "}
            <code className="font-mono text-xs">@bot:name</code> inline on any
            turn.
          </p>
        </div>

        {(data?.bots ?? []).length > 0 && (
          <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
            {(data?.bots ?? []).map((bot) => {
              const isActive = bot.slug === activeSlug;
              return (
                <article
                  className="flex items-start justify-between gap-3.5 p-4"
                  key={bot.slug}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <AgentMascot
                      className="mt-0.5 shrink-0 rounded-full"
                      size={40}
                      state="idle"
                      variant={bot.mascotVariant}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-[15px] text-foreground">
                          {bot.name}
                        </h2>
                        <code className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs">
                          @bot:{bot.slug}
                        </code>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {bot.description}
                      </p>
                      {bot.skillSlugs.length > 0 && (
                        <p className="text-muted-foreground text-xs">
                          Playbooks:{" "}
                          {bot.skillSlugs.map((s) => `@skill:${s}`).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 font-medium text-xs transition-colors",
                        isActive
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-[color:var(--hairline)] bg-background text-foreground hover:bg-muted"
                      )}
                      onClick={() => activateBot(bot)}
                      type="button"
                    >
                      {isActive && <CheckIcon className="size-3.5" />}
                      {isActive ? "Active" : "Use"}
                    </button>
                    {!bot.builtIn && (
                      <button
                        aria-label={`Delete ${bot.name}`}
                        className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleDelete(bot.slug)}
                        type="button"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <form
          className="space-y-4 rounded-2xl border border-[color:var(--hairline)] bg-card p-4"
          onSubmit={handleSave}
        >
          <h2 className="font-semibold text-[15px]">New custom teammate</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground text-xs">
                Short identifier
              </span>
              <input
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. tax-reviewer"
                required
                value={slug}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground text-xs">
                Display name
              </span>
              <input
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tax Reviewer"
                required
                value={name}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground text-xs">
                Answer style
              </span>
              <select
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                onChange={(e) =>
                  setDefaultModel(
                    e.target.value as "gpt-6-luna" | "gpt-6.1-terra"
                  )
                }
                value={defaultModel}
              >
                <option value="gpt-6-luna">Everyday chat</option>
                <option value="gpt-6.1-terra">Detailed chat</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground text-xs">Mascot</span>
              <select
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                onChange={(e) =>
                  setMascotVariant(e.target.value as MascotVariant)
                }
                value={mascotVariant}
              >
                {AGENT_MASCOTS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground text-xs">
              Role summary (optional)
            </span>
            <input
              className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this teammate's focus"
              value={description}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground text-xs">
              Persona instructions
            </span>
            <textarea
              className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px] text-foreground"
              onChange={(e) => setSoul(e.target.value)}
              placeholder="How this teammate should think, structure answers, and communicate…"
              required
              value={soul}
            />
          </label>
          <div className="flex justify-end">
            <button
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              <PlusIcon className="size-4" />
              {saving ? "Saving…" : "Save teammate"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
