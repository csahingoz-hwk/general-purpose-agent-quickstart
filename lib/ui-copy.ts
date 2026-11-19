export const FIRECRAWL_KEY_CREATE_URL =
  "https://www.firecrawl.dev/app/api-keys";
export const VERCEL_ENV_VARS_URL =
  "https://vercel.com/csahingoz-3779/general-purpose-agent-quickstart/settings/environment-variables";

/**
 * Typed EN/TR UI dictionary for the personal-assistant shell, approval cards,
 * settings, setup checklist, long-chat summaries, cloud computer screen handoff, and routines.
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
  modelAutoName: "Auto",
  modelAutoDescription: "Hydrogen everyday / Neon for hard & research",
  modelNeonDescription:
    "Always Gemini 4 Neon — deep reasoning, research & visual creation",
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
  toastGithubConnected: "GitHub connected.",
  toastGoogleDisconnected: "Disconnected Google Workspace.",
  toastGithubDisconnected: "Disconnected GitHub.",
  // Setup checklist & Firecrawl card
  setupHeading: "Setup checklist",
  setupSubtitle:
    "Core chat, live voice, search, and images run automatically. Connect personal apps below when you want draft assistance.",
  setupLoadError: "Could not load setup health right now.",
  setupRetry: "Retry",
  setupReconnect: "Reconnect",
  setupDisconnect: "Disconnect",
  setupConnect: "Connect",
  setupReady: "Ready",
  setupConnected: "Connected",
  setupOptional: "Optional",
  setupOpen: "Open",
  setupItemCoreAiLabel: "Chat, web search, voice & images",
  setupItemCoreAiReady:
    "Active via Google Cloud Vertex AI (Gemini 4 Hydrogen -> Neon escalation — no internal spend cap).",
  setupItemCoreAiAction:
    "Turn on Vertex AI WIF (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE) in your Vercel project settings.",
  setupItemCoreAiBtn: "Open Vercel",
  setupItemGcpBillingLabel: "Google Cloud Billing telemetry (Vertex)",
  setupItemGcpBillingUnavailable:
    "Actual costs and credits are tracked directly in Google Cloud Billing. Enable Cloud Billing + BigQuery Billing Export if you also want live MTD figures inside this app.",
  setupItemGcpBillingBtnEnable: "Enable Billing APIs",
  setupItemGcpBillingBtnGrant: "Grant Billing Viewer",
  setupItemGcpBillingBtnExport: "Enable Billing Export",
  setupItemGcpBillingBtnOpen: "Open Cloud Billing",
  setupItemCopilotLabel: "Copilot Claude Haiku 5.5 fallback (Cloud VM)",
  setupItemCopilotReady:
    "Active via Cloud VM bridge (COPILOT_GITHUB_TOKEN configured — answers only on Vertex failure or timeout).",
  setupItemCopilotNeedToken:
    "Add COPILOT_GITHUB_TOKEN (GitHub token with Copilot Requests permission) in Vercel & Cloud VM server env.",
  setupItemCopilotNeedVm:
    "Connect Cloud Computer VM relay and add COPILOT_GITHUB_TOKEN in Vercel & Cloud VM server env to enable Claude Haiku 5.5 fallback.",
  setupItemCopilotBtn: "Copilot token",
  setupItemDbVaultLabel: "Private database & encrypted vault",
  setupItemDbVaultReady:
    "Active automatically on Neon Postgres with AES-256-GCM encryption.",
  setupItemDbVaultAction: "Connect a Postgres store in Vercel.",
  setupItemVercelStoresBtn: "Vercel Stores",
  setupItemGoogleLabel: "Google Gmail, Calendar & Drive",
  setupItemGoogleConnected:
    "Connected (read & unsent drafts only — never sends emails or invites without you).",
  setupItemGoogleConnectPrompt:
    "Click Connect to link your Google account for read & draft help.",
  setupItemGoogleManualPrompt:
    "Create a Google OAuth client to enable one-click Google connection.",
  setupItemGoogleEnableApisBtn: "Enable Google APIs",
  setupItemGoogleCredsBtn: "Google Cloud Credentials",
  setupItemGithubLabel: "GitHub pull requests",
  setupItemGithubConnected:
    "Connected (read pull requests & prepare draft reviews).",
  setupItemGithubConnectPrompt: "Click Connect to link your GitHub account.",
  setupItemGithubOptionalPrompt:
    "Optional — create a fine-grained GitHub token if you want PR review drafts.",
  setupItemGithubCreateTokenBtn: "Create GitHub token",
  setupItemFirecrawlLabel: "Firecrawl web search, scrape & site map",
  setupItemFirecrawlReady:
    "Active via FIRECRAWL_API_KEY in Vercel environment variables — server-side search, clean URL-to-Markdown scrape, and site mapping.",
  setupItemFirecrawlOptional:
    "Optional — There is no in-app API key input field. Connect in 2 steps: 1) Get your key at firecrawl.dev. 2) Add FIRECRAWL_API_KEY in Vercel Environment Variables and redeploy.",
  setupItemFirecrawlManageBtn: "Manage key",
  firecrawlStep1Button: "1. Get Firecrawl key",
  firecrawlStep2VercelButton: "2. Vercel Env Variables",
  firecrawlNotConnectedTitle: "Firecrawl isn't connected yet",
  firecrawlSetupSteps:
    "There is no API key input field inside the app. Set it up in 2 steps: 1) Create an API key at firecrawl.dev. 2) Open Vercel Environment Variables, add FIRECRAWL_API_KEY, and redeploy.",
  firecrawlErrorFallback: "Firecrawl request could not finish.",
  firecrawlCardSearchTitle: "Firecrawl web search",
  firecrawlCardScrapeTitle: "Firecrawl page scrape",
  firecrawlCardMapTitle: "Firecrawl site map / crawl",
  firecrawlDiscoveredUrlsSuffix: "site URLs discovered.",
  setupItemGeminiLiveLabel: "Live voice conversations (Gemini 3.8 Live)",
  setupItemGeminiLiveVertexReady:
    "Active automatically via Google Cloud Vertex AI — no separate API key needed.",
  setupItemGeminiLiveKeyReady:
    "Active — hands-free voice runs on Gemini 3.8 Live.",
  setupItemGeminiLiveAction:
    "Configure Google Cloud Vertex AI WIF to enable hands-free voice.",
  setupItemGeminiLiveBtn: "Vertex AI",
  setupItemCloudVmLabel: "Cloud Computer (Linux VM)",
  setupItemCloudVmReady:
    "Active on Google Cloud (auto-wakes on demand for sandbox & browser runs).",
  setupItemCloudVmOptional:
    "Optional — connect your Google Cloud sandbox relay for remote Linux & browser runs.",
  setupItemMacBridgeLabel: "Mac mini Tailscale bridge (tmux)",
  setupItemMacBridgeReady:
    "Connected via private Tailscale SSH (non-admin botrunner, logged tmux sessions).",
  setupItemMacBridgeOptional:
    "Optional — install standalone tailscaled and run ops/mac-bridge/setup-mac-bridge.sh.",
  setupItemRedisLabel: "Background stream resume & rate limits",
  setupItemRedisReady:
    "Active via Vercel Redis (ephemeral rate limits & mid-stream resume only — zero permanent data).",
  setupItemRedisUnreachable:
    "Redis URL is set, but the store could not be reached.",
  setupItemRedisOptional:
    "Optional — add a Redis store in Vercel only if you want mid-stream mobile reconnects.",
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
  modelAutoName: "Otomatik",
  modelAutoDescription: "Hydrogen günlük / Neon zor ve araştırma",
  modelNeonDescription:
    "Her zaman Gemini 4 Neon — derin analiz, araştırma ve görsel üretim",
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
  toastGithubConnected: "GitHub bağlandı.",
  toastGoogleDisconnected: "Google Workspace bağlantısı kesildi.",
  toastGithubDisconnected: "GitHub bağlantısı kesildi.",
  // Setup checklist & Firecrawl card
  setupHeading: "Kurulum kontrol listesi",
  setupSubtitle:
    "Temel sohbet, canlı ses, web araması ve görseller otomatik çalışır. Taslak yardımı istediğinizde kişisel uygulamalarınızı aşağıdan bağlayabilirsiniz.",
  setupLoadError: "Kurulum durumu şu an yüklenemedi.",
  setupRetry: "Tekrar dene",
  setupReconnect: "Yeniden bağla",
  setupDisconnect: "Bağlantıyı kes",
  setupConnect: "Bağla",
  setupReady: "Hazır",
  setupConnected: "Bağlı",
  setupOptional: "İsteğe bağlı",
  setupOpen: "Aç",
  setupItemCoreAiLabel: "Sohbet, web araması, ses ve görseller",
  setupItemCoreAiReady:
    "Google Cloud Vertex AI üzerinden otomatik olarak aktif (Gemini 4 Hydrogen -> Neon yönlendirmesi — uygulama içi kota yok).",
  setupItemCoreAiAction:
    "Vercel proje ayarlarında Vertex AI WIF (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE) değişkenlerini tanımlayın.",
  setupItemCoreAiBtn: "Vercel'i aç",
  setupItemGcpBillingLabel: "Google Cloud Faturalandırma (Vertex)",
  setupItemGcpBillingUnavailable:
    "Gerçek maliyet ve krediler doğrudan Google Cloud Billing üzerinden takip edilir. Ay içi verileri burada da görmek isterseniz Cloud Billing + BigQuery Billing Export'u etkinleştirin.",
  setupItemGcpBillingBtnEnable: "Fatura API'lerini aç",
  setupItemGcpBillingBtnGrant: "Fatura görüntüleme izni ver",
  setupItemGcpBillingBtnExport: "Fatura aktarımını aç",
  setupItemGcpBillingBtnOpen: "Cloud Billing'i aç",
  setupItemCopilotLabel: "Copilot Claude Haiku 5.5 yedek modeli (Bulut VM)",
  setupItemCopilotReady:
    "Bulut VM köprüsü üzerinden aktif (COPILOT_GITHUB_TOKEN tanımlı — yalnızca Vertex hata veya zaman aşımı durumunda devreye girer).",
  setupItemCopilotNeedToken:
    "Vercel ve Bulut VM sunucu ortam değişkenlerine COPILOT_GITHUB_TOKEN (Copilot Requests izinli GitHub belirteci) ekleyin.",
  setupItemCopilotNeedVm:
    "Claude Haiku 5.5 yedek modelini açmak için Bulut Bilgisayar VM bağlantısını kurun ve COPILOT_GITHUB_TOKEN ekleyin.",
  setupItemCopilotBtn: "Copilot belirteci",
  setupItemDbVaultLabel: "Özel veritabanı ve şifreli kasa",
  setupItemDbVaultReady:
    "Neon Postgres üzerinde AES-256-GCM şifreleme ile otomatik olarak aktif.",
  setupItemDbVaultAction: "Vercel üzerinden bir Postgres veritabanı bağlayın.",
  setupItemVercelStoresBtn: "Vercel Depoları",
  setupItemGoogleLabel: "Google Gmail, Takvim ve Drive",
  setupItemGoogleConnected:
    "Bağlı (yalnızca okuma ve gönderilmemiş taslaklar — izniniz olmadan e-posta veya davet göndermez).",
  setupItemGoogleConnectPrompt:
    "Okuma ve taslak yardımı için Google hesabınızı bağlamak üzere Bağla'ya dokunun.",
  setupItemGoogleManualPrompt:
    "Tek dokunuşla Google bağlantısı için bir Google OAuth istemcisi oluşturun.",
  setupItemGoogleEnableApisBtn: "Google API'lerini aç",
  setupItemGoogleCredsBtn: "Google Cloud Kimlik Bilgileri",
  setupItemGithubLabel: "GitHub Pull Request'leri",
  setupItemGithubConnected:
    "Bağlı (pull request'leri okur ve taslak incelemeler hazırlar).",
  setupItemGithubConnectPrompt:
    "GitHub hesabınızı bağlamak için Bağla'ya dokunun.",
  setupItemGithubOptionalPrompt:
    "İsteğe bağlı — PR taslak incelemeleri istiyorsanız ince ayarlı bir GitHub belirteci oluşturun.",
  setupItemGithubCreateTokenBtn: "GitHub belirteci oluştur",
  setupItemFirecrawlLabel:
    "Firecrawl web araması, sayfa okuma ve site haritası",
  setupItemFirecrawlReady:
    "Vercel ortam değişkenlerindeki FIRECRAWL_API_KEY ile aktif — sunucu taraflı arama, temiz URL-Markdown okuma ve site haritası.",
  setupItemFirecrawlOptional:
    "İsteğe bağlı — Uygulama içinde API anahtarı giriş alanı yoktur. 2 adımda bağlayın: 1) firecrawl.dev üzerinden anahtar alın. 2) Vercel Ortam Değişkenleri sayfasında FIRECRAWL_API_KEY olarak ekleyip yeniden dağıtın (redeploy).",
  setupItemFirecrawlManageBtn: "Anahtarı yönet",
  firecrawlStep1Button: "1. Firecrawl anahtarı al",
  firecrawlStep2VercelButton: "2. Vercel Ortam Değişkenleri",
  firecrawlNotConnectedTitle: "Firecrawl bağlı değil",
  firecrawlSetupSteps:
    "Uygulama içinde API anahtarı girilecek bir alan yoktur. 2 adımda bağlayın: 1) firecrawl.dev üzerinden API anahtarı oluşturun. 2) Vercel Ortam Değişkenleri sayfasını açıp FIRECRAWL_API_KEY olarak ekleyin ve yeniden dağıtın (redeploy).",
  firecrawlErrorFallback: "Firecrawl isteği tamamlanamadı.",
  firecrawlCardSearchTitle: "Firecrawl web araması",
  firecrawlCardScrapeTitle: "Firecrawl sayfa okuma (Markdown)",
  firecrawlCardMapTitle: "Firecrawl site haritası / tarama",
  firecrawlDiscoveredUrlsSuffix: "sayfa bağlantısı keşfedildi.",
  setupItemGeminiLiveLabel: "Canlı sesli sohbet (Gemini 3.8 Live)",
  setupItemGeminiLiveVertexReady:
    "Google Cloud Vertex AI üzerinden otomatik olarak aktif — ayrı API anahtarı gerekmez.",
  setupItemGeminiLiveKeyReady:
    "Aktif — eller serbest sesli sohbet Gemini 3.8 Live üzerinde çalışır.",
  setupItemGeminiLiveAction:
    "Eller serbest sesli sohbet için Google Cloud Vertex AI WIF yapılandırın.",
  setupItemGeminiLiveBtn: "Vertex AI",
  setupItemCloudVmLabel: "Bulut Bilgisayar (Linux VM)",
  setupItemCloudVmReady:
    "Google Cloud üzerinde aktif (görev geldiğinde otomatik uyanır).",
  setupItemCloudVmOptional:
    "İsteğe bağlı — uzak Linux ve tarayıcı çalıştırmak için Google Cloud sandbox köprüsünü bağlayın.",
  setupItemMacBridgeLabel: "Mac mini Tailscale köprüsü (tmux)",
  setupItemMacBridgeReady:
    "Özel Tailscale SSH üzerinden bağlı (yönetici olmayan botrunner, kayıtlı tmux oturumları).",
  setupItemMacBridgeOptional:
    "İsteğe bağlı — bağımsız tailscaled kurun ve ops/mac-bridge/setup-mac-bridge.sh betiğini çalıştırın.",
  setupItemRedisLabel: "Arka plan akış devamı ve hız sınırları",
  setupItemRedisReady:
    "Vercel Redis üzerinden aktif (yalnızca geçici hız sınırları ve akış devamı — kalıcı veri tutulmaz).",
  setupItemRedisUnreachable: "Redis adresi tanımlı ancak depoya ulaşılamadı.",
  setupItemRedisOptional:
    "İsteğe bağlı — mobilde yarım kalan akışların devamı için Vercel'de bir Redis deposu ekleyin.",
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

export type SetupChecklistItemLike = {
  id: string;
  label: string;
  summary: string;
  status: "ready" | "action_needed" | "optional";
  actionKind: "none" | "connect_google" | "connect_github" | "external_link";
  externalUrl?: string;
  externalLabel?: string;
  secondaryExternalUrl?: string;
  secondaryExternalLabel?: string;
  connectedProvider?: "google" | "github";
  variant?: string;
  meta?: {
    disabledServices?: string[];
    projectNumber?: string | null;
    billingUsedUsd?: number;
    billingRemainingUsd?: number | null;
    billingMissingCode?: CloudBillingMissingCode | null;
    billingMissingDetail?: string | null;
    billingMissingReason?: string | null;
    billingProjectId?: string | null;
    billingAccountId?: string | null;
  };
};

/**
 * Localizes any Setup checklist item into the active UI locale (`en` or `tr`)
 * using `lib/ui-copy.ts` so the Setup/Kurulum page never renders hardcoded
 * English leftovers in Turkish mode.
 */
