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
 * Mounted once in `AppProviders` so document title and `<html lang>` are synced
 * from a single place after locale resolution, with zero MutationObservers.
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
  }, [locale, pathname, resolved]);

  return null;
}
