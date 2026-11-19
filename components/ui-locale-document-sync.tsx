"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useUiLocale } from "@/hooks/use-ui-locale";
import { getCopy, type UiLocale, uiCopy } from "@/lib/ui-copy";

const MANAGED_PAGE_TITLES = new Set([
  "",
  uiCopy.en.pageTitle,
  uiCopy.tr.pageTitle,
]);

/**
 * Keeps `<html lang>` and `document.title` aligned with the resolved UI locale.
 * Writes only when the target value actually differs from the current DOM value
 * and never clobbers custom non-default page titles.
 */
export function syncDocumentLocale(locale: UiLocale): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  if (document.documentElement && document.documentElement.lang !== locale) {
    document.documentElement.lang = locale;
  }
  const copy = getCopy(locale);
  const currentTitle = document.title.trim();
  if (
    MANAGED_PAGE_TITLES.has(currentTitle) &&
    currentTitle !== copy.pageTitle
  ) {
    document.title = copy.pageTitle;
    return true;
  }
  return false;
}

/**
 * Observes ONLY the document's `<head> <title>` element (never all of
 * `document.head`) so late Next.js metadata commits on hydration or reload
 * (e.g. resetting `"Asistan"` back to `"Assistant"`) are corrected once
 * without looping.
 */
export function observeDocumentTitleLocale(locale: UiLocale): () => void {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return () => undefined;
  }
  const titleElement = document.head?.querySelector("title") ?? null;
  if (!titleElement) {
    return () => undefined;
  }
  const observer = new MutationObserver(() => {
    if (syncDocumentLocale(locale)) {
      observer.takeRecords();
    }
  });
  observer.observe(titleElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}

/**
 * Mounted once in `AppProviders` so document title and `<html lang>` are synced
 * from a single place after locale resolution, with at most one `<title>`-only
 * MutationObserver.
 */
export function UiLocaleDocumentSync() {
  const { locale, resolved } = useUiLocale();
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync document title after client-side route transitions
  useEffect(() => {
    if (!resolved) {
      return;
    }
    syncDocumentLocale(locale);
    return observeDocumentTitleLocale(locale);
  }, [locale, pathname, resolved]);

  return null;
}
