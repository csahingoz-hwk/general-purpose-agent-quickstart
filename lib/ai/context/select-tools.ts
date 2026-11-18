import { isGithubConnectorEnabled } from "@/lib/connectors/calendar-and-github";
import { isGoogleConnectorsEnabled } from "@/lib/connectors/google-vault-auth";
import { isRoutinesEnabled } from "@/lib/cron/routine-presets";
import { isMediaStudioEnabled } from "@/lib/media/media-studio";
import { isMemoryToolsEnabled } from "@/lib/memory/store";
import type { ChatMessage } from "@/lib/types";

export const AVAILABLE_CHAT_TOOLS = [
  "getWeather",
  "getCurrentTime",
  "setHomeLocation",
  "demoInbox",
  "createDocument",
  "editDocument",
  "updateDocument",
  "requestSuggestions",
  "scheduleTask",
  "listMySchedules",
  "cancelSchedule",
  "setSoul",
  "webSearch",
  "getFixtures",
  "draftOutboundMessage",
  "askUserQuestion",
  "saveProfileFact",
  "addJournalEntry",
  "recallMemories",
  "gmailReadMessages",
  "driveReadFiles",
  "gmailCreateDraft",
  "driveCreateDraftDoc",
  "calendarReadEvents",
  "calendarCreateDraftEvent",
  "githubReadPullRequests",
  "githubCreateDraftReview",
  "generateImageAsset",
  "generateVideoClip",
  "delegateTask",
  "cloudExec",
  "cloudWriteFile",
  "cloudReadFile",
  "cloudExportFileToChat",
  "cloudBrowseUrl",
  "macExec",
  "macRunAgentCli",
] as const;

export type ChatToolName = (typeof AVAILABLE_CHAT_TOOLS)[number];

const WEATHER_PATTERN =
  /weather|forecast|temperature|rain|havadurumu|hava durumu|hava nasıl|hava nasil|yağmur|sıcaklık|sicaklik|kaç derece|kac derece/;

const CLOCK_PATTERN =
  /\b(what time|current time|time is it|what day|today'?s date|what'?s the date|date today|time zone|timezone|daylight saving|dst|clocks? (go|change))\b|saat kaç|saat kac|saat dilimi|yaz saati|kış saati|bugün günlerden|bugünün tarihi|tarih ne|günlerden ne/;

/**
 * Explicit "please search" phrasing. Turkish words use unicode-aware boundaries
 * because JS \b is ASCII-only ("güncelle" must not match "güncel"; "para" and
 * "araba" must not match "ara").
 */
