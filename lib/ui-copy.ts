/**
 * Typed EN/TR UI dictionary for the personal-assistant shell, approval cards,
 * settings, long-chat summaries, cloud computer screen handoff, and routines.
 *
 * The four `suggestions` are sent verbatim to the model as the user message,
 * so the English strings must not be reworded casually.
 */
const en = {
  assistant: "Assistant",
  pageTitle: "Assistant",
  history: "History",
  openHistory: "Open History",
  toggleSidebar: "Toggle sidebar",
  toggleSidebarSr: "Toggle Sidebar",
  chatOptions: "Chat options",
  accountMenu: "Account menu",
  guestLabel: "Guest",
  chooseFile: "Choose File",
  uploadFiles: "Upload files",
  checkingChatAvailability: "Checking chat availability…",
  chatSetupIncomplete:
    "Chat setup is not complete yet. Your message will stay here until chat is ready.",
  chatNotReady: "Chat not ready",
  waitForResponseToast: "Please wait for the model to finish its response!",
  uploadFilesFailedToast: "Failed to upload files",
  liveVoiceChat: "Live voice chat",
  startLiveVoiceChat: "Start live voice chat",
  liveVoiceConversation: "Live voice conversation",
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
  composerPlaceholder: "Ask…",
  editPlaceholder: "Edit your message…",
  editingMessage: "Editing message",
  cancel: "Cancel",
  send: "Send",
  stop: "Stop",
  attachFile: "Attach a file",
  dictateMessage: "Dictate message",
  stopDictation: "Stop dictation",
  dictateTooltip: "Dictate into message box",
  stopDictationTooltip: "Tap to finish dictation",
  copy: "Copy",
  edit: "Edit",
  upvoteResponse: "Upvote Response",
  downvoteResponse: "Downvote Response",
  toggleDarkMode: "Toggle dark mode",
  toggleLightMode: "Toggle light mode",
  accountLabel: "Account",
  signedInFallback: "Signed in",
  loginToAccount: "Login to your account",
  homeLabel: "Home",
  homeCityAriaLabel: "Home city",
  noCitySaved: "No city saved",
  homeCityPlaceholder: "e.g. London, Istanbul",
  useCurrentLocation: "Use my current location",
  clearSavedLocation: "Clear saved location",
  locationNotFoundError: "Could not find that place. Try a nearby city.",
  locationUnsupportedError: "This browser cannot share its location.",
  locationPermissionDeniedError:
    "Location permission was not given. Nothing was saved.",
  historyToday: "Today",
  historyYesterday: "Yesterday",
  historyLastWeek: "Last 7 days",
  historyLastMonth: "Last 30 days",
  historyOlder: "Older",
  emptyHistoryHint:
    "Your conversations will appear here once you start chatting!",
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
  titleOutboundDraft: "Save message draft",
  // Subpage navigation
  subpageSettings: "Settings",
  subpageSetup: "Setup",
  subpageTeammates: "Teammates",
  subpageMemory: "Memory",
  subpageRoutines: "Routines",
  subpageSkills: "Skills",
  // Settings: Appearance, Memory, Capabilities, Language, Approval mode & Usage
  appearanceHeading: "Appearance & personalisation",
  appearanceDescription:
    "Adjust theme, mascot accent, and default home location for weather and local time.",
  appearanceLabel: "Appearance",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  memorySectionDescription:
    "Paste a long list of personal facts, edit or search saved memories, or export everything. Stored in private Postgres and used automatically in chat and voice.",
  memoryManageTitle: "Manage memories & paste list",
  memoryManageSubtitleSingular: "saved memory · Search, edit, delete & export",
  memoryManageSubtitlePlural: "saved memories · Search, edit, delete & export",
  memoryStatusSetupRequired:
    "Setup required — Postgres memory store is not connected",
  memoryStatusUnavailable: "Memory store temporarily unavailable",
  memoryStatusDisabled: "Memory disabled by environment setting",
  openButton: "Open",
  capabilitiesHeading: "Personal apps & capabilities",
  capabilitiesDescription:
    "Chat, search, voice, and images work automatically.",
  voiceCapabilityTitle: "Voice dictation & Live speech",
  voiceCapabilityDesc:
    "Included automatically — speak hands-free or dictate into chat",
  imageCapabilityTitle: "Image Studio",
  imageCapabilityDesc:
    "Included automatically — ask in chat to generate images",
  googleCapabilityTitle: "Gmail, Calendar & Drive",
  googleCapabilityDesc:
    "Read & unsent drafts only — never sends emails or invites without you",
  githubCapabilityTitle: "GitHub Pull Requests",
  githubCapabilityOptional: "(optional)",
  githubCapabilityDesc:
    "Read pull requests & prepare unpublished draft reviews",
  statusActive: "Active",
  statusReady: "Ready",
  statusStandby: "Standby",
  statusChecking: "Checking…",
  statusConnected: "Connected",
  disconnectButton: "Disconnect",
  connectGoogleButton: "Connect Google",
  openSetupButton: "Open setup",
  toastGoogleConnected: "Google Gmail, Calendar & Drive connected.",
  toastGoogleDisconnected: "Disconnected Google Workspace.",
  toastGithubDisconnected: "Disconnected GitHub.",
  usageHeading: "Vertex AI & Token Usage",
  usageDescription:
    "Actual costs and credits are tracked directly in Google Cloud Billing; this app never invents spend caps or remaining-credit estimates.",
  usageMtdCloudSpend: "MTD Cloud Usage",
  usageSourceGcpLive: "Live Google Cloud data",
  usageUnavailableShort: "Temporarily unavailable",
  usageRemainingBudget: "Remaining Cloud Budget",
  usageCloudBudgetSuffix: "GCP budget",
  usageTotalTokensMonth: "Total Tokens (Month)",
  usageInputTokensMonth: "Input Tokens (Month)",
  usageOutputTokensMonth: "Output Tokens (Month)",
  usageModelCallsSuffix: "model calls",
  usageThisMonth: "This month",
  usageCloudBillingManagedNote:
    "Google Cloud Billing is not connected here. Real costs and credits are shown directly in Google Cloud Billing — only your per-model token counts appear below.",
  usageOpenCloudBilling: "Open Google Cloud Billing",
  usageOpenInSetup: "Open in Setup",
  usageRefreshError:
    "Usage table could not be refreshed right now; chat continues uninterrupted.",
  usageColModel: "Model",
  usageColInputOutput: "Input / Output",
  usageColTotalTokens: "Total Tokens",
  usageCallsSuffix: "calls",
  usageInputShort: "In",
  usageOutputShort: "Out",
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
  // Live Voice overlay
  liveVoiceConnecting: "Connecting…",
  liveVoiceListening: "Listening",
  liveVoiceSpeakingInterrupt: "Speaking · tap to interrupt",
  liveVoiceReconnecting: "Reconnecting…",
  liveVoicePaused: "Paused",
  liveVoiceUnavailable: "Voice unavailable",
  liveVoiceEnded: "Ended",
  liveVoiceMicMuted: "Microphone muted",
  liveVoiceGettingReady: "Getting ready…",
  liveVoiceTapContinue: "Tap the assistant to continue",
  liveVoiceUnmutePrompt: "Unmute to keep talking",
  liveVoiceTalkPrompt: "Talk naturally. You can interrupt anytime.",
  liveVoiceConnectCardHint: "Tap to connect account in chat",
  liveVoiceApprovalCardHint: "Tap to review approval card in chat",
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly [string, string, string, string]
    ? readonly [string, string, string, string]
    : T;

export type UiCopy = { [K in keyof typeof en]: Widen<(typeof en)[K]> };

const tr: UiCopy = {
  assistant: "Asistan",
  pageTitle: "Asistan",
  history: "Geçmiş",
  openHistory: "Geçmişi aç",
  toggleSidebar: "Kenar çubuğunu aç/kapat",
  toggleSidebarSr: "Kenar çubuğunu aç/kapat",
  chatOptions: "Sohbet seçenekleri",
  accountMenu: "Hesap menüsü",
  guestLabel: "Misafir",
  chooseFile: "Dosya seç",
  uploadFiles: "Dosya yükle",
  checkingChatAvailability: "Sohbet durumu kontrol ediliyor…",
  chatSetupIncomplete:
    "Sohbet kurulumu henüz tamamlanmadı. Sohbet hazır olana kadar mesajın burada kalacak.",
  chatNotReady: "Sohbet hazır değil",
  waitForResponseToast: "Lütfen yanıt tamamlanana kadar bekleyin.",
  uploadFilesFailedToast: "Dosyalar yüklenemedi",
  liveVoiceChat: "Canlı sesli sohbet",
  startLiveVoiceChat: "Canlı sesli sohbeti başlat",
  liveVoiceConversation: "Canlı sesli görüşme",
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
  dictateMessage: "Mesaj yazdır",
  stopDictation: "Yazdırmayı durdur",
  dictateTooltip: "Mesaj kutusuna sesle yazdır",
  stopDictationTooltip: "Yazdırmayı bitirmek için dokun",
  copy: "Kopyala",
  edit: "Düzenle",
  upvoteResponse: "Yanıtı beğen",
  downvoteResponse: "Yanıtı beğenme",
  toggleDarkMode: "Koyu temaya geç",
  toggleLightMode: "Açık temaya geç",
  accountLabel: "Hesap",
  signedInFallback: "Giriş yapıldı",
  loginToAccount: "Hesabına giriş yap",
  homeLabel: "Ev konumu",
  homeCityAriaLabel: "Ev şehri",
  noCitySaved: "Kayıtlı şehir yok",
  homeCityPlaceholder: "örn. Londra, İstanbul",
  useCurrentLocation: "Mevcut konumumu kullan",
  clearSavedLocation: "Kayıtlı konumu temizle",
  locationNotFoundError: "Bu konum bulunamadı. Yakın bir şehir deneyin.",
  locationUnsupportedError: "Bu tarayıcı konum paylaşamıyor.",
  locationPermissionDeniedError:
    "Konum izni verilmedi. Hiçbir şey kaydedilmedi.",
  historyToday: "Bugün",
  historyYesterday: "Dün",
  historyLastWeek: "Son 7 gün",
  historyLastMonth: "Son 30 gün",
  historyOlder: "Daha eski",
  emptyHistoryHint:
    "Sohbete başladığında geçmiş konuşmaların burada görünecek.",
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
  titleOutboundDraft: "Mesaj taslağı kaydet",
  // Subpage navigation
  subpageSettings: "Ayarlar",
  subpageSetup: "Kurulum",
  subpageTeammates: "Takım arkadaşları",
  subpageMemory: "Bellek",
  subpageRoutines: "Rutinler",
  subpageSkills: "Beceriler",
  // Settings: Appearance, Memory, Capabilities, Language, Approval mode & Usage
  appearanceHeading: "Görünüm ve kişiselleştirme",
  appearanceDescription:
    "Temayı, maskot vurgu rengini ve hava durumu ile yerel saat için varsayılan ev konumunu ayarlayın.",
  appearanceLabel: "Görünüm",
  themeSystem: "Sistem",
  themeLight: "Açık",
  themeDark: "Koyu",
  memorySectionDescription:
    "Kişisel bilgilerinizin toplu listesini yapıştırın, kayıtlı anıları arayın veya düzenleyin ya da tümünü dışa aktarın. Özel Postgres'te saklanır ve sohbet ile seste otomatik kullanılır.",
  memoryManageTitle: "Belleği yönet ve liste yapıştır",
  memoryManageSubtitleSingular:
    "kayıtlı bilgi · Ara, düzenle, sil ve dışa aktar",
  memoryManageSubtitlePlural: "kayıtlı bilgi · Ara, düzenle, sil ve dışa aktar",
  memoryStatusSetupRequired:
    "Kurulum gerekli — Postgres bellek deposu bağlı değil",
  memoryStatusUnavailable: "Bellek deposuna şu an ulaşılamıyor",
  memoryStatusDisabled: "Bellek ortam ayarıyla devre dışı",
  openButton: "Aç",
  capabilitiesHeading: "Kişisel uygulamalar ve yetenekler",
  capabilitiesDescription:
    "Sohbet, arama, ses ve görseller otomatik olarak çalışır.",
  voiceCapabilityTitle: "Sesle yazdırma ve Canlı konuşma",
  voiceCapabilityDesc:
    "Otomatik dahildir — eller serbest konuşun veya sohbete yazdırın",
  imageCapabilityTitle: "Görsel Stüdyosu",
  imageCapabilityDesc:
    "Otomatik dahildir — görsel üretmek için sohbette isteyin",
  googleCapabilityTitle: "Gmail, Takvim ve Drive",
  googleCapabilityDesc:
    "Yalnızca okuma ve gönderilmemiş taslaklar — izniniz olmadan e-posta veya davet göndermez",
  githubCapabilityTitle: "GitHub Pull Request'leri",
  githubCapabilityOptional: "(isteğe bağlı)",
  githubCapabilityDesc:
    "PR'ları okuyun ve yayınlanmamış taslak incelemeler hazırlayın",
  statusActive: "Aktif",
  statusReady: "Hazır",
  statusStandby: "Beklemede",
  statusChecking: "Kontrol ediliyor…",
  statusConnected: "Bağlı",
  disconnectButton: "Bağlantıyı kes",
  connectGoogleButton: "Google'ı Bağla",
  openSetupButton: "Kurulumu aç",
  toastGoogleConnected: "Google Gmail, Takvim ve Drive bağlandı.",
  toastGoogleDisconnected: "Google Workspace bağlantısı kesildi.",
  toastGithubDisconnected: "GitHub bağlantısı kesildi.",
  usageHeading: "Vertex AI ve Kullanım Özeti",
  usageDescription:
    "Gerçek maliyet ve krediler doğrudan Google Cloud Billing üzerinden takip edilir; uygulama içinde yapay bütçe limiti veya kalan kredi tahmini üretilmez.",
  usageMtdCloudSpend: "Ay İçi Bulut Kullanımı",
  usageSourceGcpLive: "Google Cloud gerçek veri",
  usageUnavailableShort: "Geçici olarak kullanılamıyor",
  usageRemainingBudget: "Kalan Bulut Bütçesi",
  usageCloudBudgetSuffix: "GCP bütçesi",
  usageTotalTokensMonth: "Toplam Token (Ay)",
  usageInputTokensMonth: "Giriş Token (Ay)",
  usageOutputTokensMonth: "Çıkış Token (Ay)",
  usageModelCallsSuffix: "model çağrısı",
  usageThisMonth: "Bu ay",
  usageCloudBillingManagedNote:
    "Google Cloud Billing bağlı değil. Gerçek maliyet ve kredi bilgileri doğrudan Google Cloud Billing üzerinde yer alır — aşağıda yalnızca model bazlı token sayıları gösterilir.",
  usageOpenCloudBilling: "Google Cloud Billing'i aç",
  usageOpenInSetup: "Kurulumda aç",
  usageRefreshError:
    "Kullanım tablosu şu an yenilenemedi; sohbet kesintisiz devam eder.",
  usageColModel: "Model",
  usageColInputOutput: "Giriş / Çıkış",
  usageColTotalTokens: "Toplam Token",
  usageCallsSuffix: "çağrı",
  usageInputShort: "G",
  usageOutputShort: "Ç",
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
  approvalModeDraftFirst: "Taslak hazırla, göndermeden önce sor",
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
  // Live Voice overlay
  liveVoiceConnecting: "Bağlanıyor…",
  liveVoiceListening: "Dinliyor",
  liveVoiceSpeakingInterrupt: "Konuşuyor · bölmek için dokun",
  liveVoiceReconnecting: "Yeniden bağlanıyor…",
  liveVoicePaused: "Duraklatıldı",
  liveVoiceUnavailable: "Ses kullanılamıyor",
  liveVoiceEnded: "Sona erdi",
  liveVoiceMicMuted: "Mikrofon kapalı",
  liveVoiceGettingReady: "Hazırlanıyor…",
  liveVoiceTapContinue: "Devam etmek için asistana dokun",
  liveVoiceUnmutePrompt: "Konuşmaya devam etmek için sesi aç",
  liveVoiceTalkPrompt: "Doğal konuşabilirsin. İstediğin an araya girebilirsin.",
  liveVoiceConnectCardHint: "Sohbette hesabı bağlamak için dokun",
  liveVoiceApprovalCardHint: "Sohbetteki onay kartını incelemek için dokun",
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

export function formatMemorySummaryStatus(
  summary:
    | {
        status?: string;
        toolsEnabled?: boolean;
        profileFacts?: readonly unknown[];
      }
    | null
    | undefined,
  opts: { loading?: boolean; hasError?: boolean; locale?: UiLocale } = {}
): string {
  const copy = getCopy(opts.locale ?? DEFAULT_UI_LOCALE);
  if (opts.hasError) {
    return copy.memoryStatusUnavailable;
  }
  if (opts.loading || !summary) {
    return copy.statusChecking;
  }
  if (summary.status === "setup_required") {
    return copy.memoryStatusSetupRequired;
  }
  if (summary.toolsEnabled === false) {
    return copy.memoryStatusDisabled;
  }
  const count = summary.profileFacts?.length ?? 0;
  return `${count} ${
    count === 1
      ? copy.memoryManageSubtitleSingular
      : copy.memoryManageSubtitlePlural
  }`;
}

export type CloudBillingMissingCode =
  | "wif_not_configured"
  | "oidc_unavailable"
  | "api_disabled"
  | "billing_permission_denied"
  | "bigquery_export_missing"
  | "timeout"
  | "http_error";

export function formatCloudBillingUnavailableReason(
  gcp:
    | {
        missingCode?: CloudBillingMissingCode | null;
        missingDetail?: string | null;
        missingReason?: string | null;
        projectId?: string | null;
        billingAccountId?: string | null;
      }
    | null
    | undefined,
  locale: UiLocale = DEFAULT_UI_LOCALE
): string {
  const projectLabel = gcp?.projectId || "GCP";
  const acctLabel = gcp?.billingAccountId || "0140A2-72DEB2-62EDCD";
  const detail = gcp?.missingDetail?.trim() || "Cloud Billing API";
  switch (gcp?.missingCode) {
    case "wif_not_configured":
      return locale === "tr"
        ? "Vertex AI Workload Identity Federation (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE) bu ortamda tanımlı değil."
        : "Vertex AI Workload Identity Federation (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE) is not configured in this environment.";
    case "oidc_unavailable":
      return locale === "tr"
        ? "Sunucu ortamında aktif Vercel OIDC belirteci alınamadı; canlı Google Cloud fatura verisi yalnızca Vercel sunucusunda sorgulanabilir."
        : "Active Vercel OIDC token is not available in this runtime; live Google Cloud billing figures require the Vercel server environment.";
    case "api_disabled":
      return locale === "tr"
        ? `${detail} henüz Vertex projesinde (${projectLabel}) etkinleştirilmemiş.`
        : `${detail} is not yet enabled on the Vertex project (${projectLabel}).`;
    case "billing_permission_denied":
      return locale === "tr"
        ? `Vertex WIF servis hesabında '${detail}' okuma yetkisi eksik (${acctLabel} üzerinde 'roles/billing.viewer' izni gerekli).`
        : `Vertex WIF service account is missing read permission for '${detail}' ('roles/billing.viewer' required on ${acctLabel}).`;
    case "bigquery_export_missing":
      return locale === "tr"
        ? "Cloud Billing -> BigQuery standart maliyet dışa aktarımı (gcp_billing_export_v1) henüz etkinleştirilmemiş."
        : "Cloud Billing -> BigQuery standard cost export (gcp_billing_export_v1) is not enabled yet on this project.";
    case "timeout":
      return locale === "tr"
        ? "Google Cloud fatura sorgusu zaman aşımına uğradı; uygulama içi token kayıtları gösteriliyor."
        : "Google Cloud billing query timed out; showing in-app monthly token logs.";
    case "http_error":
      return locale === "tr"
        ? `${detail} yanıt vermedi.`
        : `${detail} did not respond.`;
    default:
      if (gcp?.missingReason?.trim()) {
        if (locale === "en") {
          if (
            /gcp_billing_export|etkinleştirilmemiş/i.test(gcp.missingReason)
          ) {
            return "Google Cloud Billing / BigQuery export is not enabled yet on this project.";
          }
          if (/yetkisi eksik|roles\/billing/i.test(gcp.missingReason)) {
            return `Vertex WIF service account needs Billing Viewer permission on ${acctLabel}.`;
          }
          if (/zaman aşımı/i.test(gcp.missingReason)) {
            return "Google Cloud billing query timed out; showing in-app monthly token logs.";
          }
          if (/OIDC|tanımlı değil/i.test(gcp.missingReason)) {
            return "Live Google Cloud billing credentials (WIF / OIDC) are unavailable in this runtime.";
          }
        }
        return gcp.missingReason.trim();
      }
      return locale === "tr"
        ? "Canlı Google Cloud fatura verisi şu an alınamıyor."
        : "Live Google Cloud billing figures are currently unavailable.";
  }
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
