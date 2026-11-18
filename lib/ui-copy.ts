/**
 * Typed EN/TR UI dictionary for the personal-assistant shell, approval cards,
 * settings, long-chat summaries, cloud computer screen handoff, and routines.
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
  routinesAndTasks: "Routines & tasks",
  memory: "Memory",
  skillsLibrary: "Skills library",
  teammatesRoster: "Teammates",
  setupChecklist: "Setup checklist",
  signOut: "Sign out",
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
  preview: "Preview",
  save: "Save",
  approve: "Allow",
  alwaysAllow: "Always allow",
  neverAllow: "Never allow",
  undoRule: "Undo",
  modelMenuHeading: "Choose how the assistant answers",
  modelMenuLabel: "Answer style",
  modelSearchPlaceholder: "Search",
  jumpToLatest: "Jump to latest",
  retryResponse: "Retry response",
  statusThinking: "Thinking…",
  statusReplying: "Replying…",
  statusWorking: "Working on it…",
  statusError: "The reply could not be completed. What arrived is kept.",
  statusInterrupted: "Interrupted, try again",
  interruptedAfterTool:
    "This reply stopped after a tool ran. Send a follow-up to continue without repeating its action.",
  interruptedMidFlightRestart:
    "Interrupted during server restart — mid-flight action was NOT replayed so nothing is sent twice.",
  mascot: "Mascot",
  mascotStateIdle: "waiting",
  mascotStateThinking: "thinking",
  mascotStateWorking: "working",
  mascotStateDone: "finished",
  // Long-chat summary
  earlierInChatTitle: "Earlier in this chat",
  earlierInChatSubtitle: "Saved summary kept across reloads and retries",
  // Approval cards & badges
  badgeNeverSends: "Never sends",
  badgeNoInvites: "Sends no invites",
  badgePrivateDraft: "Private draft · Unshared",
  badgeUnpublishedDraft: "Unpublished · Draft",
  riskLow: "Low risk",
  riskMedium: "Review",
  riskHigh: "High impact",
  riskCritical: "Critical review",
  fieldTo: "To",
  fieldSubject: "Subject",
  fieldMessage: "Message",
  fieldTitle: "Title",
  fieldStart: "Starts",
  fieldEnd: "Ends",
  fieldDocTitle: "Document name",
  fieldRepo: "Repository",
  fieldSchedule: "Schedule",
  technicalDetails: "Technical details",
  parameterDetails: "Parameter details",
  approvalDeclinedNotice: "Cancelled — nothing was saved or sent.",
  approvalExpiredNotice:
    "Approval expired because a newer message was sent in this chat.",
  approvalBlockedByRuleNotice:
    "Blocked by your 'Never allow' rule in Settings.",
  approvalSaving: "Saving…",
  approvalSavedGmailDraft: "Gmail draft saved (not sent).",
  approvalSavedCalendarDraft: "Calendar draft event saved.",
  approvalSavedDriveDraft: "Google Drive draft document saved.",
  approvalSavedGeneric: "Saved.",
  approvalSaveFailed: "Could not save draft.",
  approvalEmailValidationError:
    "Please enter a valid recipient email, subject, and message body.",
  titleGmailDraft: "Save Gmail draft",
  titleDriveDraft: "Google Drive draft document",
  titleCalendarDraft: "Calendar draft event",
  titleGithubDraft: "GitHub PR draft review",
  titleVideoClip: "Generate video clip",
  titleScheduleTask: "Create scheduled routine",
  titleWeatherApproval: "Approve weather lookup",
  // Settings: Language, Approval mode & Per-tool rules
  languageLabel: "Interface language",
  languageAuto: "Auto",
  languageEnglish: "English",
  languageTurkish: "Türkçe",
  approvalSettingsHeading: "Action approvals & safety",
  approvalSettingsDescription:
    "Choose when the assistant asks before creating drafts or running external actions, and manage per-tool rules.",
  approvalModeAskEveryTime: "Ask every time",
  approvalModeAskEveryTimeDesc:
    "Show an approval card before saving any draft or running any external action.",
  approvalModeDraftFirst: "Draft without asking, ask before sending",
  approvalModeDraftFirstDesc:
    "Save private unsent drafts automatically, and always ask before sending or running external actions.",
  toolRulesHeading: "Saved per-tool approval rules",
  toolRulesEmpty:
    "No custom per-tool rules yet. Use 'Always allow' or 'Never allow' on any approval card.",
  ruleBadgeAlwaysAllow: "Always allow",
  ruleBadgeNeverAllow: "Never allow",
  // Cloud computer & Screen handoff
  cloudComputerTitle: "Cloud Computer",
  cloudSleepingBadge: "Sleeping (idle)",
  cloudWakingBadge: "Waking up…",
  cloudRunningBadge: "Running",
  cloudStatusDone: "Done",
  cloudNeedsApproval: "Needs approval",
  cloudOpen: "Open",
  cloudClosePreview: "Hide preview",
  cloudDownload: "Download",
  cloudShowTerminal: "Show terminal output",
  cloudHideTerminal: "Hide terminal output",
  screenHandoffTitle: "Action needed on Cloud Computer screen",
  screenHandoffSafetyNote:
    "Never type passwords, 2FA codes, or recovery keys in chat. Complete the step directly on the Cloud Computer screen.",
  screenHandoffReasonLogin: "Sign-in required",
  screenHandoffReasonTwoFactor: "2FA verification",
  screenHandoffReasonCaptcha: "Human verification",
  screenHandoffOpenScreen: "Open Cloud Screen",
  screenHandoffImHere: "I'm here",
  screenHandoffNotNow: "Not now",
  screenHandoffConfirmed:
    "Thanks — noted that you're on the screen. Ready to continue.",
  screenHandoffDeferred: "Paused for now — nothing else will run on that page.",
  // Routines: Smart quiet check-ins & Event triggers
  eventTriggersHeading: "Event-triggered routines",
  eventTriggersDescription:
    "Run a routine automatically when an external event arrives (starts with new Gmail email; extensible to Slack & GitHub).",
  eventSourceGmail: "New Gmail email",
  eventSourceGithub: "GitHub event",
  eventSourceSlack: "Slack event",
  eventFilterLabel: "Event filter (optional, e.g. from:x.ai or *)",
  saveEventTrigger: "Save event trigger",
  checkNowButton: "Check now",
  quietCheckInBadge: "Quiet mode + 20m active-chat skip + silent backoff",
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
  routinesAndTasks: "Rutinler ve görevler",
  memory: "Bellek",
  skillsLibrary: "Beceri kitaplığı",
  teammatesRoster: "Takım arkadaşları",
  setupChecklist: "Kurulum kontrol listesi",
  signOut: "Çıkış yap",
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
  preview: "Önizle",
  save: "Kaydet",
  approve: "Onayla",
  alwaysAllow: "Her zaman izin ver",
  neverAllow: "Asla izin verme",
  undoRule: "Geri al",
  modelMenuHeading: "Asistanın nasıl yanıtlayacağını seç",
  modelMenuLabel: "Yanıt tarzı",
  modelSearchPlaceholder: "Ara",
  jumpToLatest: "Son mesaja git",
  retryResponse: "Yanıtı yeniden dene",
  statusThinking: "Düşünüyor…",
  statusReplying: "Yanıt yazıyor…",
  statusWorking: "Üzerinde çalışıyor…",
  statusError: "Yanıt tamamlanamadı. Gelen kısım korundu.",
  statusInterrupted: "Yarıda kesildi, tekrar dene",
  interruptedAfterTool:
    "Bu yanıt bir araç çalıştıktan sonra durdu. İşlemi tekrarlamadan devam etmek için bir mesaj gönder.",
  interruptedMidFlightRestart:
    "Sunucu yeniden başlatılırken yarıda kesildi — yarım kalan işlem iki kez gönderilmemesi için tekrar çalıştırılmadı.",
  mascot: "Maskot",
  mascotStateIdle: "bekliyor",
  mascotStateThinking: "düşünüyor",
  mascotStateWorking: "çalışıyor",
  mascotStateDone: "bitti",
  // Long-chat summary
  earlierInChatTitle: "Sohbetin önceki kısmı",
  earlierInChatSubtitle: "Yenileme ve tekrar denemelerde korunan kısa özet",
  // Approval cards & badges
  badgeNeverSends: "Asla göndermez",
  badgeNoInvites: "Davet göndermez",
  badgePrivateDraft: "Özel taslak · Paylaşılmaz",
  badgeUnpublishedDraft: "Yayınlanmaz · Taslak",
  riskLow: "Düşük risk",
  riskMedium: "İnceleme",
  riskHigh: "Yüksek etki",
  riskCritical: "Kritik inceleme",
  fieldTo: "Kime",
  fieldSubject: "Konu",
  fieldMessage: "İleti",
  fieldTitle: "Başlık",
  fieldStart: "Başlangıç",
  fieldEnd: "Bitiş",
  fieldDocTitle: "Belge adı",
  fieldRepo: "Depo",
  fieldSchedule: "Zamanlama",
  technicalDetails: "Teknik ayrıntı",
  parameterDetails: "Parametre detayları",
  approvalDeclinedNotice: "Vazgeçildi — hiçbir taslak kaydedilmedi.",
  approvalExpiredNotice:
    "Bu sohbette yeni bir mesaj gönderildiği için onay süresi doldu.",
  approvalBlockedByRuleNotice:
    "Ayarlardaki 'Asla izin verme' kuralınız nedeniyle engellendi.",
  approvalSaving: "Kaydediliyor…",
  approvalSavedGmailDraft: "Gmail taslağı kaydedildi (gönderilmedi).",
  approvalSavedCalendarDraft: "Takvim taslak etkinliği kaydedildi.",
  approvalSavedDriveDraft: "Google Drive taslak belgesi kaydedildi.",
  approvalSavedGeneric: "Kaydedildi.",
  approvalSaveFailed: "Taslak kaydedilemedi.",
  approvalEmailValidationError:
    "Lütfen geçerli bir alıcı e-postası, konu ve ileti metni girin.",
  titleGmailDraft: "Gmail taslağı kaydet",
  titleDriveDraft: "Google Drive taslak belgesi",
  titleCalendarDraft: "Takvim taslak etkinliği",
  titleGithubDraft: "GitHub PR taslak incelemesi",
  titleVideoClip: "Video klibi oluştur",
  titleScheduleTask: "Zamanlanmış rutin oluştur",
  titleWeatherApproval: "Hava durumu sorgusunu onayla",
  // Settings: Language, Approval mode & Per-tool rules
  languageLabel: "Arayüz dili",
  languageAuto: "Otomatik",
  languageEnglish: "English",
  languageTurkish: "Türkçe",
  approvalSettingsHeading: "İşlem onayları ve güvenlik",
  approvalSettingsDescription:
    "Asistanın taslak oluşturmadan veya dış işlemleri çalıştırmadan önce ne zaman soracağını seçin ve araç bazlı kuralları yönetin.",
  approvalModeAskEveryTime: "Her seferinde sor",
  approvalModeAskEveryTimeDesc:
    "Herhangi bir taslak kaydetmeden veya dış işlem çalıştırmadan önce onay kartı göster.",
  approvalModeDraftFirst: "Sormadan taslak oluştur, göndermeden önce sor",
  approvalModeDraftFirstDesc:
    "Gönderilmeyen özel taslakları otomatik kaydet; göndermeden veya dış işlem yapmadan önce mutlaka sor.",
  toolRulesHeading: "Kayıtlı araç onay kuralları",
  toolRulesEmpty:
    "Henüz özel bir araç kuralı yok. Herhangi bir onay kartında 'Her zaman izin ver' veya 'Asla izin verme' seçeneğini kullanabilirsiniz.",
  ruleBadgeAlwaysAllow: "Her zaman izin ver",
  ruleBadgeNeverAllow: "Asla izin verme",
  // Cloud computer & Screen handoff
  cloudComputerTitle: "Bulut Bilgisayar",
  cloudSleepingBadge: "Uykuda (boşta)",
  cloudWakingBadge: "Uyanıyor…",
  cloudRunningBadge: "Çalışıyor",
  cloudStatusDone: "Tamamlandı",
  cloudNeedsApproval: "Onay gerekiyor",
  cloudOpen: "Aç",
  cloudClosePreview: "Önizlemeyi gizle",
  cloudDownload: "İndir",
  cloudShowTerminal: "Terminal çıktısını göster",
  cloudHideTerminal: "Terminal çıktısını gizle",
  screenHandoffTitle: "Bulut Bilgisayar ekranında işlem gerekiyor",
  screenHandoffSafetyNote:
    "Şifre, 2FA kodu veya kurtarma anahtarlarını asla sohbete yazmayın. Adımı doğrudan Bulut Bilgisayar ekranında tamamlayın.",
  screenHandoffReasonLogin: "Giriş gerekiyor",
  screenHandoffReasonTwoFactor: "2FA doğrulaması",
  screenHandoffReasonCaptcha: "İnsan doğrulaması",
  screenHandoffOpenScreen: "Bulut Ekranını Aç",
  screenHandoffImHere: "Buradayım",
  screenHandoffNotNow: "Şimdi değil",
  screenHandoffConfirmed:
    "Teşekkürler — ekranda olduğunuz kaydedildi. Devam etmeye hazır.",
  screenHandoffDeferred:
    "Şimdilik duraklatıldı — bu sayfada başka işlem yapılmayacak.",
  // Routines: Smart quiet check-ins & Event triggers
  eventTriggersHeading: "Olay tetiklemeli rutinler",
  eventTriggersDescription:
    "Yeni bir olay geldiğinde rutini otomatik çalıştır (yeni Gmail e-postası ile başlar; Slack ve GitHub için genişletilebilir).",
  eventSourceGmail: "Yeni Gmail e-postası",
  eventSourceGithub: "GitHub olayı",
  eventSourceSlack: "Slack olayı",
  eventFilterLabel: "Olay filtresi (isteğe bağlı, örn. from:x.ai veya *)",
  saveEventTrigger: "Olay tetikleyicisini kaydet",
  checkNowButton: "Şimdi kontrol et",
  quietCheckInBadge:
    "Sessiz mod + 20 dk aktif sohbet atlama + sessiz geri çekilme",
};

export const uiCopy: { readonly en: UiCopy; readonly tr: UiCopy } = {
  en,
  tr,
};

export type UiLocale = keyof typeof uiCopy;

export const DEFAULT_UI_LOCALE: UiLocale = "en";

export function getCopy(locale: UiLocale = DEFAULT_UI_LOCALE): UiCopy {
  return uiCopy[locale] ?? uiCopy.en;
}

export type DictionaryValidationReport = {
  missingInTr: string[];
  missingInEn: string[];
  emptyInEn: string[];
  emptyInTr: string[];
  lengthMismatchKeys: string[];
};

/**
 * Validates any EN/TR dictionary pair and flags missing, extra, empty, or
 * array-length-mismatched keys so EN and TR never drift out of sync.
 */
