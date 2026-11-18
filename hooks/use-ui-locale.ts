"use client";

import { useCallback, useEffect, useState } from "react";
import { getCopy, type UiCopy, type UiLocale } from "@/lib/ui-copy";

export type UiLocalePreference = "auto" | UiLocale;

const STORAGE_KEY = "assistant-ui-locale";
const CHANGE_EVENT = "assistant-ui-locale-change";

function detectBrowserLocale(): UiLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("tr") ? "tr" : "en";
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

export function useUiLocale(fallbackLocale?: UiLocale): {
  preference: UiLocalePreference;
  locale: UiLocale;
  copy: UiCopy;
  setLocalePreference: (next: UiLocalePreference) => void;
} {
  const [preference, setPreference] = useState<UiLocalePreference>("auto");
  const [browserLocale, setBrowserLocale] = useState<UiLocale>("en");

  useEffect(() => {
    setPreference(readStoredLocalePreference());
    setBrowserLocale(detectBrowserLocale());

    const onUpdate = () => {
      setPreference(readStoredLocalePreference());
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
    preference === "auto" ? (fallbackLocale ?? browserLocale) : preference;

  return {
    preference,
    locale,
    copy: getCopy(locale),
    setLocalePreference,
  };
}
