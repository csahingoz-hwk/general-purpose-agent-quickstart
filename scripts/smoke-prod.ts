import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { webSearchView } from "../lib/web-search-sources";

const DEFAULT_BASE_URL =
  "https://general-purpose-agent-quickstart-mocha.vercel.app";

type CheckStatus = "PASS" | "FAIL" | "SKIP";

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type ParsedChatStream = {
  httpStatus: number;
  modelId: string | null;
  modelName: string | null;
  isFallback: boolean;
  escalated: boolean;
  text: string;
  searchUrls: string[];
  emptySearchCards: number;
  visualSucceeded: boolean;
  errorCards: string[];
  streamErrors: string[];
};

async function resolveAuthCookieHeader(baseUrl: string): Promise<{
  header: string | null;
  source: string;
}> {
  const directCookie = process.env.SMOKE_COOKIE?.trim();
  if (directCookie) {
    return { header: directCookie, source: "SMOKE_COOKIE" };
  }

  const secret = process.env.AUTH_SECRET?.trim();
  const ownerEmail = process.env.APP_OWNER_EMAIL?.trim();
  if (secret && ownerEmail) {
    const isHttps = baseUrl.startsWith("https://");
    const cookieName = isHttps
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";
    const userId =
      process.env.SMOKE_USER_ID?.trim() ||
      "97a9a7c5-e220-425d-9589-7e63b607ca75";
    const token = await encode({
      secret,
      salt: cookieName,
      token: { id: userId, email: ownerEmail, type: "regular" },
    });
    return {
      header: `${cookieName}=${token}`,
      source: "AUTH_SECRET+APP_OWNER_EMAIL",
    };
  }

  return { header: null, source: "none" };
}

async function runChatTurn(opts: {
  baseUrl: string;
  cookieHeader: string;
  prompt: string;
  selectedChatModel: string;
}): Promise<ParsedChatStream> {
  const chatId = randomUUID();
  const messageId = randomUUID();
  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: opts.cookieHeader,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      id: chatId,
      message: {
        id: messageId,
        role: "user",
        parts: [{ type: "text", text: opts.prompt }],
      },
      selectedChatModel: opts.selectedChatModel,
      selectedVisibilityType: "private",
      timeZone: "Europe/Istanbul",
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const out: ParsedChatStream = {
    httpStatus: res.status,
    modelId: null,
    modelName: null,
    isFallback: false,
    escalated: false,
    text: "",
    searchUrls: [],
    emptySearchCards: 0,
    visualSucceeded: false,
    errorCards: [],
    streamErrors: [],
  };

  if (!res.ok || !res.body) {
    return out;
  }

  const toolNameByCallId = new Map<string, string>();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";

  const handleChunk = (raw: string) => {
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof chunk.type === "string" ? chunk.type : "";

    if (type === "text-delta" && typeof chunk.delta === "string") {
      out.text += chunk.delta;
      return;
    }

    if (type === "error") {
      out.streamErrors.push(String(chunk.errorText ?? "stream_error"));
      return;
    }

    if (
      type === "data-model-used" &&
      chunk.data &&
      typeof chunk.data === "object"
    ) {
      const d = chunk.data as Record<string, unknown>;
      if (typeof d.modelId === "string") {
        out.modelId = d.modelId;
      }
      if (typeof d.modelName === "string") {
        out.modelName = d.modelName;
      }
      out.isFallback = d.isFallback === true;
      out.escalated = d.escalated === true;
      return;
    }

    if (
      (type === "tool-input-start" || type === "tool-input-available") &&
      typeof chunk.toolCallId === "string" &&
      typeof chunk.toolName === "string"
    ) {
      toolNameByCallId.set(chunk.toolCallId, chunk.toolName);
      return;
    }

    if (type === "tool-output-error") {
      const name =
        typeof chunk.toolCallId === "string"
          ? (toolNameByCallId.get(chunk.toolCallId) ?? "tool")
          : "tool";
      out.errorCards.push(`${name}: ${String(chunk.errorText ?? "error")}`);
      return;
    }

    if (type === "tool-output-available") {
      const callId =
        typeof chunk.toolCallId === "string" ? chunk.toolCallId : "";
      const name = toolNameByCallId.get(callId) ?? "";
      const output = chunk.output as Record<string, unknown> | undefined;

      if (name === "webSearch" || chunk.providerExecuted === true) {
        if (
          output &&
          typeof output === "object" &&
          output.skippedForSynthesis === true
        ) {
          return;
        }
        const view = webSearchView(output);
        if (view.kind === "results") {
          for (const s of view.sources) {
            if (s.url && !out.searchUrls.includes(s.url)) {
              out.searchUrls.push(s.url);
            }
          }
        } else if (view.kind === "empty" || view.kind === "error") {
          out.emptySearchCards += 1;
        }
        return;
      }

      if (
        name === "buildHtmlPageOrDashboard" &&
        output &&
        output.status === "ok"
      ) {
        out.visualSucceeded = true;
        return;
      }

      if (
        output &&
        typeof output === "object" &&
        (output.status === "error" ||
          typeof output.error === "string" ||
          /ENOENT|no such file or directory/i.test(
            String(output.message ?? "")
          ))
      ) {
        out.errorCards.push(
          `${name || "tool"}: ${String(output.message ?? output.error ?? "error")}`
        );
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += value;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") {
        continue;
      }
      handleChunk(dataStr);
    }
  }
  if (buf.trim().startsWith("data:")) {
    const dataStr = buf.trim().slice(5).trim();
    if (dataStr && dataStr !== "[DONE]") {
      handleChunk(dataStr);
    }
  }

  return out;
}

