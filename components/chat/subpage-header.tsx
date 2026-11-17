"use client";

import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getCopy } from "@/lib/ui-copy";
import { cn } from "@/lib/utils";

const copy = getCopy();

const PREVIEW_TOOLBAR_SELECTORS = [
  "vercel-live-feedback",
  "vercel-toolbar",
  "#__vercel_toolbar",
  "#vercel-toolbar",
  "#vercel-live-feedback",
];

function parkPreviewToolbar(slot: HTMLElement) {
  for (const selector of PREVIEW_TOOLBAR_SELECTORS) {
    const node = document.querySelector(selector);
    if (!(node instanceof HTMLElement) || node.parentElement === slot) {
      continue;
    }
    slot.append(node);
  }
}

const WORKSPACE_SECTIONS = [
  { href: "/usage", label: "Settings" },
  { href: "/teammates", label: "Teammates" },
  { href: "/memory", label: "Memory" },
  { href: "/routines", label: "Routines" },
  { href: "/skills", label: "Skills" },
] as const;

export function SubpageHeader({ badge }: { badge?: React.ReactNode }) {
  const pathname = usePathname();
  const toolbarSlotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = toolbarSlotRef.current;
    if (!slot) {
      return;
    }
    const park = () => parkPreviewToolbar(slot);
    park();
    const observer = new MutationObserver(park);
    observer.observe(document.body, { childList: true });
    observer.observe(document.documentElement, { childList: true });
    return () => observer.disconnect();
  }, []);

  return (
    <header className="space-y-3 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] md:pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Link
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-card pr-4 pl-3 font-medium text-foreground text-sm shadow-[var(--shadow-float)] transition-colors hover:bg-muted"
          href="/"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          <span>{copy.backToChat}</span>
        </Link>

        <div className="flex items-center gap-2">
          {badge}
          <div
            className="flex items-center"
            data-slot="preview-toolbar"
            ref={toolbarSlotRef}
          />
        </div>
      </div>

      <nav
        aria-label="Workspace sections"
        className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 no-scrollbar md:mx-0 md:px-0"
      >
        {WORKSPACE_SECTIONS.map((section) => {
          const active = pathname === section.href;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 font-medium text-[13px] transition-colors",
                active
                  ? "border-transparent bg-foreground text-background"
                  : "border-[color:var(--hairline)] bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              href={section.href}
              key={section.href}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
