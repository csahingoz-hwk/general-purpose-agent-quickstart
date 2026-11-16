"use client";

import { CopyIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import type { SkillItem } from "@/lib/skills/library";
import { getCopy } from "@/lib/ui-copy";
import { fetcher } from "@/lib/utils";

const copy = getCopy();

export default function SkillsPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, mutate } = useSWR<{ skills: SkillItem[] }>(
    `${basePath}/api/skills`,
    fetcher
  );

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`${basePath}/api/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, description, instructions }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save skill");
      }
      setSlug("");
      setName("");
      setDescription("");
      setInstructions("");
      await mutate();
      toast({ type: "success", description: "Skill saved to library." });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "Could not save skill",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(targetSlug: string) {
    const response = await fetch(
      `${basePath}/api/skills?slug=${encodeURIComponent(targetSlug)}`,
      { method: "DELETE" }
    );
    if (response.ok) {
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
            Invoke in chat via <code>@skill:&lt;slug&gt;</code>
          </span>
        </div>

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Skills library
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Reusable domain playbooks injected only on turns where you invoke{" "}
            <code>@skill:&lt;slug&gt;</code>, keeping everyday chat lean.
          </p>
        </div>

        <div className="space-y-3">
          {(data?.skills ?? []).map((skill) => (
            <article
              className="space-y-2 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
              key={skill.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SparklesIcon className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold text-[15px]">{skill.name}</h2>
                  <code className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs">
                    @skill:{skill.slug}
                  </code>
                  {skill.builtIn && (
                    <span className="rounded-full border border-[color:var(--hairline)] px-2 py-0.5 text-muted-foreground text-xs">
                      Built-in
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-3.5 text-xs hover:bg-muted"
                    onClick={() => {
                      navigator.clipboard?.writeText(`@skill:${skill.slug} `);
                      toast({
                        type: "success",
                        description: `Copied @skill:${skill.slug}`,
                      });
                    }}
                    type="button"
                  >
                    <CopyIcon className="size-3.5" />
                    Copy trigger
                  </button>
                  {!skill.builtIn && (
                    <button
                      aria-label={`Delete ${skill.name}`}
                      className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDelete(skill.slug)}
                      type="button"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[14px] text-muted-foreground">
                {skill.description}
              </p>
              <details className="rounded-xl border border-[color:var(--hairline)] bg-muted/30 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  View instructions
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-foreground">
                  {skill.instructions}
                </p>
              </details>
            </article>
          ))}
        </div>

        <form
          className="space-y-3 rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
          onSubmit={handleSave}
        >
          <h2 className="font-semibold text-[15px]">Add custom skill</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="min-h-11 rounded-xl border border-[color:var(--hairline)] bg-background px-3 font-mono text-[16px]"
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slug (e.g. sap-reconciliation)"
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
          <input
            className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px]"
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line summary"
            required
            value={description}
          />
          <textarea
            className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px]"
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Playbook instructions injected when /skill:<slug> is invoked…"
            required
            value={instructions}
          />
          <div className="flex justify-end">
            <button
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              <PlusIcon className="size-4" />
              Save custom skill
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
