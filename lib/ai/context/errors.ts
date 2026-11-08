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
    /request too large|tokens per minute.*requested|context.length|chat_context_budget|model's size limit|geçerli istek sınırını aştı/i.test(
      text
    )
  ) {
    return "size";
  }
  if (
    status === 429 ||
    /rate.limit|tokens per minute|quota exceeded|current usage limit was reached|kullanım sınırına ulaşıldı/i.test(
      text
    )
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
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const tr = isTurkishMessage(userText);
  if (
    /model_(billing|spend)|spend_configuration|spending allowance or account credit limit|Kullanım bütçesi veya hesap kredisi/.test(
      raw
    )
  ) {
    return tr
      ? "Kullanım bütçesi veya hesap kredisi sınırına ulaşıldı. Sohbetin kayıtlı; kapasite yeniden açıldığında buradan devam edebilirsin."
      : "The spending allowance or account credit limit has been reached. Your conversation is saved; you can continue here when capacity is available.";
  }
  if (
    /model_auth|account connection needs attention|Sohbet bağlantısının hesap ayarları/.test(
      raw
    )
  ) {
    return tr
      ? "Sohbet bağlantısının hesap ayarları kontrol edilmeli. Mesajın kayıtlı."
      : "Chat's account connection needs attention. Your message is saved.";
  }
  if (
    /model_context|needs a shorter context|Bu istek mevcut bağlama/.test(raw)
  ) {
    return tr
      ? "Bu istek mevcut bağlama sığmıyor. Sohbetin kayıtlı; daha kısa bir istekle devam edebilirsin."
      : "This request needs a shorter context. Your conversation is saved; try a smaller request.";
  }
  if (
    /model_rate|account.s current rate limit|Hesabın şu anki kullanım sınırına/.test(
      raw
    )
  ) {
    return tr
      ? "Hesabın şu anki kullanım sınırına ulaşıldı. Biraz sonra aynı sohbetten yeniden deneyebilirsin."
      : "The account's current rate limit was reached. Please retry in this conversation shortly.";
  }
  const code = classifyModelError(error);
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
