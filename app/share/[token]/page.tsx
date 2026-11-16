import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createPostgresPublishedPageStore } from "@/lib/share/published-pages";

async function SharedSnapshotContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const snapshot = await createPostgresPublishedPageStore().resolveByToken({
    token,
  });

  if (!snapshot) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-1.5 border-b border-[color:var(--hairline)] pb-4">
        <div className="inline-flex items-center rounded-full bg-muted px-3 py-1 font-medium text-muted-foreground text-xs">
          Read-Only Published Snapshot
        </div>
        <h1 className="font-semibold text-2xl tracking-tight">
          {snapshot.title}
        </h1>
        <p className="text-muted-foreground text-xs">
          Published {new Date(snapshot.createdAt).toUTCString()} · Expires{" "}
          {new Date(snapshot.expiresAt).toUTCString()}
        </p>
      </header>

      <section className="space-y-3">
        {snapshot.items.map((item, idx) => (
          <article
            className="rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 shadow-[var(--shadow-card)]"
            key={`${snapshot.id}-${idx}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-base">{item.title}</h2>
              <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] uppercase">
                {item.kind}
              </span>
            </div>
            {item.subtitle && (
              <p className="mt-1 text-muted-foreground text-xs">
                {item.subtitle}
              </p>
            )}
            {item.bodyText && (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 font-sans text-sm leading-relaxed">
                {item.bodyText}
              </pre>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export default function SharedPageSnapshot({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <main className="min-h-dvh w-full bg-background px-4 py-8 text-foreground">
      <Suspense
        fallback={
          <div className="mx-auto max-w-2xl text-muted-foreground text-sm">
            Loading snapshot…
          </div>
        }
      >
        <SharedSnapshotContent params={params} />
      </Suspense>
    </main>
  );
}
