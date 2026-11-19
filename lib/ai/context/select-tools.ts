import {
  type CapabilityManifest,
  connectedToolsFromManifest,
} from "@/lib/ai/capability-manifest";
import { isGithubConnectorEnabled } from "@/lib/connectors/calendar-and-github";
import { isGoogleConnectorsEnabled } from "@/lib/connectors/google-vault-auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
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
  "requestScreenHandoff",
  "macExec",
  "macRunAgentCli",
  "firecrawlSearch",
  "firecrawlScrape",
  "firecrawlCrawlMap",
  "buildHtmlPageOrDashboard",
  "createExcalidrawDiagram",
  "generateInfographic",
] as const;

export type ChatToolName = (typeof AVAILABLE_CHAT_TOOLS)[number];

const WEATHER_PATTERN =
  /weather|forecast|temperature|rain|havadurumu|hava durumu|hava nasıl|hava nasil|yağmur|sıcaklık|sicaklik|kaç derece|kac derece/;

const CLOCK_PATTERN =
  /\b(what time|current time|time is it|what day|today'?s date|what'?s the date|date today|time zone|timezone|daylight saving|dst|clocks? (go|change))\b|saat kaç|saat kac|saat dilimi|yaz saati|kış saati|bugün günlerden|bugünün tarihi|tarih ne|günlerden ne/;

/**
 * Explicit "please search the open web" phrasing (overrides local tool hints when
 * the user explicitly asks to search online).
 */
const EXPLICIT_OPEN_WEB_SEARCH_PATTERN =
  /\b(search (?:the web|online)|look(?:ing)? (?:it |this |that |them )?up|google(?!\s+(?:drive|calendar|docs?|sheets?|slides?|workspace|account|cloud|ai))|find (?:it |this |that |out )?(?:online|on the web)|on the web|web search)\b|(?<![\p{L}])(?:internette\s+ara\p{L}*|internetten\s+ara\p{L}*|internette|internetten|bunu\s+araştır\p{L}*)(?![\p{L}])/iu;

