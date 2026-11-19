"use client";

import { useCallback, useEffect, useState } from "react";
import { textLocale } from "@/lib/fixtures";
import { getCopy, type UiCopy, type UiLocale } from "@/lib/ui-copy";

export type UiLocalePreference = "auto" | UiLocale;

const STORAGE_KEY = "assistant-ui-locale";
const CHANGE_EVENT = "assistant-ui-locale-change";

export type BrowserLocaleSignals = {
  language?: string | null;
  languages?: readonly string[] | null;
  timeZone?: string | null;
  userHintText?: string | null;
};

/**
 * Resolves the automatic UI language (`"tr"` vs `"en"`):
 * - Picks `"tr"` when `navigator.language` OR any preferred entry in
 *   `navigator.languages` is Turkish (`tr`, `tr-TR`, `tr-CY`), OR when the
 *   device timezone is `Europe/Istanbul`, OR when `userHintText` is Turkish.
 */
export function resolveAutoUiLocale(signals: BrowserLocaleSignals): UiLocale {
  const candidates: string[] = [];
  if (signals.language) {
    candidates.push(signals.language);
  }
  if (Array.isArray(signals.languages)) {
    for (const item of signals.languages) {
      if (typeof item === "string" && item.trim()) {
        candidates.push(item);
      }
    }
  }
  for (const tag of candidates) {
    const lower = tag.trim().toLowerCase();
    if (lower === "tr" || lower.startsWith("tr-") || lower.startsWith("tr_")) {
      return "tr";
    }
  }
  if (signals.timeZone?.trim() === "Europe/Istanbul") {
    return "tr";
  }
  if (
    signals.userHintText?.trim() &&
    textLocale(signals.userHintText) === "tr"
  ) {
    return "tr";
  }
  return "en";
}

export function detectBrowserLocale(): UiLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }
  return resolveAutoUiLocale({
    language: navigator.language,
    languages: navigator.languages,
    timeZone,
  });
}

export function readStoredLocalePreference(): UiLocalePreference {
  if (typeof window === "undefined") {
    return "auto";
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "tr" || raw === "auto") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "auto";
}

let serverSyncedOnce = false;

export function useUiLocale(fallbackLocale?: UiLocale): {
  preference: UiLocalePreference;
  locale: UiLocale;
  copy: UiCopy;
  setLocalePreference: (next: UiLocalePreference) => void;
} {
  const [preference, setPreference] = useState<UiLocalePreference>("auto");
  const [browserLocale, setBrowserLocale] = useState<UiLocale>("en");

  useEffect(() => {
    const stored = readStoredLocalePreference();
    setPreference(stored);
    setBrowserLocale(detectBrowserLocale());

    if (!serverSyncedOnce) {
      serverSyncedOnce = true;
      let hasExplicitLocal = false;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        hasExplicitLocal = raw === "en" || raw === "tr";
      } catch {
        hasExplicitLocal = false;
      }
      if (!hasExplicitLocal) {
        const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        fetch(`${basePath}/api/settings/approvals`, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { uiLocale?: string } | null) => {
            const remote = data?.uiLocale;
            if (remote === "tr" || remote === "en") {
              try {
                if (!window.localStorage.getItem(STORAGE_KEY)) {
                  window.localStorage.setItem(STORAGE_KEY, remote);
                  window.dispatchEvent(new Event(CHANGE_EVENT));
                }
              } catch {
                setPreference(remote);
              }
            }
          })
          .catch(() => null);
      }
    }

    const onUpdate = () => {
      setPreference(readStoredLocalePreference());
      setBrowserLocale(detectBrowserLocale());
    };
    window.addEventListener(CHANGE_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const setLocalePreference = useCallback((next: UiLocalePreference) => {
    setPreference(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      /* ignore */
    }
  }, []);

  const locale: UiLocale =
    preference === "auto"
      ? browserLocale === "tr"
        ? "tr"
        : (fallbackLocale ?? browserLocale)
      : preference;

  const copy = getCopy(locale);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
    const syncTitle = () => {
      const currentTitle = document.title.trim();
      if (
        !currentTitle ||
        (locale === "tr" && currentTitle === "Assistant") ||
        (locale === "en" && currentTitle === "Asistan")
      ) {
        document.title = copy.pageTitle;
      }
    };
    syncTitle();
    const observer = new MutationObserver(syncTitle);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [locale, copy.pageTitle]);

  return {
    preference,
    locale,
    copy,
    setLocalePreference,
  };
}
