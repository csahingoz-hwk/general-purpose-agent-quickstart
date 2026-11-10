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
  "listMySchedules",
  "cancelSchedule",
  "setSoul",
  "webSearch",
  "getFixtures",
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
  /(?<![\p{L}])(?:ma[cç]\p{L}*|fikst[uü]r\p{L}*|ne zaman|bi(?:r)? dahaki|sonraki ma\p{L}*|gelecek ma\p{L}*|kimdir|kim kazan\p{L}*|fiyat\p{L}*|ne kadar|ka[cç] para|puan durumu|skor\p{L}*|202[4-9]|2030|galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|trabzonspor)(?![\p{L}])/u;

const CHITCHAT_PATTERN =
  /^(?:merhaba|selam|selamlar|hey|hi|hello|thanks|thank you|teşekkür(?:ler)?|tesekkur(?:ler)?|günaydın|gunaydin|iyi geceler|nasılsın|nasilsin|how are you|ok|okay|tamam)[!.?\s]*$|\b(?:tell me a joke|explain this clearly|help me plan my day|para biriktirmek|ne yapmal[ıi]y[ıi]m|what should i (?:do|say))\b|şaka yap|fıkra anlat|fikra anlat/;

const DOCUMENT_PATTERN =
  /\b(document|artifact|spreadsheet|script|excel file|csv file|write a file|create a file)\b|belge|doküman|dosya oluştur|dosya yarat|tablo dosyası/;

const FIXTURE_PATTERN_EN =
  /\b(next|upcoming|last|latest)\b.{0,40}\b(match|game|fixture|kick-?off|result|score)\b|\b(match|game|fixture|kick-?off)\b.{0,40}\b(next|upcoming|when|score|result)\b|\b(score|result)\b.{0,40}\b(match|game|fixture)\b|\bfixtures?\b|\bkick-?off\b/i;
const FIXTURE_PATTERN_TR =
  /(?<![\p{L}])(?:sıradaki|siradaki|bir sonraki|bi(?:r)? dahaki|sonraki ma\p{L}*|gelecek ma\p{L}*|fikst[uü]r\p{L}*|maç sonucu|mac sonucu|son ma\p{L}*|sonuç|sonuc|skor\p{L}*|ne zaman.{0,40}ma[cç]|ma[cç]\p{L}*.{0,24}ne zaman)(?![\p{L}])/iu;

const LOCAL_COMMAND_PATTERN =
  /\b(demo|mock|fictional|sample|test inbox|my home city|set my city|my city is|i live in|i'?m based in|home is in|my schedules|scheduled tasks|recurring tasks|cancel schedule|customize your personality|change your personality|remember my preferred style|set your personality)\b|hayal[iî]|örnek gelen kutusu|sahte e.?posta|ev şehrim|şehrim|yaşıyorum|zamanlanmış görev|planlanmış görev|görevlerimi listele|görevi iptal|kişiliğini değiştir|tarzını kaydet|kişiselleştir/;

/** Tools that change stored state; never offered in a turn that reads web content. */
const STATE_CHANGING_TOOLS: readonly ChatToolName[] = [
  "setHomeLocation",
  "setSoul",
  "cancelSchedule",
  "createDocument",
  "editDocument",
  "updateDocument",
  "requestSuggestions",
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
    (DOCUMENT_PATTERN.test(phrase) || LOCAL_COMMAND_PATTERN.test(phrase)) &&
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