export function validateBilingualDictionary(
  enDict: Record<string, unknown>,
  trDict: Record<string, unknown>
): DictionaryValidationReport {
  const enKeys = new Set(Object.keys(enDict));
  const trKeys = new Set(Object.keys(trDict));

  const missingInTr = [...enKeys].filter((k) => !trKeys.has(k)).sort();
  const missingInEn = [...trKeys].filter((k) => !enKeys.has(k)).sort();
  const emptyInEn: string[] = [];
  const emptyInTr: string[] = [];
  const lengthMismatchKeys: string[] = [];

  for (const key of enKeys) {
    const ev = enDict[key];
    if (typeof ev === "string" && ev.trim().length === 0) {
      emptyInEn.push(key);
    } else if (
      Array.isArray(ev) &&
      ev.some((item) => typeof item !== "string" || item.trim().length === 0)
    ) {
      emptyInEn.push(key);
    }
  }

  for (const key of trKeys) {
    const tv = trDict[key];
    if (typeof tv === "string" && tv.trim().length === 0) {
      emptyInTr.push(key);
    } else if (
      Array.isArray(tv) &&
      tv.some((item) => typeof item !== "string" || item.trim().length === 0)
    ) {
      emptyInTr.push(key);
    }
  }

  for (const key of enKeys) {
    if (!trKeys.has(key)) {
      continue;
    }
    const ev = enDict[key];
    const tv = trDict[key];
    if (
      (Array.isArray(ev) || Array.isArray(tv)) &&
      (!Array.isArray(ev) || !Array.isArray(tv) || ev.length !== tv.length)
    ) {
      lengthMismatchKeys.push(key);
    }
  }

  return {
    missingInTr,
    missingInEn,
    emptyInEn: emptyInEn.sort(),
    emptyInTr: emptyInTr.sort(),
    lengthMismatchKeys: lengthMismatchKeys.sort(),
  };
}
