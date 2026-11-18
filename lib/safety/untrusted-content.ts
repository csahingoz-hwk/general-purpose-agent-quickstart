export type InjectionSignal =
  | "ignore_instructions"
  | "role_override"
  | "tool_spoof"
  | "markdown_exfiltration"
  | "fence_breakout";

const IGNORE_PATTERN =
  /\b(ignore (?:all |any )?(?:previous|prior|above) (?:instructions|rules|prompts)|disregard (?:all )?(?:prior|previous|above) (?:instructions|rules)|forget everything above)\b|önceki talimatları unut|yukarıdaki kuralları yok\s?say/i;

const ROLE_OVERRIDE_PATTERN =
  /(?:^|\n)\s*(?:system|developer)\s*:|<\|\s*im_start\s*\|>|\byou are now in developer mode\b|artık sistem yöneticisisin/i;

const TOOL_SPOOF_PATTERN =
  /<\s*\/?\s*tool_call\s*>|\b(?:draftOutboundMessage|gmailCreateDraft|driveCreateDraftDoc|setSoul|scheduleTask|cancelSchedule|deleteVaultSecret)\s*\(/i;

const MARKDOWN_EXFIL_PATTERN =
  /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+(?:\?[^)\s]*(?:secret|token|key|email|body|data)=|\b(?:webhook|exfil|ngrok)\b)/i;

const FENCE_TAG_PATTERN = /<\s*\/?\s*untrusted_content\b/i;

export function stripControlAndBidiChars(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    const isAsciiControl =
      (code >= 0x00 && code <= 0x1f && !isAllowedWhitespace) || code === 0x7f;
    const isBidiOrZeroWidth =
      code === 0x00_ad ||
      (code >= 0x20_0b && code <= 0x20_0f) ||
      (code >= 0x20_2a && code <= 0x20_2e) ||
      (code >= 0x20_60 && code <= 0x20_69) ||
      code === 0xfe_ff ||
      (code >= 0xe_00_00 && code <= 0xe_00_7f);
    if (!isAsciiControl && !isBidiOrZeroWidth) {
      out += ch;
    }
  }
  return out;
}

export function detectPromptInjection(input: string): {
  suspicious: boolean;
  signals: InjectionSignal[];
} {
  const cleaned = stripControlAndBidiChars(input);
  const signals: InjectionSignal[] = [];

  if (IGNORE_PATTERN.test(cleaned)) {
    signals.push("ignore_instructions");
  }
  if (ROLE_OVERRIDE_PATTERN.test(cleaned)) {
    signals.push("role_override");
  }
  if (TOOL_SPOOF_PATTERN.test(cleaned)) {
    signals.push("tool_spoof");
  }
  if (MARKDOWN_EXFIL_PATTERN.test(cleaned)) {
    signals.push("markdown_exfiltration");
  }
  if (FENCE_TAG_PATTERN.test(input) || FENCE_TAG_PATTERN.test(cleaned)) {
    signals.push("fence_breakout");
  }

  return {
    suspicious: signals.length > 0,
    signals,
  };
}

export function fenceUntrustedContent({
  text,
  source,
  maxChars = 8000,
}: {
  text: string;
  source: string;
  maxChars?: number;
}): {
  fencedText: string;
  suspicious: boolean;
  signals: InjectionSignal[];
  truncated: boolean;
  originalLength: number;
} {
  const originalLength = text.length;
  const cleaned = stripControlAndBidiChars(text);
  const detection = detectPromptInjection(text);

  const safeLimit = Math.max(64, maxChars);
  const truncated = cleaned.length > safeLimit;
  const sliced = truncated ? `${cleaned.slice(0, safeLimit)}…` : cleaned;

  const escapedBody = sliced.replace(
    /<\s*(\/?)\s*untrusted_content\b/gi,
    "&lt;$1untrusted_content"
  );
  const safeSource =
    source.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 64) || "external";

  const fencedText = `<untrusted_content source="${safeSource}" trust="untrusted" suspicious="${detection.suspicious}">\n${escapedBody}\n</untrusted_content>`;

  return {
    fencedText,
    suspicious: detection.suspicious,
    signals: detection.signals,
    truncated,
    originalLength,
  };
}
