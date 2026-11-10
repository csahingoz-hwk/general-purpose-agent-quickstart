/**
 * Typed EN/TR-ready UI copy. Only strings introduced or changed by the
 * personal-assistant shell live here; there is intentionally no language
 * switcher or provider yet (planned for a later session).
 *
 * The four `suggestions` are sent verbatim to the model as the user message,
 * so the English strings must not be reworded casually.
 */
const en = {
  assistant: "Assistant",
  history: "History",
  newChat: "New chat",
  private: "Private",
  sharedLink: "Shared link",
  greetingTitle: "How can I help today?",
  greetingSubtitle:
    "Plan your day, get something explained, or check the weather.",
  suggestions: [
    "Help me plan my day",
    "Explain this clearly",
    "Check the weather",
    "Explore a fictional inbox",
  ],
  usageAndSettings: "Usage & settings",
  backToChat: "Back to chat",
  deleteAllChats: "Delete all chats…",
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly [string, string, string, string]
    ? readonly [string, string, string, string]
    : T;

export type UiCopy = { [K in keyof typeof en]: Widen<(typeof en)[K]> };

const tr: UiCopy = {
  assistant: "Asistan",
  history: "Geçmiş",
  newChat: "Yeni sohbet",
  private: "Özel",
  sharedLink: "Paylaşılan bağlantı",
  greetingTitle: "Bugün sana nasıl yardımcı olabilirim?",
  greetingSubtitle:
    "Gününü planla, bir konuyu açık biçimde anlattır ya da hava durumuna bak.",
  suggestions: [
    "Gününü planlamama yardım et",
    "Bunu açıkça anlat",
    "Hava durumuna bak",
    "Hayalî bir gelen kutusunu keşfet",
  ],
  usageAndSettings: "Kullanım ve ayarlar",
  backToChat: "Sohbete dön",
  deleteAllChats: "Tüm sohbetleri sil…",
};

export const uiCopy: { readonly en: UiCopy; readonly tr: UiCopy } = {
  en,
  tr,
};

export type UiLocale = keyof typeof uiCopy;

export const DEFAULT_UI_LOCALE: UiLocale = "en";

export function getCopy(locale: UiLocale = DEFAULT_UI_LOCALE): UiCopy {
  return uiCopy[locale];
}