const SEARCH_PATTERN_EN =
  /\b(search|look(?:ing)? (?:it |this |that |them )?up|google(?!\s+(?:drive|calendar|docs?|sheets?|slides?|workspace|account|cloud|ai))|find (?:it |this |that |out )?(?:online|on the web)|on the web|web search|latest|news|breaking|who won|(?:current|today'?s|live) (?:price|prices|score|scores|result|results|rate|rates|exchange rate)|exchange rate|stock price|share price)\b/;
const SEARCH_PATTERN_TR =
  /(?<![\p{L}])(?:ara|arar mısın|arama yap\p{L}*|araştır\p{L}*|internette|internetten|güncel|haber|haberler\p{L}*|haberi|son dakika|bugünkü|bugunku|kim kazandı|maç sonucu|dolar kaç|euro kaç|altın fiyat\p{L}*)(?![\p{L}])/u;

/**
 * Fallback for live facts the explicit "search" verbs miss: fixtures, prices,
 * news, years, and club names, in English and Turkish.
 */
const FACT_PATTERN_EN =
  /\b(next (?:match|game|fixture)|fixtures?|kick-?off|line-?ups?|standings|when (?:is|are|does|do|'s)|who(?:'s| is| are)|how much|(?:ticket |stock |share )?prices?|scores?|202[4-9]|2030|galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|trabzonspor|real madrid|barcelona|manchester (?:united|city)|liverpool|arsenal|chelsea|bayern|juventus|psg|premier league|champions league|s[uü]per lig|nba|nfl)\b/;
const FACT_PATTERN_TR =
  /(?<![\p{L}])(?:ma[cç](?!\s*mini)\p{L}*|fikst[uü]r\p{L}*|ne zaman|bi(?:r)? dahaki|sonraki ma\p{L}*|gelecek ma\p{L}*|kimdir|kim kazan\p{L}*|fiyat\p{L}*|ne kadar|ka[cç] para|puan durumu|skor\p{L}*|202[4-9]|2030|galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|trabzonspor)(?![\p{L}])/u;

const CHITCHAT_PATTERN =
  /^(?:merhaba|selam|selamlar|hey|hi|hello|thanks|thank you|teşekkür(?:ler)?|tesekkur(?:ler)?|günaydın|gunaydin|iyi geceler|nasılsın|nasilsin|how are you|ok|okay|tamam)[!.?\s]*$|\b(?:tell me a joke|explain this clearly|help me plan my day|para biriktirmek|ne yapmal[ıi]y[ıi]m|what should i (?:do|say))\b|şaka yap|fıkra anlat|fikra anlat/;

const DOCUMENT_PATTERN =
  /\b(document|artifact|spreadsheet|script|excel file|csv file|write a file|create a file)\b|belge|doküman|dosya oluştur|dosya yarat|tablo dosyası/;

const FIXTURE_PATTERN_EN =
  /\b(next|upcoming|last|latest)\b.{0,40}\b(match|game|fixture|kick-?off|result|score)\b|\b(match|game|fixture|kick-?off)\b.{0,40}\b(next|upcoming|when|score|result)\b|\b(score|result)\b.{0,40}\b(match|game|fixture)\b|\bfixtures?\b|\bkick-?off\b/i;
const FIXTURE_PATTERN_TR =
  /(?<![\p{L}])(?:sıradaki|siradaki|bir sonraki|bi(?:r)? dahaki|sonraki ma\p{L}*|gelecek ma\p{L}*|fikst[uü]r\p{L}*|maç sonucu|mac sonucu|son ma\p{L}*|sonuç|sonuc|skor\p{L}*|ne zaman.{0,40}ma[cç]|ma[cç]\p{L}*.{0,24}ne zaman)(?![\p{L}])/iu;

const LOCAL_COMMAND_PATTERN =
  /\b(demo|mock|fictional|sample|test inbox|my home city|set my city|my city is|i live in|i'?m based in|home is in|my schedules|scheduled tasks|recurring tasks|cancel schedule|schedule a task|schedule a routine|create a routine|customize your personality|change your personality|remember my preferred style|set your personality|draft an? email|draft a message|draft a slack|draft a telegram|prepare an? outbound draft|ask me a clarifying question|give me clickable options|save to my profile|save (?:this )?to (?:my )?memory|remember this|remember:|keep in mind:|log in my journal|search my memory|recall from memory|check (?:my )?gmail|read (?:my )?gmail|search (?:my )?gmail|create (?:a )?gmail draft|save (?:a )?draft in gmail|search (?:my )?(?:google )?drive|read (?:from )?(?:my )?(?:google )?drive|list (?:my )?(?:google )?drive files|create (?:a )?(?:google )?drive draft|save (?:a )?draft (?:doc|document) in (?:google )?drive|check (?:my )?(?:google )?calendar|upcoming calendar events|read (?:my )?calendar|create (?:a )?(?:google )?calendar draft|draft (?:a )?calendar event|list (?:open )?(?:github )?(?:prs|pull requests)|read (?:github )?(?:prs|pull requests)|check github prs|draft (?:a )?(?:github )?(?:pr|pull request) review|create (?:a )?github draft review|generate (?:an? )?(?:image|illustration|picture|poster|video|video clip)|create (?:an? )?(?:image|video clip))\b|hayal[iî]|örnek gelen kutusu|sahte e.?posta|ev şehrim|şehrim|yaşıyorum|zamanlanmış görev|planlanmış görev|görevlerimi listele|görevi iptal|rutin oluştur|kişiliğini değiştir|tarzını kaydet|kişiselleştir|taslak e-?posta hazırla|gönderim taslağı|bana seçenek kartı göster|bunu hatırla|hatırla:|unutma:|aklında tut|belleğe kaydet|belleğime kaydet|hafızaya kaydet|günlüğüme ekle|gmail(?:imi|'imi)? (?:kontrol et|oku|ara)|gmail taslağı oluştur|gmail'e taslak kaydet|(?:google )?drive(?:'da|da| dosyalarımı) (?:ara|listele|oku)|(?:google )?drive taslağı oluştur|drive'a taslak kaydet|takvimimi (?:kontrol et|oku)|yaklaşan etkinliklerim|takvim taslağı oluştur|github açık pr|github pr taslak inceleme|görsel üret|resim oluştur|video klibi oluştur/;

const MAC_BRIDGE_PATTERN =
  /\b(mac\s*mini|on\s+my\s+mac|mac\s+bridge|tailscale\s+ssh|claude\s+code|have\s+claude\b|have\s+codex\b|run\s+codex\b|run\s+agy\b|antigravity\s+cli|t3\s+cli|local\s+repo\b|git\s+status\s+on\s+(?:my\s+)?mac)\b|(?<![\p{L}])(?:mac'?imde|mac\s+mini'?de|yerel\s+repoda)(?![\p{L}])/iu;

const CLOUD_COMPUTER_PATTERN =
  /\b(cloud\s+(?:computer|vm|shell|sandbox)|linux\s+vm|in\s+\/workspace|\/workspace\/|clone\s+(?:the\s+|this\s+)?repo\b|run\s+(?:a\s+|the\s+)?(?:python|bash|shell|node)\b|headless\s+(?:browser|chromium)|scrape\s+https?:\/\/|export\s+.{1,40}\s+from\s+\/workspace)\b|(?<![\p{L}])(?:bulut\s+bilgisayar\p{L}*|linux\s+sunucu\p{L}*|python\s+script\p{L}*)(?![\p{L}])/iu;

const CLOUD_BROWSE_PATTERN =
  /\b(headless\s+(?:browser|chromium)|cloud\s+browser|scrape\s+https?:\/\/|open\s+https?:\/\/\S+\s+in\s+(?:the\s+)?browser|screenshot\s+of\s+https?:\/\/)\b|bulut\s+tarayıcı/iu;

const PRIVATE_PERSONAL_INTENT =
  /\b(did [\p{L}\s]{1,25} (?:e-?mail|write to|send an? e-?mail to) me|did [\p{L}\s]{1,25} send (?:me )?an? e-?mail|any (?:new |unread |recent )?e-?mails?|what'?s in my inbox|check (?:my )?(?:inbox|e-?mails?)|read (?:my )?(?:inbox|e-?mails?)|e-?mails? from |what'?s on my calendar|am i free |are you free |do i have (?:any )?(?:meetings?|appointments?|events?)|my meetings? (?:today|tomorrow|this week|on \w+)|(?:find|where is|locate) .{1,50} in (?:my )?(?:google )?drive|(?:any|check|list|are there(?: any)?) open (?:github )?(?:prs|pull requests)|what have you saved in (?:my )?memory|what do you remember about me|delegate (?:a |this )?task|create a task card|run (?:this )?in the background|background task)\b|(?<![\p{L}])(?:bana (?:e-?posta|mail) geldi m[ıi]|[\p{L}\s]{1,25} bana (?:yazd[ıi]|mail att[ıi]|e-?posta gönderdi) m[ıi]|[\p{L}']+['’]?(?:dan|den|tan|ten) (?:e-?posta|mail) var m[ıi]|okunmam[ıi]ş (?:e-?posta|mail)\p{L}*|gelen kutum\p{L}*|inbox['’]?(?:ta|da) ne var|mailimi kontrol et|maillerime bak|takvimimde ne var|haftaya takvimim nas[ıi]l|bugün (?:toplant[ıi]m|randevum) var m[ıi]|(?:yar[ıi]n|bugün|pazartesi|sal[ıi]|çarşamba|perşembe|cuma|cumartesi|pazar)\b.{0,30}(?:boş muyum|müsait miyim|uygun muyum)|drive['’]?(?:da|daki) .{1,40}(?:bul|ara|nerede|listele|oku|göster)|aç[ıi]k (?:pr|pull request)\p{L}* (?:var m[ıi]|kontrol et|listele)|hakk[ıi]mda ne (?:hat[ıi]rl[ıi]yorsun|biliyorsun)|beni hat[ıi]rl[ıi]yor musun|görev kart[ıi]|arka planda çal[ıi]şt[ıi]r|görev olarak başlat)(?![\p{L}])/iu;

/** Tools that change stored state; never offered in a turn that reads open-web content. */
const STATE_CHANGING_TOOLS: readonly ChatToolName[] = [
  "setHomeLocation",
  "setSoul",
  "scheduleTask",
  "cancelSchedule",
  "createDocument",
  "editDocument",
  "updateDocument",
  "requestSuggestions",
  "draftOutboundMessage",
  "saveProfileFact",
  "addJournalEntry",
  "gmailCreateDraft",
  "driveCreateDraftDoc",
  "calendarCreateDraftEvent",
  "githubCreateDraftReview",
  "generateImageAsset",
  "generateVideoClip",
  "delegateTask",
  "cloudExec",
  "cloudWriteFile",
  "macExec",
  "macRunAgentCli",
];

/**
 * Approval-gated unsent personal connector draft tools (`needsApproval: true`,
 * never send externally, and flag `hasUntrustedContext` in `reviewActionRisk`).
 * Allowed alongside authenticated personal connector reads (Gmail/Calendar/Drive/GitHub),
 * while silent state mutations and shell/VM execution remain excluded.
 */
const APPROVAL_GATED_CONNECTOR_DRAFT_TOOLS = new Set<ChatToolName>([
  "gmailCreateDraft",
  "driveCreateDraftDoc",
  "calendarCreateDraftEvent",
  "githubCreateDraftReview",
]);

const SYNTHETIC_DEMO_PATTERN =
  /\b(demo|mock|fictional|sample|synthetic|test inbox)\b|hayal[iî]|örnek|sahte/;

const PERSONAL_EMAIL_NOUN_PATTERN =
  /(?<![\p{L}])(?:gmail|inbox|gelen\s+kutu\p{L}*|e-?mail\p{L}*|e-?posta\p{L}*|eposta\p{L}*|mail\p{L}*)(?![\p{L}])/iu;

const PERSONAL_EMAIL_READ_CUE_PATTERN =
  /(?<![\p{L}])(?:inbox|gelen\s+kutu\p{L}*|okunmam[ıi]ş|unread|gelen|gönderdi\p{L}*|att[ıi]\p{L}*|yazd[ıi]\p{L}*|son|latest|last|recent|new|from|bul\p{L}*|oku\p{L}*|bak\p{L}*|kontrol|(?<!internette\s|internetten\s)ara|check|read|find|look\s+at|search(?!\s+(?:the\s+web|online)\b)|show|list|var\s+m[ıi]|geldi\s+m[ıi])(?![\p{L}])|['’](?:dan|den|tan|ten)\b/iu;

const PERSONAL_EMAIL_REPLY_DRAFT_CUE_PATTERN =
  /(?<![\p{L}])(?:cevap\s+tasla[ğg]\p{L}*|yan[ıi]t\s+tasla[ğg]\p{L}*|gmail\s+tasla[ğg]\p{L}*|gmail'?e\s+taslak)\b|\b(?:create\s+(?:a\s+)?gmail\s+draft|save\s+(?:a\s+)?draft\s+in\s+gmail|gmail\s+draft(?:\s+to|\s+reply)?|draft\s+(?:a\s+)?reply|reply\s+draft|response\s+draft|prepare\s+(?:a\s+)?response(?:\s+draft)?)\b/iu;

function hasPersonalEmailReadIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  if (
    /\b(did [\p{L}\s]{1,25} (?:e-?mail|write to|send an? e-?mail to) me|did [\p{L}\s]{1,25} send (?:me )?an? e-?mail|what'?s in my inbox)\b|(?<![\p{L}])(?:[\p{L}\s]{1,25} bana (?:yazd[ıi]|mail att[ıi]|e-?posta gönderdi) m[ıi]|gelen kutum\p{L}*|inbox['’]?(?:ta|da) ne var)(?![\p{L}])/iu.test(
      phrase
    )
  ) {
    return true;
  }
  return (
    PERSONAL_EMAIL_NOUN_PATTERN.test(phrase) &&
    PERSONAL_EMAIL_READ_CUE_PATTERN.test(phrase)
  );
}

function hasPersonalEmailDraftIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  if (PERSONAL_EMAIL_REPLY_DRAFT_CUE_PATTERN.test(phrase)) {
    return true;
  }
  return (
    hasPersonalEmailReadIntent(phrase) &&
    /(?<![\p{L}])(?:tasla[ğg]\p{L}*|cevap\p{L}*|yan[ıi]t\p{L}*|draft|reply|respond|response)(?![\p{L}])/iu.test(
      phrase
    )
  );
}

