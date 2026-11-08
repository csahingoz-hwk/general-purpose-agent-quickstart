import type { ChatMessage } from "@/lib/types";

export const AVAILABLE_CHAT_TOOLS = [
  "getWeather",
  "demoInbox",
  "createDocument",
  "editDocument",
  "updateDocument",
  "requestSuggestions",
  "listMySchedules",
  "cancelSchedule",
  "setSoul",
] as const;

export type ChatToolName = (typeof AVAILABLE_CHAT_TOOLS)[number];

function userText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

/** Only offer the model tools relevant to what the owner actually asked. */
export function selectActiveTools(
  messages: ChatMessage[],
  canPersonalize: boolean
): ChatToolName[] {
  const recentUserText = messages
    .filter((msg) => msg.role === "user")
    .slice(-2)
    .map(userText);
  const latest = recentUserText.at(-1) ?? "";
  // Allow "London" as a follow-up to "what's the weather?" without
  // advertising weather tools on unrelated turns.
  const contextual = latest.length <= 55 ? recentUserText.join(" ") : latest;
  const phrase = contextual.toLocaleLowerCase("en");
  const enabled: ChatToolName[] = [];

  if (
    /weather|forecast|temperature|rain|havadurumu|hava durumu|yağmur|sıcaklık|sicaklik|kaç derece|kac derece/.test(
      phrase
    )
  ) {
    enabled.push("getWeather");
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
    enabled.push("createDocument");
    if (
      /\b(edit|update|revise|change|fix|modify|suggestions)\b|düzenle|güncelle|değiştir|öneri/.test(
        phrase
      )
    ) {
      enabled.push("editDocument", "updateDocument", "requestSuggestions");
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

  return [...new Set(enabled)];
}

export function needsArtifactInstructions(names: readonly ChatToolName[]): boolean {
  return names.some((name) =>
    [
      "createDocument",
      "editDocument",
      "updateDocument",
      "requestSuggestions",
    ].includes(name)
  );
}
