"use client";

import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import type { SkillItem } from "@/lib/skills/library";
import { fetcher } from "@/lib/utils";

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
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader />

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Skills library
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Reusable playbooks loaded only when you include{" "}
            <code className="font-mono text-xs">@skill:name</code> in a message,
            keeping everyday chat fast and lean.
          </p>
        </div>

        {(data?.skills ?? []).length > 0 && (
          <div className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card">
            {(data?.skills ?? []).map((skill) => (
              <article className="space-y-2.5 p-4" key={skill.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
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
                      Copy
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
                <details className="pt-0.5 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Show instructions
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-foreground">
                    {skill.instructions}
                  </p>
                </details>
              </article>
            ))}
          </div>
        )}

        <form
          className="space-y-4 rounded-2xl border border-[color:var(--hairline)] bg-card p-4"
          onSubmit={handleSave}
        >
          <h2 className="font-semibold text-[15px]">New custom skill</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground text-xs">
                Short identifier
              </span>
              <input
                className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. close-checklist"
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
                placeholder="e.g. Close Checklist"
                required
                value={name}
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground text-xs">Summary</span>
            <input
              className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary of when to use this playbook"
              required
              value={description}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground text-xs">Instructions</span>
            <textarea
              className="min-h-24 w-full rounded-xl border border-[color:var(--hairline)] bg-background p-3 text-[16px] text-foreground"
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Step-by-step guidance applied when @skill:name is used…"
              required
              value={instructions}
            />
          </label>
          <div className="flex justify-end">
            <button
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              <PlusIcon className="size-4" />
              Save skill
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
