"use client";

import { BotIcon, CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import type { BotTeammate } from "@/lib/bots/roster";
import {
  AGENT_MASCOTS,
  MASCOT_STORAGE_KEY,
  type MascotVariant,
} from "@/lib/mascot";
import { getCopy } from "@/lib/ui-copy";
import { fetcher } from "@/lib/utils";

const ACTIVE_BOT_STORAGE_KEY = "assistant-active-bot";
const copy = getCopy();

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
      window.localStorage.setItem(MASCOT_STORAGE_KEY, bot.mascotVariant);
      document.documentElement.dataset.botTheme = bot.mascotVariant;
      window.dispatchEvent(
        new CustomEvent("assistant-mascot-change", {
          detail: bot.mascotVariant,
        })
      );
    } catch {
      /* ignore */
    }
    toast({
      type: "success",
      description: `Switched active teammate to ${bot.name} (${bot.mascotVariant} theme).`,
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
      toast({ type: "success", description: "Specialist teammate saved." });
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
            Invoke inline via <code>@bot:&lt;slug&gt;</code>
          </span>
        </div>

        <header className="space-y-1">
          <h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
            <BotIcon className="size-6" />
            Teammates Roster
          </h1>
          <p className="text-muted-foreground text-sm">
            Switch between specialist assistant personas, mascot themes, and
            default skill playbooks while sharing core profile facts.
          </p>
        </header>

        <section className="space-y-3">
          {(data?.bots ?? []).map((bot) => {
            const isActive = bot.slug === activeSlug;
            return (
              <div
                className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
                key={bot.slug}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-base">{bot.name}</h2>
                      <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                        @bot:{bot.slug}
                      </code>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground text-xs">
                        {bot.mascotVariant} · {bot.defaultModel}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {bot.description}
                    </p>
                    {bot.skillSlugs.length > 0 && (
                      <p className="text-muted-foreground text-xs">
                        Default skills:{" "}
                        {bot.skillSlugs.map((s) => `@skill:${s}`).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-xs hover:bg-muted"
                      onClick={() => activateBot(bot)}
                      type="button"
                    >
                      {isActive && <CheckIcon className="size-3.5" />}
                      {isActive ? "Active" : "Activate"}
                    </button>
                    {!bot.builtIn && (
                      <button
                        aria-label={`Delete ${bot.name}`}
                        className="inline-flex size-11 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(bot.slug)}
                        type="button"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <form
          className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-5 shadow-[var(--shadow-card)]"
          onSubmit={handleSave}
        >
          <h2 className="flex items-center gap-2 font-semibold text-base">
            <PlusIcon className="size-4" />
            Add Custom Teammate
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slug (e.g. tax-reviewer)"
              required
              value={slug}
            />
            <input
              className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              required
              value={name}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
              onChange={(e) =>
                setDefaultModel(
                  e.target.value as "gpt-6-luna" | "gpt-6.1-terra"
                )
              }
              value={defaultModel}
            >
              <option value="gpt-6-luna">Everyday chat (GPT-6 Luna)</option>
              <option value="gpt-6.1-terra">
                Detailed chat (GPT-6.1 Terra)
              </option>
            </select>
            <select
              className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
              onChange={(e) =>
                setMascotVariant(e.target.value as MascotVariant)
              }
              value={mascotVariant}
            >
              {AGENT_MASCOTS.map((m) => (
                <option key={m.id} value={m.id}>
                  Mascot: {m.label}
                </option>
              ))}
            </select>
          </div>
          <input
            className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short role summary"
            value={description}
          />
          <textarea
            className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px]"
            onChange={(e) => setSoul(e.target.value)}
            placeholder="Teammate soul / domain instructions…"
            required
            value={soul}
          />
          <button
            className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 font-medium text-background text-sm disabled:opacity-50"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving…" : "Save Teammate"}
          </button>
        </form>
      </div>
    </main>
  );
}
