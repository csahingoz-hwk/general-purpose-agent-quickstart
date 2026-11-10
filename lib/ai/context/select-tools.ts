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
] as const;

export type ChatToolName = (typeof AVAILABLE_CHAT_TOOLS)[number];

const WEATHER_PATTERN =
  /weather|forecast|temperature|rain|havadurumu|hava durumu|hava nasıl|hava nasil|yağmur|sıcaklık|sicaklik|kaç derece|kac derece/;

/**
 * Explicit search / "current facts" intent in English and Turkish. Turkish words
 * use unicode-aware boundaries because JS \b is ASCII-only ("güncelle" = update
 * must not match "güncel"; "para"/"araba" must not match "ara").
 */
const SEARCH_PATTERN_EN =
  /\b(search|look(?:ing)? (?:it |this |that |them )?up|google|find (?:it |this |that |out )?(?:online|on the web)|on the web|web search|latest|news|breaking|who won|(?:current|today'?s|live) (?:price|prices|score|scores|result|results|rate|rates|exchange rate)|exchange rate|stock price|share price)\b/;
const SEARCH_PATTERN_TR =
  /(?<![\p{L}])(?:ara|arar mısın|arama yap\p{L}*|araştır\p{L}*|internette|internetten|güncel|haber|haberler\p{L}*|haberi|son dakika|bugünkü|bugunku|kim kazandı|maç sonucu|dolar kaç|euro kaç|altın fiyat\p{L}*)(?![\p{L}])/u;

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
  const phrase = latest.toLocaleLowerCase("en");
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
    ? recentUserText.join(" ").toLocaleLowerCase("en")
    : phrase;
  const enabled: ChatToolName[] = [];

  if (WEATHER_PATTERN.test(weatherPhrase)) {
    enabled.push("getWeather");
  }

  if (
    /\b(what time|current time|time is it|what day|today'?s date|what'?s the date|date today|time zone|timezone|daylight saving|dst|clocks? (go|change))\b|saat kaç|saat kac|saat dilimi|yaz saati|kış saati|bugün günlerden|bugünün tarihi|tarih ne|günlerden ne/.test(
      phrase
    )
  ) {
    enabled.push("getCurrentTime");
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

  // A weather question in the latest message is answered by getWeather, never by
  // a paid web search.
  if (
    webSearchAvailable &&
    !WEATHER_PATTERN.test(phrase) &&
    (SEARCH_PATTERN_EN.test(phrase) || SEARCH_PATTERN_TR.test(phrase))
  ) {
    // Search results are untrusted web content: from this turn onward only
    // read-only tools may sit beside webSearch.
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
