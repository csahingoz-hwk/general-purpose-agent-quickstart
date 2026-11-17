"use client";

import { ExternalLinkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  connectGithubAccount,
  connectGoogleWorkspace,
} from "@/app/(auth)/actions";
import type { SetupChecklistItem } from "@/app/api/setup-status/route";
import { SubpageHeader } from "@/components/chat/subpage-header";
import { toast } from "@/components/chat/toast";
import { cn, fetcher } from "@/lib/utils";

type SetupStatusResponse = {
  items: SetupChecklistItem[];
  googleConnected: boolean;
  githubConnected: boolean;
  googleSignInReady: boolean;
  githubOAuthReady: boolean;
  vaultReady: boolean;
};

type VaultItem = {
  id: string;
  name: string;
  provider: string;
  keyHint: string;
  updatedAt: string;
};

type VaultResponse = {
  status: "ready" | "key_missing" | "setup_required";
  secrets: VaultItem[];
};

const ADVANCED_PRESET_NAMES: Record<string, string> = {
  github: "GITHUB_CONNECTOR_PAT",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_VOICE_API_KEY",
  google: "GOOGLE_CONNECTOR_ACCESS_TOKEN",
};

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
      <SetupPageContent />
    </Suspense>
  );
}

function SetupPageContent() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const searchParams = useSearchParams();
  const { mutate: globalMutate } = useSWRConfig();

  const [provider, setProvider] = useState("github");
  const [customName, setCustomName] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, mutate } = useSWR<SetupStatusResponse>(
    `${basePath}/api/setup-status`,
    fetcher
  );
  const { data: vaultData, mutate: mutateVault } = useSWR<VaultResponse>(
    `${basePath}/api/vault`,
    fetcher
  );

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected === "google") {
      toast({
        type: "success",
        description: "Google Gmail, Calendar & Drive connected.",
      });
    } else if (connected === "github") {
      toast({ type: "success", description: "GitHub connected." });
    }
  }, [searchParams]);

  async function handleDisconnect(target: "google" | "github") {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/connectors?provider=${target}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await Promise.all([
          mutate(),
          mutateVault(),
          globalMutate(`${basePath}/api/connectors`),
        ]);
        toast({
          type: "success",
          description:
            target === "google"
              ? "Disconnected Google."
              : "Disconnected GitHub.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAdvanced(event: React.FormEvent) {
    event.preventDefault();
    const resolvedName =
      provider === "custom"
        ? customName.trim()
        : (ADVANCED_PRESET_NAMES[provider] ?? "");
    if (!resolvedName || !plaintext.trim()) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: resolvedName,
          provider,
          plaintext: plaintext.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save key");
      }
      setPlaintext("");
      setCustomName("");
      await Promise.all([
        mutate(),
        mutateVault(),
        globalMutate(`${basePath}/api/connectors`),
        globalMutate(`${basePath}/api/voice/transcribe`),
      ]);
      toast({ type: "success", description: "Saved securely." });
    } catch (err) {
      toast({
        type: "error",
        description: err instanceof Error ? err.message : "Could not save key",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSecret(name: string) {
    const res = await fetch(
      `${basePath}/api/vault?name=${encodeURIComponent(name)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      await Promise.all([
        mutate(),
        mutateVault(),
        globalMutate(`${basePath}/api/connectors`),
      ]);
    }
  }

  return (
    <main className="h-dvh w-full overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-6 md:pb-10">
        <SubpageHeader />

        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Setup checklist
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Core chat, voice, search, and images run automatically. Connect
            personal apps below when you want draft assistance.
          </p>
        </div>

        <ul className="divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-card text-sm">
          {(data?.items ?? []).map((item) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              key={item.id}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2.5 shrink-0 rounded-full",
                    item.status === "ready"
                      ? "bg-emerald-500"
                      : item.status === "action_needed"
                        ? "bg-amber-500"
                        : "bg-muted-foreground/45"
                  )}
                />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.summary}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {item.connectedProvider ? (
                  <button
                    className="min-h-10 rounded-full border border-[color:var(--hairline)] px-3.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                    disabled={busy}
                    onClick={() =>
                      item.connectedProvider &&
                      handleDisconnect(item.connectedProvider)
                    }
                    type="button"
                  >
                    Disconnect
                  </button>
                ) : item.actionKind === "connect_google" ? (
                  <form action={connectGoogleWorkspace}>
                    <input
                      name="returnTo"
                      type="hidden"
                      value="/setup?connected=google"
                    />
                    <button
                      className="inline-flex min-h-10 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                      type="submit"
                    >
                      Connect
                    </button>
                  </form>
                ) : item.actionKind === "connect_github" ? (
                  <form action={connectGithubAccount}>
                    <input
                      name="returnTo"
                      type="hidden"
                      value="/setup?connected=github"
                    />
                    <button
                      className="inline-flex min-h-10 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                      type="submit"
                    >
                      Connect
                    </button>
                  </form>
                ) : item.actionKind === "external_link" && item.externalUrl ? (
                  <a
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                    href={item.externalUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.externalLabel ?? "Open"}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-muted-foreground text-xs">Ready</span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <details className="rounded-2xl border border-[color:var(--hairline)] bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 font-medium text-muted-foreground text-xs hover:text-foreground">
            <span>Advanced</span>
            <span>Paste key manually</span>
          </summary>

          <div className="space-y-4 border-[color:var(--hairline)] border-t p-4">
            <form className="space-y-3" onSubmit={handleSaveAdvanced}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground text-xs">Service</span>
                  <select
                    className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                    onChange={(e) => setProvider(e.target.value)}
                    value={provider}
                  >
                    <option value="github">GitHub token</option>
                    <option value="gemini">Google AI Studio (Veo video)</option>
                    <option value="openai">OpenAI voice</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>

                {provider === "custom" && (
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground text-xs">Name</span>
                    <input
                      className="min-h-11 w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="CUSTOM_KEY_NAME"
                      required
                      value={customName}
                    />
                  </label>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  autoComplete="off"
                  className="min-h-11 flex-1 rounded-xl border border-[color:var(--hairline)] bg-background px-3 text-[16px] text-foreground"
                  onChange={(e) => setPlaintext(e.target.value)}
                  placeholder="Paste token or key"
                  required
                  type="password"
                  value={plaintext}
                />
                <button
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs disabled:opacity-50"
                  disabled={busy || vaultData?.status !== "ready"}
                  type="submit"
                >
                  <PlusIcon className="size-4" />
                  Save
                </button>
              </div>
            </form>

            {(vaultData?.secrets ?? []).length > 0 && (
              <div className="divide-y divide-[color:var(--hairline)] rounded-xl border border-[color:var(--hairline)]">
                {vaultData?.secrets.map((secret) => (
                  <div
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    key={secret.id}
                  >
                    <div>
                      <span className="font-medium text-foreground">
                        {secret.provider}
                      </span>{" "}
                      <span className="font-mono text-muted-foreground">
                        ({secret.keyHint})
                      </span>
                    </div>
                    <button
                      aria-label={`Remove ${secret.name}`}
                      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteSecret(secret.name)}
                      type="button"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </main>
  );
}
