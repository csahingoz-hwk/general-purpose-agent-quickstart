import {
  collectErrorChain,
  failureKind,
  ModelFailure,
} from "@/lib/ai/routing/policy";

/** Never pass raw upstream error JSON, API URLs or organisation IDs to the UI. */
export function classifyModelError(
  error: unknown
): "size" | "rate" | "unavailable" {
  const kind = failureKind(error);
  if (kind === "context") {
    return "size";
  }
  if (kind === "rate") {
    return "rate";
  }
  for (const link of collectErrorChain(error)) {
    const status =
      link && typeof link === "object" && "statusCode" in link
        ? Number(link.statusCode)
        : null;
    const text =
      link instanceof Error
        ? link.message
        : typeof link === "string"
          ? link
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
      /rate.limit|tokens per minute|quota exceeded|resource_exhausted|current usage limit was reached|kullanım sınırına ulaşıldı/i.test(
        text
      )
    ) {
      return "rate";
    }
  }
  return "unavailable";
}

export function isTurkishMessage(text: string): boolean {
  if (/[çğıöşüÇĞİÖŞÜ]/.test(text)) {
    return true;
  }
  return /\b(merhaba|nasıl|neden|nedir|nelerdir|şu anda|istiyorum|lütfen|göster|cevap|mısın|misin|hakkında)\b/i.test(
    text
  );
}

export function safeModelError(error: unknown, userText: string): string {
  const raw = collectErrorChain(error)
    .map((link) =>
      link instanceof Error
        ? link.message
        : typeof link === "string"
          ? link
          : ""
    )
    .filter(Boolean)
    .join(" ");
  const tr = isTurkishMessage(userText);
  const wrappedModelFailure = collectErrorChain(error).find(
    (link): link is ModelFailure => link instanceof ModelFailure
  );
  const mfCode = wrappedModelFailure?.code;
  if (
    mfCode === "work_boundary" ||
    /model_work_boundary|Korn Ferry/i.test(raw)
  ) {
    return tr
      ? "Engellendi: Korn Ferry veya işveren gizli verileri kişisel Google AI modellerine gönderilemez."
      : "Blocked: Korn Ferry or employer confidential material cannot be sent to personal Google AI models.";
  }
  if (
    mfCode === "billing" ||
    /model_billing|spending allowance or account credit limit|Sağlayıcı kredi sınırına/.test(
      raw
    )
  ) {
    return tr
      ? "Sağlayıcı (Google Cloud / Vertex AI) hesap kredi sınırına ulaşıldı. Sohbetin kayıtlı; kapasite açıldığında buradan devam edebilirsin."
      : "Upstream provider credit limit reached. Your conversation is saved; you can continue here when capacity is available.";
  }
  if (
    mfCode === "auth" ||
    /model_auth|account connection needs attention|Sohbet bağlantısının hesap ayarları/.test(
      raw
    )
  ) {
    return tr
      ? "Sohbet bağlantısının hesap ayarları kontrol edilmeli. Mesajın kayıtlı."
      : "Chat's account connection needs attention. Your message is saved.";
  }
  if (
    mfCode === "context" ||
    /model_context|needs a shorter context|Bu istek mevcut bağlama/.test(raw)
  ) {
    return tr
      ? "Bu istek mevcut bağlama sığmıyor. Sohbetin kayıtlı; daha kısa bir istekle devam edebilirsin."
      : "This request needs a shorter context. Your conversation is saved; try a smaller request.";
  }
  if (
    mfCode === "rate" ||
    /model_rate|account.s current rate limit|Hesabın şu anki kullanım sınırına/.test(
      raw
    )
  ) {
    return tr
      ? "Vertex AI kota veya anlık istek hızı sınırına (429) ulaşıldı. Biraz sonra aynı sohbetten yeniden deneyebilirsin."
      : "Vertex AI quota or rate limit (429) was reached. Please retry in this conversation shortly.";
  }
  const code = classifyModelError(error);
  if (code === "size") {
    return tr
      ? "Sohbet bu modelin geçerli istek sınırını aştı. Daha kısa bir istek deneyebilir veya mevcut sohbetten devam edebilirsiniz."
      : "This request exceeded the model's size limit. Try a shorter request or continue in this chat.";
  }
  if (code === "rate") {
    return tr
      ? "Vertex AI kota veya anlık istek hızı sınırına (429) ulaşıldı. Biraz sonra aynı sohbetten yeniden deneyebilirsin."
      : "The model's current usage limit was reached. Please retry shortly.";
  }
  return tr
    ? "Yanıt şu anda tamamlanamadı. Mesajın kayıtlı — yeniden denemek için aşağıdaki düğmeye dokun."
    : "Couldn't finish this reply right now. Your message is saved — tap Retry response below to try again.";
}
