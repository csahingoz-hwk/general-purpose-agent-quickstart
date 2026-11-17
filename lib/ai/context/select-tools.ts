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
  /\b(search|look(?:ing)? (?:it |this |that |them )?up|google|find (?:it |this |that |out )?(?:online|on the web)|on the web|web search|latest|news|breaking|who won|(?:current|today'?s|live) (?:price|prices|score|scores|result|results|rate|rates|exchange rate)|exchange rate|stock price|share price)\b/;
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
  /\b(demo|mock|fictional|sample|test inbox|my home city|set my city|my city is|i live in|i'?m based in|home is in|my schedules|scheduled tasks|recurring tasks|cancel schedule|schedule a task|schedule a routine|create a routine|customize your personality|change your personality|remember my preferred style|set your personality|draft an? email|draft a message|draft a slack|draft a telegram|prepare an? outbound draft|ask me a clarifying question|give me clickable options|save to my profile|log in my journal|search my memory|recall from memory|check (?:my )?gmail|read (?:my )?gmail|search (?:my )?gmail|create (?:a )?gmail draft|save (?:a )?draft in gmail|search (?:my )?(?:google )?drive|read (?:from )?(?:my )?(?:google )?drive|list (?:my )?(?:google )?drive files|create (?:a )?(?:google )?drive draft|save (?:a )?draft (?:doc|document) in (?:google )?drive|check (?:my )?(?:google )?calendar|upcoming calendar events|read (?:my )?calendar|create (?:a )?(?:google )?calendar draft|draft (?:a )?calendar event|list (?:open )?(?:github )?(?:prs|pull requests)|read (?:github )?(?:prs|pull requests)|check github prs|draft (?:a )?(?:github )?(?:pr|pull request) review|create (?:a )?github draft review|generate (?:an? )?(?:image|illustration|picture|poster|video|video clip)|create (?:an? )?(?:image|video clip))\b|hayal[iî]|örnek gelen kutusu|sahte e.?posta|ev şehrim|şehrim|yaşıyorum|zamanlanmış görev|planlanmış görev|görevlerimi listele|görevi iptal|rutin oluştur|kişiliğini değiştir|tarzını kaydet|kişiselleştir|taslak e-?posta hazırla|gönderim taslağı|bana seçenek kartı göster|belleğime kaydet|günlüğüme ekle|gmail(?:imi|'imi)? (?:kontrol et|oku|ara)|gmail taslağı oluştur|gmail'e taslak kaydet|(?:google )?drive(?:'da|da| dosyalarımı) (?:ara|listele|oku)|(?:google )?drive taslağı oluştur|drive'a taslak kaydet|takvimimi (?:kontrol et|oku)|yaklaşan etkinliklerim|takvim taslağı oluştur|github açık pr|github pr taslak inceleme|görsel üret|resim oluştur|video klibi oluştur/;

const MAC_BRIDGE_PATTERN =
  /\b(mac\s*mini|on\s+my\s+mac|mac\s+bridge|tailscale\s+ssh|claude\s+code|have\s+claude\b|have\s+codex\b|run\s+codex\b|run\s+agy\b|antigravity\s+cli|t3\s+cli|local\s+repo\b|git\s+status\s+on\s+(?:my\s+)?mac)\b|(?<![\p{L}])(?:mac'?imde|mac\s+mini'?de|yerel\s+repoda)(?![\p{L}])/iu;

const CLOUD_COMPUTER_PATTERN =
  /\b(cloud\s+(?:computer|vm|shell|sandbox)|linux\s+vm|in\s+\/workspace|\/workspace\/|clone\s+(?:the\s+|this\s+)?repo\b|run\s+(?:a\s+|the\s+)?(?:python|bash|shell|node)\b|headless\s+(?:browser|chromium)|scrape\s+https?:\/\/|export\s+.{1,40}\s+from\s+\/workspace)\b|(?<![\p{L}])(?:bulut\s+bilgisayar\p{L}*|linux\s+sunucu\p{L}*|python\s+script\p{L}*)(?![\p{L}])/iu;

const CLOUD_BROWSE_PATTERN =
  /\b(headless\s+(?:browser|chromium)|cloud\s+browser|scrape\s+https?:\/\/|open\s+https?:\/\/\S+\s+in\s+(?:the\s+)?browser|screenshot\s+of\s+https?:\/\/)\b|bulut\s+tarayıcı/iu;

const PRIVATE_PERSONAL_INTENT =
  /\b(did [\p{L}\s]{1,25} e-?mail me|any (?:new |unread |recent )?e-?mails?|what'?s in my inbox|check (?:my )?(?:inbox|e-?mails?)|read (?:my )?(?:inbox|e-?mails?)|e-?mails? from |what'?s on my calendar|am i free |do i have (?:any )?meetings?|my meetings? (?:today|tomorrow|this week)|find .{1,40} in (?:my )?drive|delegate (?:a |this )?task|create a task card|run (?:this )?in the background|background task)\b|(?<![\p{L}])(?:bana (?:e-?posta|mail) geldi mi|okunmamış (?:e-?posta|mail)\p{L}*|gelen kutum\p{L}*|mailimi kontrol et|maillerime bak|takvimimde ne var|bugün toplantım var mı|yarın .{0,20}boş muyum|görev kartı|arka planda çalıştır|görev olarak başlat)(?![\p{L}])/iu;

/** Tools that change stored state; never offered in a turn that reads web content. */
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

function isOpenQuestion(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 8 || CHITCHAT_PATTERN.test(trimmed)) {
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
 * questions, and pure document or local-tool turns stay off the paid tool.
 * Fixture/price/news phrasing is a fallback so those still search even when
 * they look a little like small talk.
 */
export function shouldOfferWebSearch(
  phrase: string,
  webSearchAvailable: boolean
): boolean {
  if (!webSearchAvailable || WEATHER_PATTERN.test(phrase)) {
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
      PRIVATE_PERSONAL_INTENT.test(phrase) ||
      CLOUD_COMPUTER_PATTERN.test(phrase) ||
      CLOUD_BROWSE_PATTERN.test(phrase) ||
      MAC_BRIDGE_PATTERN.test(phrase)) &&
    !factual;
  if (localOnly) {
    return false;
  }
  return factual || isOpenQuestion(phrase);
}

/** Only offer the model tools relevant to what the owner actually asked. */
export function selectActiveTools(
  messages: ChatMessage[],
  canPersonalize: boolean,
  /**
   * True only when this request is served by the AI Gateway lane (see
   * webSearchLane in routing/catalog). On every other lane web search is never
   * offered, whatever the user types.
   */
  webSearchAvailable = false
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
    enabled.push("cloudExec", "cloudWriteFile", "cloudExportFileToChat");
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
      /\b(save to my profile|remember (?:this fact|that i\b)|store in my profile)\b|profilime kaydet|belleğime kaydet|unutma ki/i.test(
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
      /\b(search my memory|recall from memory|what do you remember|check my journal)\b|belleğimi ara|hakkımda ne hatırlıyorsun|günlüğümü kontrol et/i.test(
        phrase
      )
    ) {
      enabled.push("recallMemories");
    }
  }

  if (canPersonalize && isGoogleConnectorsEnabled()) {
    const isSyntheticDemo =
      /\b(demo|mock|fictional|sample|synthetic|test inbox)\b|hayal[iî]|örnek|sahte/.test(
        phrase
      );

    if (!isSyntheticDemo) {
      if (
        /\b(create (?:a )?gmail draft|save (?:a )?draft in gmail|gmail draft to)\b|gmail taslağı oluştur|gmail'e taslak kaydet/.test(
          phrase
        )
      ) {
        enabled.push("gmailCreateDraft");
      }
      if (
        /\b(check (?:my )?(?:gmail|inbox|e-?mails?)|read (?:my )?(?:gmail|inbox|unread emails?(?: in gmail)?|e-?mails?)|search (?:my )?gmail|latest emails? in (?:my )?gmail|did [\p{L}\s]{1,25} e-?mail me|any (?:new |unread |recent )?e-?mails?|what'?s in my inbox|e-?mails? from )\b|gmail(?:imi|'imi)? (?:kontrol et|oku|ara)|(?<![\p{L}])(?:bana (?:e-?posta|mail) geldi mi|okunmamış (?:e-?posta|mail)\p{L}*|gelen kutum\p{L}*|mailimi kontrol et|maillerime bak)(?![\p{L}])/iu.test(
          phrase
        )
      ) {
        enabled.push("gmailReadMessages");
      }

      if (
        /\b(create (?:a )?(?:google )?drive draft|save (?:a )?draft (?:doc|document) in (?:google )?drive)\b|(?:google )?drive taslağı oluştur|drive'a taslak kaydet/.test(
          phrase
        )
      ) {
        enabled.push("driveCreateDraftDoc");
      }
      if (
        /\b(search (?:my )?(?:google )?drive|read (?:from )?(?:my )?(?:google )?drive|find .{1,40} in (?:my )?(?:google )?drive|find in (?:my )?(?:google )?drive|list (?:my )?(?:google )?drive files)\b|(?:google )?drive(?:'da|da|'daki| dosyalarımı) (?:ara|listele|oku|bul)/iu.test(
          phrase
        )
      ) {
        enabled.push("driveReadFiles");
      }

      if (
        /\b(create (?:a )?(?:google )?calendar draft|draft (?:a )?calendar event)\b|takvim taslağı oluştur/.test(
          phrase
        )
      ) {
        enabled.push("calendarCreateDraftEvent");
      }
      if (
        /\b(check (?:my )?(?:google )?calendar|upcoming calendar events|read (?:my )?calendar|what'?s on my calendar|am i free |do i have (?:any )?meetings?|my meetings? (?:today|tomorrow|this week))\b|takvimimi (?:kontrol et|oku)|yaklaşan etkinliklerim|(?<![\p{L}])(?:takvimimde ne var|bugün toplantım var mı|yarın .{0,20}boş muyum)(?![\p{L}])/iu.test(
          phrase
        )
      ) {
        enabled.push("calendarReadEvents");
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
      /\b(list (?:open )?(?:github )?(?:prs|pull requests)|read (?:github )?(?:prs|pull requests)|check github prs)\b|github açık pr/.test(
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

  // Untrusted connector reads (Gmail/Drive/Calendar/GitHub/cloudBrowse) never sit alongside state-changing tools in the same turn.
  if (
    enabled.includes("gmailReadMessages") ||
    enabled.includes("driveReadFiles") ||
    enabled.includes("calendarReadEvents") ||
    enabled.includes("githubReadPullRequests") ||
    enabled.includes("cloudBrowseUrl")
  ) {
    return [
      ...new Set(
        enabled.filter((name) => !STATE_CHANGING_TOOLS.includes(name))
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