function hasPersonalCalendarReadIntent(phrase: string): boolean {
  return /\b(check (?:my )?(?:google )?calendar|upcoming calendar events|read (?:my )?calendar|what'?s on my calendar|am i free |do i have (?:any )?(?:meetings?|appointments?|events?)|my meetings? (?:today|tomorrow|this week|on \w+))\b|(?<![\p{L}])(?:takvim\p{L}*|yaklaşan etkinliklerim|toplant[ıi]lar[ıi]m\p{L}*|bugün (?:toplant[ıi]m|randevum) var m[ıi]|(?:yar[ıi]n|bugün|pazartesi|sal[ıi]|çarşamba|perşembe|cuma|cumartesi|pazar)\b.{0,30}(?:boş muyum|müsait miyim|uygun muyum))(?![\p{L}])/iu.test(
    phrase
  );
}

function hasPersonalDriveReadIntent(phrase: string): boolean {
  return /\b(search (?:my )?(?:google )?drive|read (?:from )?(?:my )?(?:google )?drive|(?:find|where is|locate) .{1,50} in (?:my )?(?:google )?drive|find in (?:my )?(?:google )?drive|list (?:my )?(?:google )?drive files)\b|(?:google )?drive(?:'da|da|'daki| dosyalar[ıi]m[ıi]) (?:ara|listele|oku|bul)|drive['’]?(?:da|daki) .{1,50}(?:bul\p{L}*|ara\p{L}*|nerede|listele\p{L}*|oku\p{L}*|göster\p{L}*)/iu.test(
    phrase
  );
}

function hasPersonalWorkspaceIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  return (
    PRIVATE_PERSONAL_INTENT.test(phrase) ||
    hasPersonalEmailReadIntent(phrase) ||
    hasPersonalEmailDraftIntent(phrase) ||
    hasPersonalCalendarReadIntent(phrase) ||
    hasPersonalDriveReadIntent(phrase)
  );
}

const POLITE_TASK_TR_ENDING_PATTERN =
  /(?<![\p{L}])(?:m[ıi]s[ıi]n(?:[ıi]z)?|m[uü]s[uü]n(?:[uü]z)?)(?:\s+l[üu]tfen)?[?.!\s]*$/iu;

const POLITE_TASK_EN_REQUEST_PATTERN =
  /\b(?:(?:can|could|would|will|may|might)\s+you|do\s+you\s+mind|would\s+you\s+mind)\b/iu;

function isPoliteTaskRequest(phrase: string): boolean {
  const trimmed = phrase.trim();
  return (
    POLITE_TASK_TR_ENDING_PATTERN.test(trimmed) ||
    POLITE_TASK_EN_REQUEST_PATTERN.test(trimmed)
  );
}

function userText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function normalizePhrase(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .toLocaleLowerCase("en")
    .normalize("NFC");
}

export function isFixtureQuestion(phrase: string): boolean {
  return FIXTURE_PATTERN_EN.test(phrase) || FIXTURE_PATTERN_TR.test(phrase);
}

