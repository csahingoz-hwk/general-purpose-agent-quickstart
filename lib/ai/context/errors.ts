/** Never pass raw upstream error JSON, API URLs or organisation IDs to the UI. */
export function classifyModelError(
  error: unknown
): "size" | "rate" | "unavailable" {
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode)
      : null;
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    status === 413 ||
    /request too large|tokens per minute.*requested|context.length|chat_context_budget/i.test(
      text
    )
  ) {
    return "size";
  }
  if (
    status === 429 ||
    /rate.limit|tokens per minute|quota exceeded/i.test(text)
  ) {
    return "rate";
  }
  return "unavailable";
}

export function isTurkishMessage(text: string): boolean {
  if (/[çğıöşüÇĞİÖŞÜ]/.test(text)) {
    return true;
  }
  return /\b(merhaba|nasıl|neden|şu anda|istiyorum|lütfen|göster|cevap|mısın|misin|hakkında)\b/i.test(
    text
  );
}

export function safeModelError(error: unknown, userText: string): string {
  const code = classifyModelError(error);
  const tr = isTurkishMessage(userText);
  if (code === "size") {
    return tr
      ? "Sohbet bu modelin geçerli istek sınırını aştı. Daha kısa bir istek deneyebilir veya mevcut sohbetten devam edebilirsiniz. Ücretli modele geçilmedi."
      : "This request exceeded the model's size limit. Try a shorter request or continue in this chat. No paid model was used.";
  }
  if (code === "rate") {
    return tr
      ? "Modelin kullanım sınırına ulaşıldı. Biraz sonra yeniden deneyebilirsiniz. Ücretli modele geçilmedi."
      : "The model's current usage limit was reached. Please retry shortly. No paid fallback was used.";
  }
  return tr
    ? "Yanıt tamamlanamadı. Mesajın kayıtlı; yeniden deneyebilirsin."
    : "Couldn't finish the reply. Your message is saved; you can retry.";
}