export function formatSetupChecklistItemCopy(
  item: SetupChecklistItemLike,
  locale: UiLocale = DEFAULT_UI_LOCALE
): {
  label: string;
  summary: string;
  externalLabel?: string;
  secondaryExternalLabel?: string;
} {
  const copy = getCopy(locale);
  const v = item.variant;
  switch (item.id) {
    case "core_ai":
      return {
        label: copy.setupItemCoreAiLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemCoreAiReady
            : copy.setupItemCoreAiAction,
        externalLabel:
          item.actionKind === "external_link"
            ? copy.setupItemCoreAiBtn
            : undefined,
      };

    case "gcp_billing": {
      const m = item.meta;
      let summary: string;
      if (item.status === "ready" && m?.billingUsedUsd !== undefined) {
        const used = `$${m.billingUsedUsd.toFixed(2)}`;
        if (
          typeof m.billingRemainingUsd === "number" &&
          Number.isFinite(m.billingRemainingUsd)
        ) {
          const rem = `$${m.billingRemainingUsd.toFixed(2)}`;
          summary =
            locale === "tr"
              ? `Canlı Google Cloud fatura akışı aktif — bu ay ${used} kullanıldı, ${rem} bütçe kaldı (1 saat önbellekli).`
              : `Live Google Cloud billing active — ${used} used this month, ${rem} budget remaining (1h cached).`;
        } else {
          summary =
            locale === "tr"
              ? `Canlı Google Cloud fatura akışı aktif — bu ay ${used} kullanım kaydedildi (1 saat önbellekli).`
              : `Live Google Cloud billing active — ${used} usage recorded this month (1h cached).`;
        }
      } else if (m?.billingMissingCode || m?.billingMissingReason) {
        summary = formatCloudBillingUnavailableReason(
          {
            missingCode: m.billingMissingCode,
            missingDetail: m.billingMissingDetail,
            missingReason: m.billingMissingReason,
            projectId: m.billingProjectId,
            billingAccountId: m.billingAccountId,
          },
          locale
        );
      } else {
        summary = copy.setupItemGcpBillingUnavailable;
      }

      const rawBtn = (item.externalLabel ?? "").toLowerCase();
      const externalLabel = rawBtn.includes("grant")
        ? copy.setupItemGcpBillingBtnGrant
        : rawBtn.includes("export")
          ? copy.setupItemGcpBillingBtnExport
          : rawBtn.includes("open")
            ? copy.setupItemGcpBillingBtnOpen
            : copy.setupItemGcpBillingBtnEnable;
      return {
        label: copy.setupItemGcpBillingLabel,
        summary,
        externalLabel,
      };
    }

    case "copilot_fallback":
      return {
        label: copy.setupItemCopilotLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemCopilotReady
            : v === "copilot_need_token"
              ? copy.setupItemCopilotNeedToken
              : copy.setupItemCopilotNeedVm,
        externalLabel: copy.setupItemCopilotBtn,
      };

    case "database_vault":
      return {
        label: copy.setupItemDbVaultLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemDbVaultReady
            : copy.setupItemDbVaultAction,
        externalLabel:
          item.actionKind === "external_link"
            ? copy.setupItemVercelStoresBtn
            : undefined,
      };

    case "google_workspace": {
      if (v === "service_disabled" && item.meta?.disabledServices?.length) {
        const list = item.meta.disabledServices.join(", ");
        const proj = item.meta.projectNumber
          ? locale === "tr"
            ? ` (#${item.meta.projectNumber} numaralı projede)`
            : ` on project #${item.meta.projectNumber}`
          : "";
        return {
          label: copy.setupItemGoogleLabel,
          summary:
            locale === "tr"
              ? `Google hesabı bağlı — ${list} API'lerini${proj} bir kez etkinleştirin.`
              : `Google account connected — enable ${list} API${proj} once.`,
          externalLabel: copy.setupItemGoogleEnableApisBtn,
        };
      }
      if (item.connectedProvider === "google" || item.status === "ready") {
        return {
          label: copy.setupItemGoogleLabel,
          summary: copy.setupItemGoogleConnected,
        };
      }
      if (item.actionKind === "connect_google") {
        return {
          label: copy.setupItemGoogleLabel,
          summary: copy.setupItemGoogleConnectPrompt,
        };
      }
      return {
        label: copy.setupItemGoogleLabel,
        summary: item.externalLabel?.toLowerCase().includes("enable")
          ? item.summary
          : copy.setupItemGoogleManualPrompt,
        externalLabel: item.externalLabel?.toLowerCase().includes("enable")
          ? copy.setupItemGoogleEnableApisBtn
          : copy.setupItemGoogleCredsBtn,
      };
    }

    case "github":
      return {
        label: copy.setupItemGithubLabel,
        summary:
          item.connectedProvider === "github" || item.status === "ready"
            ? copy.setupItemGithubConnected
            : item.actionKind === "connect_github"
              ? copy.setupItemGithubConnectPrompt
              : copy.setupItemGithubOptionalPrompt,
        externalLabel:
          item.actionKind === "external_link"
            ? copy.setupItemGithubCreateTokenBtn
            : undefined,
      };

    case "firecrawl":
      return {
        label: copy.setupItemFirecrawlLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemFirecrawlReady
            : copy.setupItemFirecrawlOptional,
        externalLabel:
          item.status === "ready"
            ? copy.setupItemFirecrawlManageBtn
            : copy.firecrawlStep1Button,
        secondaryExternalLabel:
          item.status === "ready" ? undefined : copy.firecrawlStep2VercelButton,
      };

    case "gemini_live":
      return {
        label: copy.setupItemGeminiLiveLabel,
        summary:
          v === "vertex_ready" || item.status === "ready"
            ? v === "gemini_key_fallback"
              ? copy.setupItemGeminiLiveKeyReady
              : copy.setupItemGeminiLiveVertexReady
            : copy.setupItemGeminiLiveAction,
        externalLabel:
          item.actionKind === "external_link"
            ? copy.setupItemGeminiLiveBtn
            : undefined,
      };

    case "cloud_computer":
      return {
        label: copy.setupItemCloudVmLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemCloudVmReady
            : copy.setupItemCloudVmOptional,
      };

    case "mac_bridge":
      return {
        label: copy.setupItemMacBridgeLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemMacBridgeReady
            : copy.setupItemMacBridgeOptional,
      };

    case "redis_store":
      return {
        label: copy.setupItemRedisLabel,
        summary:
          item.status === "ready"
            ? copy.setupItemRedisReady
            : v === "unreachable"
              ? copy.setupItemRedisUnreachable
              : copy.setupItemRedisOptional,
        externalLabel:
          item.actionKind === "external_link"
            ? copy.setupItemVercelStoresBtn
            : undefined,
      };

    default:
      return {
        label: item.label,
        summary: item.summary,
        externalLabel: item.externalLabel,
        secondaryExternalLabel: item.secondaryExternalLabel,
      };
  }
}