function wantsLiveFacts(phrase: string): boolean {
  return (
    SEARCH_PATTERN_EN.test(phrase) ||
    SEARCH_PATTERN_TR.test(phrase) ||
    FACT_PATTERN_EN.test(phrase) ||
    FACT_PATTERN_TR.test(phrase)
  );
}

export function isOpenQuestion(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 8 || CHITCHAT_PATTERN.test(trimmed)) {
    return false;
  }
  if (isPoliteTaskRequest(trimmed)) {
    return false;
  }
  if (trimmed.includes("?")) {
    return true;
  }
  if (/\b(who|what|when|where|why|which|how)\b/.test(trimmed)) {
    return true;
  }
  return /(?<![\p{L}])(?:kim|ne|nerede|nereye|niye|niçin|nasıl|nasil|hangi)(?![\p{L}])/u.test(
    trimmed
  );
}

/**
 * Offer web search for questions that may need current public facts, and let
 * the model decide whether to call it. Weather, greetings, advice, clock
 * questions, polite task requests, and personal inbox/calendar/drive or local-tool
 * turns stay off webSearch.
 */
export function shouldOfferWebSearch(
  phrase: string,
  webSearchAvailable: boolean
): boolean {
  if (!webSearchAvailable || WEATHER_PATTERN.test(phrase)) {
    return false;
  }
  const explicitWebOverride =
    /\b(search the web|on the web|find online|web search)\b|internette|internetten/iu.test(
      phrase
    );
  if (hasPersonalWorkspaceIntent(phrase) && !explicitWebOverride) {
    return false;
  }
  const factual = wantsLiveFacts(phrase);
  if (CLOCK_PATTERN.test(phrase) && !factual) {
    return false;
  }
  if (CHITCHAT_PATTERN.test(phrase) && !factual) {
    return false;
  }
  const localOnly =
    (DOCUMENT_PATTERN.test(phrase) ||
      LOCAL_COMMAND_PATTERN.test(phrase) ||
      CLOUD_COMPUTER_PATTERN.test(phrase) ||
      CLOUD_BROWSE_PATTERN.test(phrase) ||
      MAC_BRIDGE_PATTERN.test(phrase)) &&
    !factual;
  if (localOnly) {
    return false;
  }
  return factual || isOpenQuestion(phrase);
}