async function main() {
  const baseUrl = (
    process.env.SMOKE_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const strictAuth = process.argv.includes("--strict-auth");
  const results: CheckResult[] = [];

  console.log(`\nPost-deploy smoke check -> ${baseUrl}\n`);

  // 1. Public reachability check (/login)
  try {
    const loginRes = await fetch(`${baseUrl}/login`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const ok = loginRes.status === 200 || loginRes.status === 307;
    results.push({
      name: "Public reachability (/login)",
      status: ok ? "PASS" : "FAIL",
      detail: `HTTP ${loginRes.status}`,
    });
  } catch (err) {
    results.push({
      name: "Public reachability (/login)",
      status: "FAIL",
      detail: err instanceof Error ? err.message : "Network error",
    });
  }

  // 2. Unauthenticated fail-closed guard (/api/usage must return 401)
  try {
    const unauthUsage = await fetch(`${baseUrl}/api/usage`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    results.push({
      name: "Auth guard fail-closed (/api/usage without cookie)",
      status: unauthUsage.status === 401 ? "PASS" : "FAIL",
      detail: `HTTP ${unauthUsage.status}`,
    });
  } catch (err) {
    results.push({
      name: "Auth guard fail-closed (/api/usage without cookie)",
      status: "FAIL",
      detail: err instanceof Error ? err.message : "Network error",
    });
  }

  // 3. Authenticated checks
  const auth = await resolveAuthCookieHeader(baseUrl);
  let sessionAuthenticated = false;
  if (auth.header) {
    try {
      const sessRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Cookie: auth.header },
        signal: AbortSignal.timeout(15_000),
      });
      const sessJson = (await sessRes.json().catch(() => null)) as {
        user?: { email?: string };
      } | null;
      sessionAuthenticated = Boolean(sessRes.ok && sessJson?.user?.email);
      results.push({
        name: `Owner session (${auth.source})`,
        status: sessionAuthenticated ? "PASS" : "FAIL",
        detail: sessionAuthenticated
          ? "Authenticated owner session active"
          : `HTTP ${sessRes.status} (session not authenticated — verify cookie/secret matches target deployment)`,
      });
    } catch (err) {
      results.push({
        name: `Owner session (${auth.source})`,
        status: "FAIL",
        detail: err instanceof Error ? err.message : "Session check failed",
      });
    }
  } else {
    results.push({
      name: "Authenticated chat & usage checks",
      status: strictAuth ? "FAIL" : "SKIP",
      detail:
        "No owner auth provided in env (set SMOKE_COOKIE or AUTH_SECRET + APP_OWNER_EMAIL to run live /api/chat and /api/usage checks).",
    });
  }

  if (auth.header && sessionAuthenticated) {
    // 3a. Usage endpoint check (no fake $2000/$40 cap when disconnected)
    try {
      const usageRes = await fetch(`${baseUrl}/api/usage`, {
        headers: { Cookie: auth.header },
        signal: AbortSignal.timeout(15_000),
      });
      const usageJson = (await usageRes.json()) as {
        gcpBilling?: {
          reachable?: boolean;
          monthlyCreditLimitUsd?: number | null;
          creditsRemainingUsd?: number | null;
        };
      };
      const gcp = usageJson.gcpBilling;
      const noFakeCap =
        gcp?.reachable === true ||
        (gcp?.monthlyCreditLimitUsd === null &&
          gcp?.creditsRemainingUsd === null);
      results.push({
        name: "Usage API (no fake $2000/$40 cap when disconnected)",
        status: usageRes.ok && noFakeCap ? "PASS" : "FAIL",
        detail: `HTTP ${usageRes.status}, reachable=${String(gcp?.reachable)}, limit=${String(gcp?.monthlyCreditLimitUsd)}, remaining=${String(gcp?.creditsRemainingUsd)}`,
      });
    } catch (err) {
      results.push({
        name: "Usage API (no fake $2000/$40 cap when disconnected)",
        status: "FAIL",
        detail: err instanceof Error ? err.message : "Usage check failed",
      });
    }

    // 3b. News/search prompt: real search result with URL (not "Sonuç bulunamadı")
    try {
      const newsTurn = await runChatTurn({
        baseUrl,
        cookieHeader: auth.header,
        prompt: "Bana bugünün öne çıkan AI dünyası haberlerinden verir misin?",
        selectedChatModel: "gemini-4-neon",
      });
      const ok =
        newsTurn.httpStatus === 200 &&
        newsTurn.searchUrls.length >= 1 &&
        newsTurn.emptySearchCards === 0 &&
        newsTurn.text.trim().length > 20;
      results.push({
        name: "News/search prompt (real dated results with URL)",
        status: ok ? "PASS" : "FAIL",
        detail: `HTTP ${newsTurn.httpStatus}, model=${newsTurn.modelId ?? "unknown"}, urls=${newsTurn.searchUrls.length}, emptyCards=${newsTurn.emptySearchCards}, textChars=${newsTurn.text.length}`,
      });
    } catch (err) {
      results.push({
        name: "News/search prompt (real dated results with URL)",
        status: "FAIL",
        detail: err instanceof Error ? err.message : "News turn failed",
      });
    }

    // 3c. Research prompt: routes to Neon (not Haiku) and never asks permission
    try {
      const researchTurn = await runChatTurn({
        baseUrl,
        cookieHeader: auth.header,
        prompt:
          "2026'da Türkiye enflasyonu hakkında kaynaklı kısa bir analiz yap",
        selectedChatModel: "gemini-4-hydrogen",
      });
      const askedPermission = /Aramayı şimdi başlatmamı ister misiniz/i.test(
        researchTurn.text
      );
      const ok =
        researchTurn.httpStatus === 200 &&
        researchTurn.modelId === "gemini-4-neon" &&
        !researchTurn.isFallback &&
        researchTurn.searchUrls.length >= 1 &&
        !askedPermission;
      results.push({
        name: "Research prompt (routes to Neon, searches, no permission ask)",
        status: ok ? "PASS" : "FAIL",
        detail: `HTTP ${researchTurn.httpStatus}, model=${researchTurn.modelId ?? "unknown"}, fallback=${researchTurn.isFallback}, urls=${researchTurn.searchUrls.length}, askedPermission=${askedPermission}`,
      });
    } catch (err) {
      results.push({
        name: "Research prompt (routes to Neon, searches, no permission ask)",
        status: "FAIL",
        detail: err instanceof Error ? err.message : "Research turn failed",
      });
    }

    // 3d. Visual/dashboard prompt: succeeds with zero ENOENT / Cloud Computer error card
    try {
      const visualTurn = await runChatTurn({
        baseUrl,
        cookieHeader: auth.header,
        prompt:
          "2026 satış performansı için küçük etkileşimli bir HTML dashboard hazırla",
        selectedChatModel: "gemini-4-hydrogen",
      });
      const hasEnoent = visualTurn.errorCards.some((e) =>
        /ENOENT|cloudExportFileToChat|cloudReadFile|Bulut Bilgisayar/i.test(e)
      );
      const ok =
        visualTurn.httpStatus === 200 &&
        visualTurn.visualSucceeded &&
        visualTurn.errorCards.length === 0 &&
        !hasEnoent;
      results.push({
        name: "Visual/dashboard prompt (no ENOENT / Cloud Computer error card)",
        status: ok ? "PASS" : "FAIL",
        detail: `HTTP ${visualTurn.httpStatus}, visualOk=${visualTurn.visualSucceeded}, errorCards=${visualTurn.errorCards.length}, model=${visualTurn.modelId ?? "unknown"}`,
      });
    } catch (err) {
      results.push({
        name: "Visual/dashboard prompt (no ENOENT / Cloud Computer error card)",
        status: "FAIL",
        detail: err instanceof Error ? err.message : "Visual turn failed",
      });
    }
  }

  for (const r of results) {
    console.log(`[${r.status}] ${r.name} — ${r.detail}`);
  }

  const failedCount = results.filter((r) => r.status === "FAIL").length;
  const skippedCount = results.filter((r) => r.status === "SKIP").length;
  console.log(
    `\nSummary: ${results.length - failedCount - skippedCount} passed, ${failedCount} failed, ${skippedCount} skipped.\n`
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

await main();
