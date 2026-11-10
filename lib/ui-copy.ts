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
  searchedWeb: "Searched the web",
  searchingWeb: "Searching the web…",
  searchFailed: "The web search could not be completed.",
  searchNoResults: "No results were found.",
  searchSources: "Sources",
  composerPlaceholder: "Ask …",
  editPlaceholder: "Edit your message…",
  editingMessage: "Editing message",
  cancel: "Cancel",
  send: "Send",
  stop: "Stop",
  attachFile: "Attach a file",
  copy: "Copy",
  edit: "Edit",
  modelMenuHeading: "Choose how the assistant answers",
  modelMenuLabel: "Answer style",
  modelSearchPlaceholder: "Search",
  jumpToLatest: "Jump to latest",
  retryResponse: "Retry response",
  statusThinking: "Thinking…",
  statusReplying: "Replying…",
  statusWorking: "Working on it…",
  statusError: "The reply could not be completed. What arrived is kept.",
  statusInterrupted: "The reply was interrupted. What arrived is kept.",
  interruptedAfterTool:
    "This reply stopped after a tool ran. Send a follow-up to continue without repeating its action.",
  mascot: "Mascot",
  mascotStateIdle: "waiting",
  mascotStateThinking: "thinking",
  mascotStateWorking: "working",
  mascotStateDone: "finished",
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
  searchedWeb: "Web'de arandı",
  searchingWeb: "Web'de aranıyor…",
  searchFailed: "Web araması tamamlanamadı.",
  searchNoResults: "Sonuç bulunamadı.",
  searchSources: "Kaynaklar",
  composerPlaceholder: "Bir şey sor…",
  editPlaceholder: "Mesajını düzenle…",
  editingMessage: "Mesaj düzenleniyor",
  cancel: "Vazgeç",
  send: "Gönder",
  stop: "Durdur",
  attachFile: "Dosya ekle",
  copy: "Kopyala",
  edit: "Düzenle",
  modelMenuHeading: "Asistanın nasıl yanıtlayacağını seç",
  modelMenuLabel: "Yanıt tarzı",
  modelSearchPlaceholder: "Ara",
  jumpToLatest: "Son mesaja git",
  retryResponse: "Yanıtı yeniden dene",
  statusThinking: "Düşünüyor…",
  statusReplying: "Yanıt yazıyor…",
  statusWorking: "Üzerinde çalışıyor…",
  statusError: "Yanıt tamamlanamadı. Gelen kısım korundu.",
  statusInterrupted: "Yanıt yarıda kesildi. Gelen kısım korundu.",
  interruptedAfterTool:
    "Bu yanıt bir araç çalıştıktan sonra durdu. İşlemi tekrarlamadan devam etmek için bir mesaj gönder.",
  mascot: "Maskot",
  mascotStateIdle: "bekliyor",
  mascotStateThinking: "düşünüyor",
  mascotStateWorking: "çalışıyor",
  mascotStateDone: "bitti",
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