export type SelectActiveToolsOptions = {
  /**
   * True when the signed-in owner has Google Workspace connected and healthy.
   * When true, `gmailReadMessages`, `gmailCreateDraft`, `calendarReadEvents`,
   * and `driveReadFiles` are always offered (with regex acting only as a
   * priority/ranking hint).
   */
  googleConnectedAndHealthy?: boolean;
};

/** Only offer the model tools relevant to what the owner actually asked. */
export function selectActiveTools(
  messages: ChatMessage[],
  canPersonalize: boolean,
  /**
   * True only when this request is served by a web-search-capable lane (see
   * webSearchLane in routing/catalog). On every other lane web search is never
   * offered, whatever the user types.
   */
  webSearchAvailable = false,
  options?: SelectActiveToolsOptions
): ChatToolName[] {
  const recentUserText = messages
    .filter((msg) => msg.role === "user")
    .slice(-4)
    .map(userText);
  const latest = recentUserText.at(-1) ?? "";
  // Carry weather context only for a short location/time follow-up. A new
  // explicit request (e.g. a fictional inbox) must not inherit previous tools.
  const phrase = normalizePhrase(latest);
  const elliptical =
    latest.length <= 55 &&
    latest.trim().split(/\s+/).length <= 6 &&
    !/^(please|show|explain|write|create|hello|hi|thanks|thank|merhaba|teşekkür|lütfen|göster)\b/i.test(
      latest
    ) &&
    !/inbox|mail|e.?posta|gelen kutusu|document|belge|demo|fictional/.test(
      phrase
    );
  const weatherPhrase = elliptical
    ? normalizePhrase(recentUserText.join(" "))
    : phrase;
  const enabled: ChatToolName[] = [];

  if (WEATHER_PATTERN.test(weatherPhrase)) {
    enabled.push("getWeather");
  }

  if (CLOCK_PATTERN.test(phrase)) {
    enabled.push("getCurrentTime");
  }

  if (isFixtureQuestion(phrase) && !WEATHER_PATTERN.test(phrase)) {
    enabled.push("getFixtures");
  }

  if (
    canPersonalize &&
    /\b(my home city|set my city|my city is|i live in|i'?m based in|home is in)\b|ev şehrim|şehrim|yaşıyorum|evim .* şehrinde/.test(
      phrase
    )
  ) {
    enabled.push("setHomeLocation");
  }

  if (
    /\b(demo|mock|fictional|sample|test inbox)\b|hayal[iî]|örnek gelen kutusu|sahte e.?posta/.test(
      phrase
    ) &&
    /inbox|mail|e.?posta|gelen kutusu|chart|grafik/.test(phrase)
  ) {
    enabled.push("demoInbox");
  }

  if (
    /\b(document|artifact|spreadsheet|script|excel file|csv file|write a file|create a file)\b|belge|doküman|dosya oluştur|dosya yarat|tablo dosyası/.test(
      phrase
    )
  ) {
    if (/suggestions|writing advice|öneri/.test(phrase)) {
      enabled.push("requestSuggestions");
    } else if (/rewrite|replace most|full rewrite|baştan yaz/.test(phrase)) {
      enabled.push("updateDocument");
    } else if (
      /\b(edit|update|revise|change|fix|modify)\b|düzenle|güncelle|değiştir/.test(
        phrase
      )
    ) {
      enabled.push("editDocument");
    } else {
      enabled.push("createDocument");
    }
  }

  if (
    /\b(my schedules|scheduled tasks|recurring tasks|cancel schedule)\b|zamanlanmış görev|planlanmış görev|görevlerimi listele|görevi iptal/.test(
      phrase
    )
  ) {
    enabled.push("listMySchedules");
    if (/cancel|delete|remove|iptal|sil/.test(phrase)) {
      enabled.push("cancelSchedule");
    }
  }

  if (
    canPersonalize &&
    /\b(customize your personality|change your personality|remember my preferred style|set your personality)\b|kişiliğini değiştir|tarzını kaydet|kişiselleştir/.test(
      phrase
    )
  ) {
    enabled.push("setSoul");
  }

  if (
    canPersonalize &&
    /\b(draft (?:an? )?(?:email|message|slack|telegram|webhook)|prepare (?:an? )?(?:outbound|email|slack|telegram) draft)\b|taslak (?:e-?posta|mesaj) hazırla|gönderim taslağı/.test(
      phrase
    )
  ) {
    enabled.push("draftOutboundMessage");
  }

  if (
    /\b(ask me (?:a )?clarifying question|give me clickable options|show (?:me )?choice card)\b|bana seçenek kartı göster|netleştirici soru sor/.test(
      phrase
    )
  ) {
    enabled.push("askUserQuestion");
  }

  if (
    canPersonalize &&
    isRoutinesEnabled() &&
    /\b(schedule a (?:task|routine)|create a routine|every weekday at)\b|rutin oluştur|her hafta içi saat/.test(
      phrase
    )
  ) {
    enabled.push("scheduleTask");
  }

  if (canPersonalize && MAC_BRIDGE_PATTERN.test(phrase)) {
    enabled.push("macExec", "macRunAgentCli");
  }

  if (canPersonalize && CLOUD_BROWSE_PATTERN.test(phrase)) {
    enabled.push("cloudBrowseUrl");
  } else if (canPersonalize && CLOUD_COMPUTER_PATTERN.test(phrase)) {
    enabled.push(
      "cloudExec",
      "cloudWriteFile",
      "cloudReadFile",
      "cloudExportFileToChat"
    );
  }

  if (
    canPersonalize &&
    /\b(delegate (?:a |this )?task|create a task card|run (?:this )?in the background|background task|start a task)\b|(?<![\p{L}])(?:görev kartı|arka planda çalıştır|görev olarak başlat)(?![\p{L}])/iu.test(
      phrase
    )
  ) {
    enabled.push("delegateTask");
  }

  if (canPersonalize && isMemoryToolsEnabled()) {
    if (
      /\b(save (?:this )?to (?:my )?(?:profile|memory)|remember (?:this(?:\s+fact)?|that\b)|store in (?:my )?(?:profile|memory)|keep in mind)\b|^\s*(?:please\s+)?remember\s*[:\-–—]|profilime kaydet|belleğe kaydet|belleğime kaydet|hafızaya kaydet|bunu hatırla|hatırla\s*[:\-–—]|unutma(?:\s+ki|\s*[:\-–—])|aklında tut/iu.test(
        phrase
      )
    ) {
      enabled.push("saveProfileFact");
    }
    if (
      /\b(log in my journal|add to my journal|journal entry)\b|günlüğüme ekle|günlük kaydı/i.test(
        phrase
      )
    ) {
      enabled.push("addJournalEntry");
    }
    if (
      /\b(search my memory|recall from memory|what do you remember|what have you saved in (?:my )?memory|check my journal)\b|belleğimi ara|hakkımda ne (?:hatırlıyorsun|biliyorsun)|beni hatırlıyor musun|günlüğümü kontrol et/iu.test(
        phrase
      )
    ) {
      enabled.push("recallMemories");
    }
  }

  if (canPersonalize && isGoogleConnectorsEnabled()) {
    const isSyntheticDemo = SYNTHETIC_DEMO_PATTERN.test(phrase);

    if (!isSyntheticDemo) {
      // Regex acts as a ranking hint (placing matched tools first) and unlocks
      // opt-in Calendar/Drive draft tools when requested.
      if (hasPersonalEmailReadIntent(phrase)) {
        enabled.push("gmailReadMessages");
      }
      if (hasPersonalEmailDraftIntent(phrase)) {
        enabled.push("gmailCreateDraft");
      }

      if (hasPersonalCalendarReadIntent(phrase)) {
        enabled.push("calendarReadEvents");
      }
      if (
        /\b(create (?:a )?(?:google )?calendar draft|draft (?:a )?calendar event)\b|takvim taslağı oluştur/.test(
          phrase
        )
      ) {
        enabled.push("calendarCreateDraftEvent");
      }

      if (hasPersonalDriveReadIntent(phrase)) {
        enabled.push("driveReadFiles");
      }
      if (
        /\b(create (?:a )?(?:google )?drive draft|save (?:a )?draft (?:doc|document) in (?:google )?drive)\b|(?:google )?drive taslağı oluştur|drive'a taslak kaydet/.test(
          phrase
        )
      ) {
        enabled.push("driveCreateDraftDoc");
      }

      // When the signed-in owner has Google connected and healthy, ALWAYS offer
      // Gmail read + draft and Calendar/Drive read tools regardless of phrasing.
      if (options?.googleConnectedAndHealthy === true) {
        enabled.push(
          "gmailReadMessages",
          "gmailCreateDraft",
          "calendarReadEvents",
          "driveReadFiles"
        );
      }
    }
  }

  if (canPersonalize && isGithubConnectorEnabled()) {
    if (
      /\b(draft (?:a )?(?:github )?(?:pr|pull request) review|create (?:a )?github draft review)\b|github pr taslak inceleme/.test(
        phrase
      )
    ) {
      enabled.push("githubCreateDraftReview");
    }
    if (
      /\b((?:list|check|read|any|are there(?: any)?) (?:open )?(?:github )?(?:prs|pull requests)|read (?:github )?(?:prs|pull requests)|check github prs)\b|github açık pr|(?<![\p{L}])açık (?:pr|pull request)\p{L}* (?:var mı|kontrol et|listele)(?![\p{L}])/iu.test(
        phrase
      )
    ) {
      enabled.push("githubReadPullRequests");
    }
  }

  if (canPersonalize && isMediaStudioEnabled()) {
    if (
      /\b(generate (?:an? )?(?:video|video clip)|create (?:an? )?video clip)\b|video klibi oluştur/.test(
        phrase
      )
    ) {
      enabled.push("generateVideoClip");
    } else if (
      /\b(generate (?:an? )?(?:image|illustration|picture|poster)|create (?:an? )?image)\b|görsel üret|resim oluştur/.test(
        phrase
      )
    ) {
      enabled.push("generateImageAsset");
    }
  }

  // Ensure any tool whose persisted approval just completed remains active for continuation
  // without offering webSearch on the approval-continuation step.
  const trailing = messages.at(-1);
  const approvedTools: ChatToolName[] = [];
  if (trailing?.role === "assistant") {
    for (const part of trailing.parts) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "approval-responded"
      ) {
        const toolName = part.type.slice(5) as ChatToolName;
        if ((AVAILABLE_CHAT_TOOLS as readonly string[]).includes(toolName)) {
          approvedTools.push(toolName);
        }
      }
    }
  }
  if (approvedTools.length > 0) {
    return [...new Set([...enabled, ...approvedTools])];
  }

  // Weather, clock, greetings, and pure edits never pay for a search. Anything
  // else that may need a live fact gets webSearch; the model chooses the call.
  // State-changing tools are dropped on those turns so untrusted pages cannot
  // sit beside a write. A turn that is only a document or local command keeps
  // that tool and does not search.
  if (shouldOfferWebSearch(phrase, webSearchAvailable)) {
    return [
      ...new Set([
        ...enabled.filter((name) => !STATE_CHANGING_TOOLS.includes(name)),
        "webSearch" as const,
      ]),
    ];
  }

  // Open-web headless browsing never sits alongside state-changing tools.
  if (enabled.includes("cloudBrowseUrl")) {
    return [
      ...new Set(
        enabled.filter((name) => !STATE_CHANGING_TOOLS.includes(name))
      ),
    ];
  }

  // Authenticated personal connector reads allow approval-gated unsent connector
  // drafts (`needsApproval: true`, `hasUntrustedContext: true`), while excluding
  // silent state mutations and VM/CLI execution tools.
  if (
    enabled.includes("gmailReadMessages") ||
    enabled.includes("driveReadFiles") ||
    enabled.includes("calendarReadEvents") ||
    enabled.includes("githubReadPullRequests")
  ) {
    return [
      ...new Set(
        enabled.filter(
          (name) =>
            !STATE_CHANGING_TOOLS.includes(name) ||
            APPROVAL_GATED_CONNECTOR_DRAFT_TOOLS.has(name)
        )
      ),
    ];
  }

  return [...new Set(enabled)];
}

export function needsArtifactInstructions(
  names: readonly ChatToolName[]
): boolean {
  return names.some((name) =>
    [
      "createDocument",
      "editDocument",
      "updateDocument",
      "requestSuggestions",
    ].includes(name)
  );
}
