"use client";

import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useUiLocale } from "@/hooks/use-ui-locale";
import { cn } from "@/lib/utils";

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

export function SubpageHeader({ badge }: { badge?: React.ReactNode }) {
  const pathname = usePathname();
  const { copy } = useUiLocale();
  const toolbarSlotRef = useRef<HTMLDivElement>(null);

  const sections = [
    { href: "/usage", label: copy.subpageSettings },
    { href: "/setup", label: copy.subpageSetup },
    { href: "/teammates", label: copy.subpageTeammates },
    { href: "/memory", label: copy.subpageMemory },
    { href: "/routines", label: copy.subpageRoutines },
    { href: "/skills", label: copy.subpageSkills },
  ] as const;

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
    <header className="sticky top-0 z-30 -mx-4 space-y-3 border-[color:var(--hairline)] border-b bg-background/95 px-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.375rem))] pb-2.5 backdrop-blur-md md:mx-0 md:px-0 md:pt-3">
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
        {sections.map((section) => {
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