const SEARCH_PATTERN_EN =
  /\b(search|look(?:ing)? (?:it |this |that |them )?up|google(?!\s+(?:drive|calendar|docs?|sheets?|slides?|workspace|account|cloud|ai))|find (?:it |this |that |out )?(?:online|on the web)|on the web|web search|latest|news|breaking|who won|(?:current|today'?s|live) (?:price|prices|score|scores|result|results|rate|rates|exchange rate)|exchange rate|stock price|share price)\b/;

const SEARCH_PATTERN_TR =
  /(?<![\p{L}])(?:(?<!drive['’]?(?:da|daki)\s)ara(?!\s+beni)|arar mısın|arama yap\p{L}*|araştır\p{L}*|internette|internetten|güncel|haber|haberler\p{L}*|haberi|son dakika|bugünkü|bugunku|kim kazandı|maç sonucu|dolar\s+kaç|dolar\s+kac|euro\s+kaç|euro\s+kac|altın\s+fiyat\p{L}*)(?![\p{L}])/u;

/**
 * Live-fact signals: fixtures, prices, news, years, comparisons of products,
 * population/current-holder queries, and club names in English and Turkish.
 * Note: Turkish football match requires `ç` (`maç*`) or vowel-inflected ASCII `maci/macı`
 * so English/macOS `"mac"` / `"mac'imde"` / `"on my Mac"` never triggers live-fact search.
 */
const FACT_PATTERN_EN =
  /\b(next (?:match|game|fixture)|fixtures?|kick-?off|line-?ups?|standings|when (?:is|are|does|do|'s)|who(?:'s| is| are)|how (?:much|many)|(?:ticket |stock |share )?prices?|scores?|202[4-9]|2030|iphone\s+\d+|pixel\s+\d+|galaxy\s+s\d+|galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|trabzonspor|real madrid|barcelona|manchester (?:united|city)|liverpool|arsenal|chelsea|bayern|juventus|psg|premier league|champions league|s[uü]per lig|nba|nfl)\b/;

const FACT_PATTERN_TR =
  /(?<![\p{L}])(?:maç\p{L}*|mac[ıiuü]\p{L}*|fikst[uü]r\p{L}*|ne zaman|bi(?:r)? dahaki|sonraki ma[cç]\p{L}*|gelecek ma[cç]\p{L}*|kimdir|kim kazan\p{L}*|fiyat\p{L}*|ne kadar|ka[cç] para|puan durumu|skor\p{L}*|karşılaştır\p{L}*|kıyasla\p{L}*|iphone\s+\d+|pixel\s+\d+|202[4-9]|2030|galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|trabzonspor)(?![\p{L}])/u;

const CHITCHAT_PATTERN =
  /^(?:merhaba|selam|selamlar|hey|hi|hello|thanks|thank you|teşekkür(?:ler)?|tesekkur(?:ler)?|günaydın|gunaydin|iyi geceler|nasılsın(?:\s+bugün)?|nasilsin(?:\s+bugun)?|hey,?\s*how are you|hi,?\s*how are you|hello,?\s*how are you|how are you(?:\s+today)?|nasılsın\?\s*bugün ne yapıyorsun|ok|okay|tamam)[!.?\s]*$|\b(?:tell me a joke|explain this clearly|help me plan my day|para biriktirmek|ne yapmal[ıi]y[ıi]m|what should i (?:do|say))\b|şaka yap|fıkra anlat\p{L}*|fikra anlat\p{L}*/iu;

const DOCUMENT_PATTERN =
  /\b(document|artifact|spreadsheet|script|excel file|csv file|write a file|create a file)\b|(?<![\p{L}])(?:belge\p{L}*|doküman\p{L}*|dosya oluştur|dosya yarat|tablo dosyası)(?![\p{L}])/iu;

const FIXTURE_PATTERN_EN =
  /\b(next|upcoming|last|latest)\b.{0,40}\b(match|game|fixture|kick-?off|result|score)\b|\b(match|game|fixture|kick-?off)\b.{0,40}\b(next|upcoming|when|score|result)\b|\b(score|result)\b.{0,40}\b(match|game|fixture)\b|\bfixtures?\b|\bkick-?off\b/i;

const FIXTURE_PATTERN_TR =
  /(?<![\p{L}])(?:sıradaki|siradaki|bir sonraki|bi(?:r)? dahaki|sonraki ma[cç]\p{L}*|gelecek ma[cç]\p{L}*|fikst[uü]r\p{L}*|maç sonucu|mac sonucu|son ma[cç]\p{L}*|ma[cç]\s+skor\p{L}*|skor\p{L}*|ne zaman.{0,40}(?:maç\p{L}*|mac[ıiuü]\p{L}*)|(?:maç\p{L}*|mac[ıiuü]\p{L}*).{0,24}ne zaman)(?![\p{L}])/iu;

const MAC_BRIDGE_PATTERN =
  /\b(mac\s*mini\b|on\s+my\s+mac\b|in\s+my\s+local\s+repo\s+on\s+my\s+mac\b|my\s+mac\b|mac\s+bridge\b|tailscale\s+ssh\b|claude\s+code\b|have\s+claude\b|have\s+codex\b|run\s+codex\b|run\s+agy\b|antigravity\s+cli\b|t3\s+cli\b|local\s+repo\b|git\s+status\s+on\s+(?:my\s+)?mac\b)|(?<![\p{L}])(?:mac['’]?(?:im\p{L}*|de\p{L}*|te\p{L}*)|mac\s+mini(?:['’]?\p{L}*)?|yerel\s+repoda)(?![\p{L}])/iu;

const MAC_AGENT_CLI_PATTERN =
  /\b(claude(?:\s+code)?|codex|agy|antigravity(?:\s+cli)?|t3(?:\s+cli)?|cursor|copilot|fix\s+the\b|refactor\b|lint\s+errors?)\b/iu;

const CLOUD_COMPUTER_PATTERN =
  /\b(cloud\s+(?:computer|vm|shell|sandbox)|linux\s+vm|in\s+\/workspace|\/workspace\/|clone\s+(?:the\s+|this\s+)?repo\b|run\s+(?:a\s+|the\s+)?(?:python|bash|shell|node)\b|headless\s+(?:browser|chromium)|scrape\s+https?:\/\/|export\s+.{1,40}\s+from\s+\/workspace)\b|(?<![\p{L}])(?:bulut\s+bilgisayar\p{L}*|linux\s+sunucu\p{L}*|python\s+script\p{L}*)(?![\p{L}])/iu;

const CLOUD_BROWSE_PATTERN =
  /\b(headless\s+(?:browser|chromium)|cloud\s+browser|scrape\s+https?:\/\/|open\s+https?:\/\/\S+\s+in\s+(?:the\s+)?browser|screenshot\s+of\s+https?:\/\/)\b|bulut\s+tarayıcı/iu;

const SCREEN_HANDOFF_PATTERN =
  /\b(screen\s+handoff|log\s*(?:me\s+)?in\s+on\s+(?:the\s+)?cloud|sign\s+in\s+on\s+(?:the\s+)?cloud|2fa\s+on\s+(?:the\s+)?cloud|captcha\s+on\s+(?:the\s+)?cloud|cloud\s+screen\s+login)\b|bulut\s+ekran\p{L}*|ekranda\s+giriş/iu;

const FIRECRAWL_INTENT_PATTERN =
  /\bfirecrawl\b|\b(?:scrape|crawl|site\s*map|map\s+(?:the\s+)?(?:site|pages|urls|domain))\b.{0,80}https?:\/\/|https?:\/\/\S+.{0,60}\b(?:scrape|to\s+markdown|crawl|site\s*map)\b|\b(?:scrape|crawl)\s+(?:this\s+|the\s+)?(?:url|page|site|website|docs)\b|(?<![\p{L}])(?:sayfay[ıi]\s+kaz[ıi]\p{L}*|markdown['’]?a\s+çevir|site\s+haritas[ıi]\p{L}*|alt\s+sayfalar[ıi]\s+(?:listele|tara))(?![\p{L}])/iu;

const VISUAL_CREATE_VERB_PATTERN =
  /(?<![\p{L}])(?:draw|sketch|build|create|make|generate|design|render|produce|plot|write|çiz\p{L}*|oluştur\p{L}*|hazırla\p{L}*|yap\p{L}*|üret\p{L}*|tasarla\p{L}*)(?![\p{L}])/iu;

const HTML_DASHBOARD_NOUN_PATTERN =
  /\b(dashboard\w*|echarts|single[- ]file\s+html|html\s+(?:page|dashboard|report|briefing|card)\b)\b|(?<![\p{L}])(?:gösterge\s+paneli\p{L}*|veri\s+paneli\p{L}*|tek\s+dosya(?:lık)?\s+html|html\s+(?:sayfa\p{L}*|panel\p{L}*|rapor\p{L}*)|dashboard\p{L}*)(?![\p{L}])/iu;

const EXCALIDRAW_DIAGRAM_NOUN_PATTERN =
  /\b(excalidraw|diagram\w*|flowchart\w*|flow\s+chart\w*|sequence\s+diagram|architecture\s+diagram|system\s+diagram|er\s+diagram|org\s+chart|state\s+diagram|swimlane)\b|(?<![\p{L}])(?:diyagram\p{L}*|diagram\p{L}*|akış\s+şema\p{L}*|mimari\s+şema\p{L}*|organizasyon\s+şema\p{L}*|sistem\s+şema\p{L}*)(?![\p{L}])/iu;

const INFOGRAPHIC_NOUN_PATTERN =
  /\b(infographic\w*|info-graphic\w*)\b|(?<![\p{L}])(?:infografik\p{L}*|bilgi\s+grafi[ğg]\p{L}*)(?![\p{L}])/iu;

function hasHtmlDashboardIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  if (
    /\becharts\b|\bsingle[- ]file\s+html\b|tek\s+dosya(?:lık)?\s+html/iu.test(
      phrase
    )
  ) {
    return true;
  }
  return (
    HTML_DASHBOARD_NOUN_PATTERN.test(phrase) &&
    VISUAL_CREATE_VERB_PATTERN.test(phrase)
  );
}

function hasExcalidrawDiagramIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  if (/\bexcalidraw\b/iu.test(phrase)) {
    return true;
  }
  return (
    EXCALIDRAW_DIAGRAM_NOUN_PATTERN.test(phrase) &&
    VISUAL_CREATE_VERB_PATTERN.test(phrase)
  );
}

function hasInfographicIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  return (
    INFOGRAPHIC_NOUN_PATTERN.test(phrase) &&
    VISUAL_CREATE_VERB_PATTERN.test(phrase)
  );
}

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
  "buildHtmlPageOrDashboard",
  "createExcalidrawDiagram",
  "generateInfographic",
];

/**
 * Approval-gated unsent personal connector draft tools & routine scheduler
 * (`needsApproval: true`, never send externally without approval, and flag
 * `hasUntrustedContext` in `reviewActionRisk`). Allowed alongside authenticated
 * personal connector reads (Gmail/Calendar/Drive/GitHub), while silent state
 * mutations and shell/VM/delegate execution remain excluded.
 */
const APPROVAL_GATED_CONNECTOR_DRAFT_TOOLS = new Set<ChatToolName>([
  "gmailCreateDraft",
  "driveCreateDraftDoc",
  "calendarCreateDraftEvent",
  "githubCreateDraftReview",
  "scheduleTask",
]);

const SYNTHETIC_DEMO_PATTERN =
  /\b(demo|mock|fictional|sample|synthetic|test inbox)\b|hayal[iî]|örnek|sahte/;

const PERSONAL_EMAIL_NOUN_PATTERN =
  /(?<![\p{L}])(?:gmail(?:['’]?\p{L}*)?|inbox(?:['’]?\p{L}*)?|gelen\s+kutu\p{L}*|e-?mail\p{L}*|e-?posta\p{L}*|eposta\p{L}*|mail\p{L}*)(?![\p{L}])/iu;

const PERSONAL_EMAIL_READ_CUE_PATTERN =
  /(?<![\p{L}])(?:inbox\p{L}*|gelen\s+kutu\p{L}*|okunmam[ıi]ş|unread|gelen|gönderdi\p{L}*|att[ıi]\p{L}*|yazd[ıi]\p{L}*|son|newest|latest|last|recent|new|from|bul\p{L}*|oku\p{L}*|bak\p{L}*|göster\p{L}*|özetle\p{L}*|kontrol|(?<!internette\s|internetten\s)ara|check|read|find|look\s+at|summarize|search(?!\s+(?:the\s+web|online)\b)|show|list|var\s+m[ıi]|geldi\s+m[ıi])(?![\p{L}])|['’](?:dan|den|tan|ten|da|de|ta|te|ımda|imde)\b/iu;

const PERSONAL_EMAIL_DRAFT_CUE_PATTERN =
  /(?<![\p{L}])(?:(?:cevap|yan[ıi]t|mail|e-?mail|e-?posta|eposta|gmail)\s+tasla[ğg]\p{L}*|taslak\s+(?:e-?posta|e-?mail|mail)\p{L}*|gmail'?e\s+taslak)(?![\p{L}])|\b(?:(?:draft|write|prepare)\s+(?:an?\s+)?e-?mail\b|create\s+(?:a\s+)?gmail\s+draft|save\s+(?:a\s+)?draft\s+in\s+gmail|gmail\s+draft(?:\s+to|\s+reply)?|draft\s+(?:a\s+)?reply|reply\s+to\s+(?:the\s+)?(?:last|latest|newest|recent)?\s*(?:e-?mail|message)|reply\s+draft|response\s+draft|prepare\s+(?:a\s+)?response(?:\s+draft)?)\b/iu;

const NON_EMAIL_OUTBOUND_DRAFT_PATTERN =
  /\b(?:draft\s+(?:an?\s+)?(?:slack|telegram|webhook|message)|prepare\s+(?:an?\s+)?(?:outbound|slack|telegram|webhook)\s+draft)\b|(?<![\p{L}])(?:taslak\s+mesaj\s+haz[ıi]rla|gönderim\s+tasla[ğg]\p{L}*)(?![\p{L}])/iu;

function hasPersonalEmailReadIntent(phrase: string): boolean {
  if (SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    return false;
  }
  if (
    /\b(did [\p{L}\s]{1,25} (?:e-?mail|write to|send an? e-?mail to) me|did [\p{L}\s]{1,25} send (?:me )?an? e-?mail|what'?s in my inbox)\b|(?<![\p{L}])(?:[\p{L}\s]{1,25} bana (?:yazd[ıi]|mail att[ıi]|e-?posta gönderdi) m[ıi]|gelen kutum\p{L}*|inbox['’]?\p{L}*)(?![\p{L}])/iu.test(
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
  if (PERSONAL_EMAIL_DRAFT_CUE_PATTERN.test(phrase)) {
    return true;
  }
  return (
    hasPersonalEmailReadIntent(phrase) &&
    /(?<![\p{L}])(?:tasla[ğg]\p{L}*|cevap\p{L}*|yan[ıi]t\p{L}*|draft|reply|respond|response)(?![\p{L}])/iu.test(
      phrase
    )
  );
}

const CALENDAR_NOUN_STEM_PATTERN =
  /(?<![\p{L}])(?:takvim\p{L}*|calendar|toplant[ıi](?!\s+not\p{L}*)\p{L}*|randevu\p{L}*|etkinlik\p{L}*|meetings?(?!\s+notes?)|appointments?|calendar\s+events?)(?![\p{L}])/iu;

const CALENDAR_CREATE_VERB_STEM_PATTERN =
  /(?<![\p{L}])(?:ekle\p{L}*|ayarla\p{L}*|oluştur\p{L}*|yaz(?!d[ıi])\p{L}*|kaydet\p{L}*|planla\p{L}*|koy\p{L}*|tasla[ğg]\p{L}*|add|create|schedule|book|set\s+up|put|draft)(?![\p{L}])/iu;

function hasPersonalCalendarCreateIntent(phrase: string): boolean {
  if (
    PERSONAL_EMAIL_DRAFT_CUE_PATTERN.test(phrase) &&
    !/takvim|calendar/iu.test(phrase)
  ) {
    return false;
  }
  if (
    /\b(create (?:a )?(?:google )?calendar draft|draft (?:a )?calendar event|add .{1,80} to (?:my )?calendar)\b|takvim taslağı oluştur/iu.test(
      phrase
    )
  ) {
    return true;
  }
  return (
    CALENDAR_NOUN_STEM_PATTERN.test(phrase) &&
    CALENDAR_CREATE_VERB_STEM_PATTERN.test(phrase)
  );
}

function hasPersonalCalendarReadIntent(phrase: string): boolean {
  if (
    /\b(am i free |are you free |what'?s on my calendar|upcoming calendar events)\b|(?<![\p{L}])(?:yaklaşan etkinliklerim|(?:yar[ıi]n|bugün|pazartesi|sal[ıi]|çarşamba|perşembe|cuma|cumartesi|pazar)\b.{0,30}(?:boş muyum|müsait miyim|uygun muyum))(?![\p{L}])/iu.test(
      phrase
    )
  ) {
    return true;
  }
  if (!CALENDAR_NOUN_STEM_PATTERN.test(phrase)) {
    return false;
  }
  if (
    hasPersonalCalendarCreateIntent(phrase) &&
    !/(?<![\p{L}])(?:kontrol|oku\p{L}*|bak\p{L}*|ne\s+var|neler|boş|müsait|check|read|what|list|show)(?![\p{L}])/iu.test(
      phrase
    )
  ) {
    return false;
  }
  // Ignore incidental mention of a meeting inside an email draft ("toplantıyı iptal ettiğimi söyleyen mail taslağı")
  if (
    PERSONAL_EMAIL_NOUN_PATTERN.test(phrase) &&
    !/takvim|calendar/iu.test(phrase)
  ) {
    return false;
  }
  return true;
}

const DRIVE_NOUN_STEM_PATTERN =
  /(?<![\p{L}])(?:google\s+drive|(?<!hard\s|test\s)drive(?:['’]?\p{L}*)?(?!\s+to\b))(?![\p{L}])/iu;

const DRIVE_CREATE_CUE_PATTERN =
  /(?<![\p{L}])(?:tasla[ğg]\p{L}*|oluştur\p{L}*|kaydet\p{L}*|yarat\p{L}*|ekle\p{L}*|create|save|draft)(?![\p{L}])/iu;

function hasPersonalDriveCreateIntent(phrase: string): boolean {
  if (!DRIVE_NOUN_STEM_PATTERN.test(phrase)) {
    return false;
  }
  if (
    /\b(create (?:a )?(?:google )?drive draft|save (?:a )?draft (?:doc|document) in (?:google )?drive)\b|(?:google )?drive(?:'a|a)? .{0,50}(?:taslak|belge|doküman).{0,25}(?:oluştur|kaydet|yarat)|(?:google )?drive taslağı oluştur|drive'a taslak kaydet/iu.test(
      phrase
    )
  ) {
    return true;
  }
  return (
    /(?<![\p{L}])drive['’]?a(?![\p{L}])/iu.test(phrase) &&
    DRIVE_CREATE_CUE_PATTERN.test(phrase)
  );
}

function hasPersonalDriveReadIntent(phrase: string): boolean {
  if (!DRIVE_NOUN_STEM_PATTERN.test(phrase)) {
    return false;
  }
  if (
    hasPersonalDriveCreateIntent(phrase) &&
    !/(?<![\p{L}])(?:bul\p{L}*|ara\p{L}*|nerede|listele\p{L}*|oku\p{L}*|göster\p{L}*|son\s+dosya\p{L}*|find|search|read|list|where)(?![\p{L}])/iu.test(
      phrase
    )
  ) {
    return false;
  }
  return true;
}

const GITHUB_READ_STEM_PATTERN =
  /\b((?:list|check|read|any|are there(?: any)?) (?:open )?(?:github )?(?:prs|pull requests)(?: on my repos)?|read (?:github )?(?:prs|pull requests)|check github prs)\b|(?<![\p{L}])(?:github(?:['’]?\p{L}*)?\s+aç[ıi]k\s+(?:pr|pull\s+request)(?:['’]?\p{L}*)?|aç[ıi]k\s+(?:github\s+)?(?:pr|pull\s+request)(?:['’]?\p{L}*)?\s*(?:var\s+m[ıi]|kontrol\s+et|listele|neler))(?![\p{L}])/iu;

const MEMORY_SAVE_STEM_PATTERN =
  /\b(save (?:this )?to (?:my )?(?:profile|memory)|remember (?:this(?:\s+fact)?|that\b)|store in (?:my )?(?:profile|memory)|keep in mind)\b|^\s*(?:please\s+)?remember\s*[:\-–—]|profilime kaydet|belleğe kaydet|belleğime kaydet|hafızaya kaydet|bunu hatırla|hatırla\s*[:\-–—]|unutma(?:\s+ki|\s*[:\-–—])|aklında tut/iu;

const MEMORY_RECALL_STEM_PATTERN =
  /\b(search my memory|recall from memory|what do you remember|do you remember (?:my|what|how|when|where|who|me)|what have you saved in (?:my )?memory|check my journal|how do i (?:like|drink|take|prefer|usually)|what (?:is|are) my (?:favorite|favourite|preferred|preferences|rules|allergies|coffee|diet)|what do i (?:prefer|like to)|do you know (?:my|how i|what i)|when is my [\p{L}'’]+\s+birthday|do i have (?:any )?allerg\w*|what did i (?:tell|say to) you about)\b|(?<![\p{L}])(?:belleğimi ara|hafızam\p{L}*\s+ara|hakkımda ne (?:hatırlıyorsun|biliyorsun)|hakkımda bildiğin|hatırlıyor musun|ne hatırlıyorsun|beni tanıyor musun|günlüğümü kontrol et|(?:kahvem\p{L}*|çayım\p{L}*)\s+nasıl|nasıl\s+(?:içtiğimi|içerim|severim)|(?:favori|en sevdiğim)\s+\p{L}+|(?:tercihlerim|kurallarım|alışkanlıklarım)\s+(?:neler|ne)|alerjim\s+var\s+m[ıi]|(?:kızımın|oğlumun|eşimin|kardeşimin|ablamın|abimin)\s+(?:doğum\s+günü|adı|yaşı)|sana\s+.{1,40}(?:ne demiştim|söylemiştim))(?![\p{L}])/iu;

function hasPersonalSelfQuestionIntent(phrase: string): boolean {
  if (
    MEMORY_SAVE_STEM_PATTERN.test(phrase) &&
    !/\?|\b(do you remember|what do you remember)\b|hatırlıyor musun|ne hatırlıyorsun/iu.test(
      phrase
    )
  ) {
    return false;
  }
  if (
    WEATHER_PATTERN.test(phrase) ||
    CLOCK_PATTERN.test(phrase) ||
    isFixtureQuestion(phrase) ||
    hasPersonalEmailReadIntent(phrase) ||
    hasPersonalEmailDraftIntent(phrase) ||
    hasPersonalCalendarReadIntent(phrase) ||
    hasPersonalCalendarCreateIntent(phrase) ||
    hasPersonalDriveReadIntent(phrase) ||
    hasPersonalDriveCreateIntent(phrase) ||
    GITHUB_READ_STEM_PATTERN.test(phrase) ||
    SCHEDULE_LIST_OR_CANCEL_STEM_PATTERN.test(phrase) ||
    SCHEDULE_CREATE_STEM_PATTERN.test(phrase) ||
    MAC_BRIDGE_PATTERN.test(phrase) ||
    CLOUD_COMPUTER_PATTERN.test(phrase) ||
    CLOUD_BROWSE_PATTERN.test(phrase) ||
    FIRECRAWL_INTENT_PATTERN.test(phrase) ||
    hasHtmlDashboardIntent(phrase) ||
    hasExcalidrawDiagramIntent(phrase) ||
    hasInfographicIntent(phrase)
  ) {
    return false;
  }
  return MEMORY_RECALL_STEM_PATTERN.test(phrase);
}

const SCHEDULE_LIST_OR_CANCEL_STEM_PATTERN =
  /\b(my schedules|scheduled tasks|recurring tasks|my routines|cancel (?:a |the |my )?(?:schedule|routine|reminder))\b|(?<![\p{L}])(?:zamanlanmış görev\p{L}*|planlanmış görev\p{L}*|görevlerimi listele|rutinlerim\p{L}*|görevi iptal|(?:rutin\p{L}*|görev\p{L}*|hatırlat\p{L}*)\s+(?:iptal|sil|kaldır))(?![\p{L}])/iu;

const SCHEDULE_CREATE_STEM_PATTERN =
  /\b(schedule a (?:task|routine|reminder)|create a routine|every (?:day|morning|evening|weekday|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|remind me (?:at|on|tomorrow|every|in \d))\b|(?<![\p{L}])(?:rutin oluştur|her (?:sabah|akşam|gün|hafta(?:\s+içi)?|pazartesi|sal[ıi]|çarşamba|perşembe|cuma|cumartesi|pazar)\b|hatırlat(?![\p{L}])|hatırlatır mısın)(?![\p{L}])/iu;

const IMAGE_GENERATE_STEM_PATTERN =
  /\b((?:generate|create|draw|sketch)\s+(?:me\s+)?(?:an?\s+)?(?:image|illustration|picture|poster|logo|icon))\b|(?<![\p{L}])(?:(?:görsel|resim|illüstrasyon|poster|logo)\p{L}*\s+(?:üret|oluştur|çiz|hazırla)\p{L}*)(?![\p{L}])/iu;

const VIDEO_GENERATE_STEM_PATTERN =
  /\b(generate (?:an? )?(?:video|video clip)|create (?:an? )?video clip)\b|video(?:\s+klibi)?\s+(?:üret|oluştur)/iu;

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

export function wantsLiveFacts(phrase: string): boolean {
  return (
    SEARCH_PATTERN_EN.test(phrase) ||
    SEARCH_PATTERN_TR.test(phrase) ||
    FACT_PATTERN_EN.test(phrase) ||
    FACT_PATTERN_TR.test(phrase)
  );
}

/**
 * True only for genuine live-fact / public-entity questions, never for a bare "?"
 * or polite TR/EN task requests ("... mısın/musun?", "can you ...?").
 */
export function isOpenQuestion(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 8 || CHITCHAT_PATTERN.test(trimmed)) {
    return false;
  }
  if (isPoliteTaskRequest(trimmed)) {
    return false;
  }
  return wantsLiveFacts(trimmed);
}

function hasMatchedLocalOrPersonalIntent(phrase: string): boolean {
  return (
    SYNTHETIC_DEMO_PATTERN.test(phrase) ||
    MAC_BRIDGE_PATTERN.test(phrase) ||
    CLOUD_COMPUTER_PATTERN.test(phrase) ||
    CLOUD_BROWSE_PATTERN.test(phrase) ||
    SCREEN_HANDOFF_PATTERN.test(phrase) ||
    FIRECRAWL_INTENT_PATTERN.test(phrase) ||
    hasHtmlDashboardIntent(phrase) ||
    hasExcalidrawDiagramIntent(phrase) ||
    hasInfographicIntent(phrase) ||
    DOCUMENT_PATTERN.test(phrase) ||
    hasPersonalEmailReadIntent(phrase) ||
    hasPersonalEmailDraftIntent(phrase) ||
    hasPersonalCalendarReadIntent(phrase) ||
    hasPersonalCalendarCreateIntent(phrase) ||
    hasPersonalDriveReadIntent(phrase) ||
    hasPersonalDriveCreateIntent(phrase) ||
    GITHUB_READ_STEM_PATTERN.test(phrase) ||
    MEMORY_SAVE_STEM_PATTERN.test(phrase) ||
    hasPersonalSelfQuestionIntent(phrase) ||
    SCHEDULE_LIST_OR_CANCEL_STEM_PATTERN.test(phrase) ||
    SCHEDULE_CREATE_STEM_PATTERN.test(phrase) ||
    IMAGE_GENERATE_STEM_PATTERN.test(phrase) ||
    VIDEO_GENERATE_STEM_PATTERN.test(phrase) ||
    NON_EMAIL_OUTBOUND_DRAFT_PATTERN.test(phrase) ||
    /\b(my home city|set my city|my city is|i live in|i'?m based in|home is in|customize your personality|change your personality|set your personality|ask me (?:a )?clarifying question|give me clickable options|delegate (?:a |this )?task|run (?:this )?in the background|log in my journal|add to my journal)\b|ev şehrim|yaşıyorum|kişiliğini değiştir|bana seçenek kartı göster|arka planda çalıştır|günlüğüme ekle/iu.test(
      phrase
    )
  );
}

/**
 * Offer web search only on real live-fact signals (`wantsLiveFacts`), never on
 * a "?" alone, chitchat, weather, clock, Korn Ferry data, or turns whose words
 * matched a local/personal/Mac/Cloud tool (unless the user explicitly asked to
 * search the open web).
 */
export function shouldOfferWebSearch(
  phrase: string,
  webSearchAvailable: boolean
): boolean {
  if (
    !webSearchAvailable ||
    WEATHER_PATTERN.test(phrase) ||
    containsRestrictedWorkData(phrase)
  ) {
    return false;
  }
  const explicitWebSearch = EXPLICIT_OPEN_WEB_SEARCH_PATTERN.test(phrase);
  if (hasMatchedLocalOrPersonalIntent(phrase) && !explicitWebSearch) {
    return false;
  }
  const factual = wantsLiveFacts(phrase);
  if (CLOCK_PATTERN.test(phrase) && !factual) {
    return false;
  }
  if (CHITCHAT_PATTERN.test(phrase) && !factual) {
    return false;
  }
  return explicitWebSearch || factual;
}

export type SelectActiveToolsOptions = {
  /**
   * True when the signed-in owner has Google Workspace connected and healthy.
   * When true, Gmail/Calendar/Drive read tools (+ `gmailCreateDraft` on non-search
   * turns) are offered on every non-chitchat turn, with regex acting as a
   * priority/ranking hint.
   */
  googleConnectedAndHealthy?: boolean;
  /**
   * Authoritative per-turn capability manifest. When provided, all connected and
   * healthy tools in the manifest are offered by default, and intent regexes
   * strictly rank matching tools to the front (never hiding connected tools).
   */
  capabilityManifest?: CapabilityManifest;
};

type ToolFamily = "gmail" | "calendar" | "drive" | "github" | "weather";

function detectPriorToolFamily(messages: ChatMessage[]): ToolFamily | null {
  const history = messages.slice(0, -1);
  for (let i = history.length - 1; i >= Math.max(0, history.length - 4); i--) {
    const m = history[i];
    if (!m) {
      continue;
    }
    if (m.role === "assistant") {
      for (const p of m.parts) {
        const t = String(p.type);
        if (t === "tool-gmailReadMessages" || t === "tool-gmailCreateDraft") {
          return "gmail";
        }
        if (
          t === "tool-calendarReadEvents" ||
          t === "tool-calendarCreateDraftEvent"
        ) {
          return "calendar";
        }
        if (t === "tool-driveReadFiles" || t === "tool-driveCreateDraftDoc") {
          return "drive";
        }
        if (
          t === "tool-githubReadPullRequests" ||
          t === "tool-githubCreateDraftReview"
        ) {
          return "github";
        }
        if (t === "tool-getWeather") {
          return "weather";
        }
      }
    }
    if (m.role === "user") {
      const prev = normalizePhrase(userText(m));
      if (
        hasPersonalEmailReadIntent(prev) ||
        hasPersonalEmailDraftIntent(prev)
      ) {
        return "gmail";
      }
      if (
        hasPersonalCalendarReadIntent(prev) ||
        hasPersonalCalendarCreateIntent(prev)
      ) {
        return "calendar";
      }
      if (
        hasPersonalDriveReadIntent(prev) ||
        hasPersonalDriveCreateIntent(prev)
      ) {
        return "drive";
      }
      if (GITHUB_READ_STEM_PATTERN.test(prev)) {
        return "github";
      }
      if (WEATHER_PATTERN.test(prev)) {
        return "weather";
      }
    }
  }
  return null;
}

function isContextualFollowUp(latest: string, phrase: string): boolean {
  const trimmed = latest.trim();
  if (
    !trimmed ||
    CHITCHAT_PATTERN.test(phrase) ||
    SYNTHETIC_DEMO_PATTERN.test(phrase)
  ) {
    return false;
  }
  const wordCount = trimmed.split(/\s+/).length;
  const hasAnaphora =
    /(?<![\p{L}])(?:buna|ona|şuna|bundan|ondan|ilk\p{L}*|ikinci\p{L}*|üçüncü\p{L}*|sonuncu\p{L}*|önceki\p{L}*|sonraki\p{L}*|peki)(?![\p{L}])|\b(?:reply to (?:it|that|this|the (?:first|second|last|newest) one)|draft a reply to (?:it|that|this|the (?:first|second|last|newest) one)|the (?:first|second|last|previous|newest) one|what about|how about|and tomorrow)\b/iu.test(
      phrase
    );
  if (hasAnaphora && wordCount <= 12) {
    return true;
  }
  return (
    trimmed.length <= 55 &&
    wordCount <= 6 &&
    !/^(please|show|explain|write|create|hello|hi|thanks|thank|merhaba|teşekkür|lütfen|göster)\b/i.test(
      trimmed
    ) &&
    !/document|belge|demo|fictional/.test(phrase)
  );
}

const ALWAYS_CONNECTED_CORE_TOOLS: readonly ChatToolName[] = [
  "getWeather",
  "getCurrentTime",
  "getFixtures",
  "createDocument",
  "editDocument",
  "updateDocument",
  "askUserQuestion",
];

function appendConnectedManifestTools(
  rankedIntentTools: readonly ChatToolName[],
  canPersonalize: boolean,
  manifest?: CapabilityManifest
): ChatToolName[] {
  if (!manifest) {
    return [...new Set(rankedIntentTools)];
  }
  const fromManifest = connectedToolsFromManifest(manifest).filter(
    (name): name is ChatToolName =>
      (AVAILABLE_CHAT_TOOLS as readonly string[]).includes(name)
  );
  const ownerSelfService: ChatToolName[] = canPersonalize
    ? ["setHomeLocation", "setSoul", "draftOutboundMessage"]
    : [];
  const combined = [
    ...rankedIntentTools,
    ...fromManifest,
    ...ALWAYS_CONNECTED_CORE_TOOLS,
    ...ownerSelfService,
  ];
  if (rankedIntentTools.includes("cloudBrowseUrl")) {
    return [
      ...new Set(
        combined.filter((name) => !STATE_CHANGING_TOOLS.includes(name))
      ),
    ];
  }
  return [...new Set(combined)];
}

export function selectToolsWithRanking(
  messages: ChatMessage[],
  canPersonalize: boolean,
  webSearchAvailable = false,
  options?: SelectActiveToolsOptions
): { activeTools: ChatToolName[]; intentMatchedTools: ChatToolName[] } {
  const recentUserText = messages
    .filter((msg) => msg.role === "user")
    .slice(-4)
    .map(userText);
  const latest = recentUserText.at(-1) ?? "";
  const phrase = normalizePhrase(latest);
  const enabled: ChatToolName[] = [];
  const intentOnly: ChatToolName[] = [];

  if (containsRestrictedWorkData(latest)) {
    return { activeTools: [], intentMatchedTools: [] };
  }

  if (WEATHER_PATTERN.test(phrase)) {
    enabled.push("getWeather");
    intentOnly.push("getWeather");
  }

  if (CLOCK_PATTERN.test(phrase)) {
    enabled.push("getCurrentTime");
    intentOnly.push("getCurrentTime");
  }

  if (isFixtureQuestion(phrase) && !WEATHER_PATTERN.test(phrase)) {
    enabled.push("getFixtures");
    intentOnly.push("getFixtures");
  }

  if (
    canPersonalize &&
    /\b(my home city|set my city|my city is|i live in|i'?m based in|home is in)\b|ev şehrim|şehrim|yaşıyorum|evim .* şehrinde/.test(
      phrase
    )
  ) {
    enabled.push("setHomeLocation");
    intentOnly.push("setHomeLocation");
  }

  if (
    SYNTHETIC_DEMO_PATTERN.test(phrase) &&
    /inbox|mail|e.?posta|gelen kutusu|chart|grafik/.test(phrase)
  ) {
    enabled.push("demoInbox");
    intentOnly.push("demoInbox");
  }

  if (
    DOCUMENT_PATTERN.test(phrase) &&
    !hasPersonalDriveCreateIntent(phrase) &&
    !hasPersonalDriveReadIntent(phrase)
  ) {
    if (/suggestions|writing advice|öneri/.test(phrase)) {
      enabled.push("requestSuggestions");
      intentOnly.push("requestSuggestions");
    } else if (/rewrite|replace most|full rewrite|baştan yaz/.test(phrase)) {
      enabled.push("updateDocument");
      intentOnly.push("updateDocument");
    } else if (
      /\b(edit|update|revise|change|fix|modify)\b|düzenle|güncelle|değiştir/.test(
        phrase
      )
    ) {
      enabled.push("editDocument");
      intentOnly.push("editDocument");
    } else {
      enabled.push("createDocument");
      intentOnly.push("createDocument");
    }
  }

  if (SCHEDULE_LIST_OR_CANCEL_STEM_PATTERN.test(phrase)) {
    enabled.push("listMySchedules");
    intentOnly.push("listMySchedules");
    if (/cancel|delete|remove|iptal|sil|kaldır/.test(phrase)) {
      enabled.push("cancelSchedule");
      intentOnly.push("cancelSchedule");
    }
  }

  if (
    canPersonalize &&
    /\b(customize your personality|change your personality|remember my preferred style|set your personality)\b|kişiliğini değiştir|tarzını kaydet|kişiselleştir/.test(
      phrase
    )
  ) {
    enabled.push("setSoul");
    intentOnly.push("setSoul");
  }

  const googleHealthyFromManifest = options?.capabilityManifest
    ? options.capabilityManifest.entries.find((e) => e.id === "gmail")
        ?.state === "connected_and_healthy"
    : undefined;
  const effectiveGoogleHealthy =
    options?.googleConnectedAndHealthy ?? googleHealthyFromManifest;

  const googleConnectorsActive =
    canPersonalize &&
    isGoogleConnectorsEnabled() &&
    effectiveGoogleHealthy !== false;

  if (
    canPersonalize &&
    (NON_EMAIL_OUTBOUND_DRAFT_PATTERN.test(phrase) ||
      (!googleConnectorsActive &&
        /\b(draft (?:an? )?e-?mail|prepare (?:an? )?e-?mail draft)\b|taslak e-?posta hazırla/iu.test(
          phrase
        )))
  ) {
    enabled.push("draftOutboundMessage");
    intentOnly.push("draftOutboundMessage");
  }

  if (
    /\b(ask me (?:a )?clarifying question|give me clickable options|show (?:me )?choice card)\b|bana seçenek kartı göster|netleştirici soru sor/.test(
      phrase
    )
  ) {
    enabled.push("askUserQuestion");
    intentOnly.push("askUserQuestion");
  }

  if (
    canPersonalize &&
    isRoutinesEnabled() &&
    SCHEDULE_CREATE_STEM_PATTERN.test(phrase)
  ) {
    enabled.push("scheduleTask");
    intentOnly.push("scheduleTask");
  }

  if (canPersonalize && MAC_BRIDGE_PATTERN.test(phrase)) {
    enabled.push("macExec");
    intentOnly.push("macExec");
    if (MAC_AGENT_CLI_PATTERN.test(phrase)) {
      enabled.push("macRunAgentCli");
      intentOnly.push("macRunAgentCli");
    }
  }

  const explicitFirecrawlNamed = /\bfirecrawl\b/iu.test(phrase);
  if (canPersonalize && FIRECRAWL_INTENT_PATTERN.test(phrase)) {
    const orderedFirecrawl: ChatToolName[] =
      /\b(crawl|site\s*map|map\s+(?:the\s+)?(?:site|pages|urls|domain))\b|site\s+haritas[ıi]|alt\s+sayfalar[ıi]/iu.test(
        phrase
      )
        ? ["firecrawlCrawlMap", "firecrawlScrape", "firecrawlSearch"]
        : /\b(scrape|to\s+markdown)\b|kaz[ıi]|markdown|https?:\/\/\S+/iu.test(
              phrase
            )
          ? ["firecrawlScrape", "firecrawlSearch", "firecrawlCrawlMap"]
          : ["firecrawlSearch", "firecrawlScrape", "firecrawlCrawlMap"];
    enabled.push(...orderedFirecrawl);
    intentOnly.push(...orderedFirecrawl);
  }

  if (canPersonalize && !SYNTHETIC_DEMO_PATTERN.test(phrase)) {
    if (hasInfographicIntent(phrase)) {
      enabled.push("generateInfographic");
      intentOnly.push("generateInfographic");
    }
    if (hasExcalidrawDiagramIntent(phrase)) {
      enabled.push("createExcalidrawDiagram");
      intentOnly.push("createExcalidrawDiagram");
    }
    if (hasHtmlDashboardIntent(phrase)) {
      enabled.push("buildHtmlPageOrDashboard");
      intentOnly.push("buildHtmlPageOrDashboard");
    }
  }

  if (canPersonalize && SCREEN_HANDOFF_PATTERN.test(phrase)) {
    enabled.push("requestScreenHandoff");
    intentOnly.push("requestScreenHandoff");
  }
  if (
    canPersonalize &&
    !explicitFirecrawlNamed &&
    CLOUD_BROWSE_PATTERN.test(phrase)
  ) {
    enabled.push("cloudBrowseUrl");
    intentOnly.push("cloudBrowseUrl");
  } else if (
    canPersonalize &&
    !explicitFirecrawlNamed &&
    CLOUD_COMPUTER_PATTERN.test(phrase)
  ) {
    enabled.push(
      "cloudExec",
      "cloudWriteFile",
      "cloudReadFile",
      "cloudExportFileToChat"
    );
    intentOnly.push(
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
    intentOnly.push("delegateTask");
  }

  if (canPersonalize && isMemoryToolsEnabled()) {
    const isSelfQuestion = hasPersonalSelfQuestionIntent(phrase);
    const isExplicitSave =
      !isSelfQuestion && MEMORY_SAVE_STEM_PATTERN.test(phrase);
    if (isExplicitSave) {
      enabled.push("saveProfileFact");
      intentOnly.push("saveProfileFact");
    }
    if (
      /\b(log in my journal|add to my journal|journal entry)\b|günlüğüme ekle|günlük kaydı/i.test(
        phrase
      )
    ) {
      enabled.push("addJournalEntry");
      intentOnly.push("addJournalEntry");
    }
    if (isSelfQuestion) {
      enabled.push("recallMemories", "saveProfileFact", "addJournalEntry");
      intentOnly.push("recallMemories", "saveProfileFact", "addJournalEntry");
    }
  }

  if (canPersonalize && isGoogleConnectorsEnabled()) {
    const isSyntheticDemo = SYNTHETIC_DEMO_PATTERN.test(phrase);

    if (!isSyntheticDemo) {
      if (hasPersonalEmailReadIntent(phrase)) {
        enabled.push("gmailReadMessages");
        intentOnly.push("gmailReadMessages");
      }
      if (
        hasPersonalEmailDraftIntent(phrase) &&
        (!enabled.includes("draftOutboundMessage") ||
          /gmail/iu.test(phrase) ||
          hasPersonalEmailReadIntent(phrase))
      ) {
        enabled.push("gmailCreateDraft");
        intentOnly.push("gmailCreateDraft");
      }

      if (hasPersonalCalendarReadIntent(phrase)) {
        enabled.push("calendarReadEvents");
        intentOnly.push("calendarReadEvents");
      }
      if (hasPersonalCalendarCreateIntent(phrase)) {
        enabled.push("calendarCreateDraftEvent");
        intentOnly.push("calendarCreateDraftEvent");
      }

      if (hasPersonalDriveReadIntent(phrase)) {
        enabled.push("driveReadFiles");
        intentOnly.push("driveReadFiles");
      }
      if (hasPersonalDriveCreateIntent(phrase)) {
        enabled.push("driveCreateDraftDoc");
        intentOnly.push("driveCreateDraftDoc");
      }

      // When Google is connected and healthy (without a full manifest), offer
      // Gmail/Calendar/Drive read tools (+ gmailCreateDraft) on every non-chitchat turn.
      if (
        !options?.capabilityManifest &&
        effectiveGoogleHealthy === true &&
        !CHITCHAT_PATTERN.test(phrase)
      ) {
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
      intentOnly.push("githubCreateDraftReview");
    }
    if (GITHUB_READ_STEM_PATTERN.test(phrase)) {
      enabled.push("githubReadPullRequests");
      intentOnly.push("githubReadPullRequests");
    }
  }

  if (canPersonalize && isMediaStudioEnabled()) {
    if (VIDEO_GENERATE_STEM_PATTERN.test(phrase)) {
      enabled.push("generateVideoClip");
      intentOnly.push("generateVideoClip");
    } else if (IMAGE_GENERATE_STEM_PATTERN.test(phrase)) {
      enabled.push("generateImageAsset");
      intentOnly.push("generateImageAsset");
    }
  }

  let inheritedFollowUp = false;
  if (isContextualFollowUp(latest, phrase)) {
    const family = detectPriorToolFamily(messages);
    if (family === "weather") {
      if (!enabled.includes("getWeather")) {
        enabled.push("getWeather");
        intentOnly.push("getWeather");
      }
      inheritedFollowUp = true;
    } else if (
      family === "gmail" &&
      canPersonalize &&
      isGoogleConnectorsEnabled()
    ) {
      const wantsDraftOnFollowUp =
        /(?<![\p{L}])(?:tasla[ğg]\p{L}*|cevap\p{L}*|yan[ıi]t\p{L}*|yaz\p{L}*|draft|reply|respond)(?![\p{L}])/iu.test(
          phrase
        );
      if (wantsDraftOnFollowUp) {
        if (!enabled.includes("gmailCreateDraft")) {
          enabled.push("gmailCreateDraft");
          intentOnly.push("gmailCreateDraft");
        }
      } else if (!enabled.includes("gmailReadMessages")) {
        enabled.push("gmailReadMessages");
        intentOnly.push("gmailReadMessages");
      }
      inheritedFollowUp = true;
    } else if (
      family === "calendar" &&
      canPersonalize &&
      isGoogleConnectorsEnabled()
    ) {
      if (CALENDAR_CREATE_VERB_STEM_PATTERN.test(phrase)) {
        enabled.push("calendarCreateDraftEvent");
        intentOnly.push("calendarCreateDraftEvent");
      } else {
        enabled.push("calendarReadEvents");
        intentOnly.push("calendarReadEvents");
      }
      inheritedFollowUp = true;
    } else if (
      family === "drive" &&
      canPersonalize &&
      isGoogleConnectorsEnabled()
    ) {
      if (DRIVE_CREATE_CUE_PATTERN.test(phrase)) {
        enabled.push("driveCreateDraftDoc");
        intentOnly.push("driveCreateDraftDoc");
      } else {
        enabled.push("driveReadFiles");
        intentOnly.push("driveReadFiles");
      }
      inheritedFollowUp = true;
    } else if (
      family === "github" &&
      canPersonalize &&
      isGithubConnectorEnabled()
    ) {
      enabled.push("githubReadPullRequests");
      intentOnly.push("githubReadPullRequests");
      inheritedFollowUp = true;
    }
  }

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
    const mergedApproved = [...new Set([...enabled, ...approvedTools])];
    return {
      activeTools: appendConnectedManifestTools(
        mergedApproved,
        canPersonalize,
        options?.capabilityManifest
      ),
      intentMatchedTools: [...new Set([...intentOnly, ...approvedTools])],
    };
  }

  if (!inheritedFollowUp && shouldOfferWebSearch(phrase, webSearchAvailable)) {
    const webActive = [
      ...new Set([
        ...enabled.filter((name) => !STATE_CHANGING_TOOLS.includes(name)),
        "webSearch" as const,
      ]),
    ];
    return {
      activeTools: webActive,
      intentMatchedTools: [
        ...new Set([
          ...intentOnly.filter((name) => !STATE_CHANGING_TOOLS.includes(name)),
          "webSearch" as const,
        ]),
      ],
    };
  }

  if (enabled.includes("cloudBrowseUrl")) {
    const browseSafe = [
      ...new Set(
        enabled.filter((name) => !STATE_CHANGING_TOOLS.includes(name))
      ),
    ];
    return {
      activeTools: appendConnectedManifestTools(
        browseSafe,
        canPersonalize,
        options?.capabilityManifest
      ),
      intentMatchedTools: [
        ...new Set(
          intentOnly.filter((name) => !STATE_CHANGING_TOOLS.includes(name))
        ),
      ],
    };
  }

  const sanitizedIntent =
    enabled.includes("gmailReadMessages") ||
    enabled.includes("driveReadFiles") ||
    enabled.includes("calendarReadEvents") ||
    enabled.includes("githubReadPullRequests")
      ? [
          ...new Set(
            enabled.filter(
              (name) =>
                !STATE_CHANGING_TOOLS.includes(name) ||
                APPROVAL_GATED_CONNECTOR_DRAFT_TOOLS.has(name)
            )
          ),
        ]
      : [...new Set(enabled)];

  const sanitizedIntentOnly =
    intentOnly.includes("gmailReadMessages") ||
    intentOnly.includes("driveReadFiles") ||
    intentOnly.includes("calendarReadEvents") ||
    intentOnly.includes("githubReadPullRequests")
      ? [
          ...new Set(
            intentOnly.filter(
              (name) =>
                !STATE_CHANGING_TOOLS.includes(name) ||
                APPROVAL_GATED_CONNECTOR_DRAFT_TOOLS.has(name)
            )
          ),
        ]
      : [...new Set(intentOnly)];

  return {
    activeTools: appendConnectedManifestTools(
      sanitizedIntent,
      canPersonalize,
      options?.capabilityManifest
    ),
    intentMatchedTools: sanitizedIntentOnly,
  };
}

/**
 * Selects active tools for the turn. When `options.capabilityManifest` is passed,
 * all connected & healthy tools are offered by default and intent regexes rank
 * matched tools first without hiding connected capabilities.
 */
export function selectActiveTools(
  messages: ChatMessage[],
  canPersonalize: boolean,
  webSearchAvailable = false,
  options?: SelectActiveToolsOptions
): ChatToolName[] {
  return selectToolsWithRanking(
    messages,
    canPersonalize,
    webSearchAvailable,
    options
  ).activeTools;
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
