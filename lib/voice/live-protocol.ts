/**
 * Shared, dependency-free building blocks for the hands-free Live Voice mode.
 *
 * Runs in the browser (engine + UI) and in Node (unit tests + build self-check),
 * so it must not import server-only modules.
 */

export const LIVE_INPUT_SAMPLE_RATE = 16_000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;
/** 40 ms of 16 kHz mono PCM: 640 samples / 1280 bytes per realtimeInput message. */
export const LIVE_FRAME_SAMPLES = 640;
export const LIVE_FRAME_MS = 40;
/**
 * Single Live Voice model config value. Update this one constant to
 * `"gemini-4-live"` as soon as Google releases Gemini 4 Live (or set
 * `GEMINI_LIVE_MODEL` in Vercel env vars).
 */
export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
export const DEFAULT_GATEWAY_LIVE_MODEL = `google/${DEFAULT_LIVE_MODEL}`;
export const DEFAULT_LIVE_VOICE = "Kore";

export type LiveTransportKind = "gateway" | "google-direct";

export type LiveToolDeclaration = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const APPROVAL_REQUIRED_VOICE_TOOLS = new Set<string>([
  "gmailCreateDraft",
  "driveCreateDraftDoc",
  "calendarCreateDraftEvent",
  "githubCreateDraftReview",
  "draftOutboundMessage",
  "scheduleTask",
  "cancelSchedule",
]);

export const LIVE_VOICE_TOOL_DECLARATIONS: readonly LiveToolDeclaration[] = [
  {
    type: "function",
    name: "handOffToTextAgent",
    description:
      "Hand real personal work (checking Gmail inbox, finding an email and drafting a reply, reading or creating Calendar events, Drive lookups, or multi-step operator requests) to the shared text agent so it runs the exact same tools, memory, and approval rules, places any cards in chat, and returns a concise spoken summary for you to read aloud.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description:
            "The owner's full natural-language request in their spoken language (Turkish or English).",
        },
      },
      required: ["request"],
    },
  },
  {
    type: "function",
    name: "gmailReadMessages",
    description:
      "Read recent Gmail emails from the owner's connected Google account (unread inbox, messages from a person, or search query).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional Gmail search query such as 'is:unread' or 'from:Ali'.",
        },
        maxResults: {
          type: "number",
          description: "Max emails to return (1 to 10, default 5).",
        },
      },
    },
  },
  {
    type: "function",
    name: "calendarReadEvents",
    description:
      "Read upcoming events on the owner's connected Google Calendar.",
    parameters: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "Optional ISO start time." },
        maxResults: {
          type: "number",
          description: "Max events to return (1 to 15, default 8).",
        },
      },
    },
  },
  {
    type: "function",
    name: "driveReadFiles",
    description:
      "Search or read recent files in the owner's connected Google Drive.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filename or keyword in Drive." },
        maxResults: {
          type: "number",
          description: "Max files to return (1 to 10, default 5).",
        },
      },
    },
  },
  {
    type: "function",
    name: "githubReadPullRequests",
    description:
      "List open pull requests for a repository using the owner's connected GitHub account.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    type: "function",
    name: "getWeather",
    description:
      "Check current weather and 3-day forecast (temperature, rain chance, highs/lows) via Open-Meteo. Defaults to London if no city is named.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description:
            "City name (e.g. 'London', 'Istanbul', 'Ankara'). Omit to use London / saved home city.",
        },
      },
    },
  },
  {
    type: "function",
    name: "getCurrentTime",
    description:
      "Get exact current time and date in Europe/London or another requested IANA timezone.",
    parameters: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "IANA timezone such as 'Europe/London'.",
        },
      },
    },
  },
  {
    type: "function",
    name: "webSearch",
    description:
      "Search the live web for current news, league-wide fixtures or standings, prices, exchange rates, scores, or up-to-date public facts. Always keep the user's exact subject (league, team, city, or product name, e.g. 'Süper Lig') verbatim in the query, in the user's language.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Concise web search query in the user's language keeping the exact subject verbatim (e.g. 'Süper Lig bu haftaki maç programı', never generic 'this week's football fixtures').",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "getFixtures",
    description:
      "Look up a single football club's domestic league schedule, next match, local kickoff time, and latest score. Coverage may be domestic league only — for Champions League, Europa League, Conference League, cup, national-team, or league-wide (such as 'Süper Lig') questions, call webSearch instead.",
    parameters: {
      type: "object",
      properties: {
        team: { type: "string", description: "Club name, e.g. 'Galatasaray'." },
      },
      required: ["team"],
    },
  },
  {
    type: "function",
    name: "recallMemories",
    description:
      "Search the owner's saved profile facts and journal notes from long-term memory.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional keyword filter." },
      },
    },
  },
  {
    type: "function",
    name: "saveProfileFact",
    description:
      "Save one self-contained durable fact sentence to the owner's memory (never store passwords, card numbers, or street addresses).",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "rules",
            "preferences",
            "about_me",
            "family",
            "work",
            "projects",
          ],
        },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["key", "value"],
    },
  },
  {
    type: "function",
    name: "addJournalEntry",
    description: "Add a timestamped note to the owner's personal journal.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title", "body"],
    },
  },
  {
    type: "function",
    name: "listMySchedules",
    description: "List the owner's active recurring routines and schedules.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "scheduleTask",
    description:
      "Propose a recurring routine (creates an approval card in chat before activating).",
    parameters: {
      type: "object",
      properties: {
        cronExpression: { type: "string" },
        timezone: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["cronExpression", "prompt"],
    },
  },
  {
    type: "function",
    name: "gmailCreateDraft",
    description:
      "Prepare an unsent Gmail draft (places an approval card in chat; never sends without approval).",
    parameters: {
      type: "object",
      properties: {
        recipient: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["recipient", "subject", "body"],
    },
  },
  {
    type: "function",
    name: "calendarCreateDraftEvent",
    description:
      "Prepare a private [DRAFT] Google Calendar event (places an approval card in chat).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        startIso: { type: "string" },
        endIso: { type: "string" },
        description: { type: "string" },
      },
      required: ["summary", "startIso", "endIso"],
    },
  },
  {
    type: "function",
    name: "driveCreateDraftDoc",
    description:
      "Prepare a private [DRAFT] Google Doc in Drive (places an approval card in chat).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["title", "content"],
    },
  },
  {
    type: "function",
    name: "draftOutboundMessage",
    description:
      "Prepare an outbound email/Slack/Telegram message draft on an approval card in chat.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          enum: ["email", "slack", "telegram", "webhook"],
        },
        recipient: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["channel", "recipient", "body"],
    },
  },
  {
    type: "function",
    name: "delegateTask",
    description:
      "Delegate a multi-step task, coding job, Cloud Computer script, or Mac mini CLI run, creating a live Task Card in chat.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        prompt: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "executor",
            "research",
            "coding_worktree",
            "browser_agent",
            "draft_review",
            "routine",
          ],
        },
        target: {
          type: "string",
          enum: ["auto", "cloud", "mac"],
        },
      },
      required: ["title", "prompt"],
    },
  },
  {
    type: "function",
    name: "cloudExec",
    description:
      "Run a shell/git/Python/Node command on the persistent Linux Cloud Computer (/workspace).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Directory inside /workspace." },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "cloudWriteFile",
    description: "Write a file inside /workspace on the Cloud Computer.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    type: "function",
    name: "cloudExportFileToChat",
    description:
      "Export a generated CSV, PDF, PNG, or JPEG file from /workspace into the chat.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "cloudBrowseUrl",
    description:
      "Open a public URL in headless Chromium on the Cloud Computer and extract content or a screenshot.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        captureScreenshot: { type: "boolean" },
      },
      required: ["url"],
    },
  },
  {
    type: "function",
    name: "macExec",
    description:
      "Run a terminal command on the owner's Mac mini over Tailscale SSH inside a logged tmux session as dedicated non-admin user 'botrunner'.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        repoName: { type: "string" },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "macRunAgentCli",
    description:
      "Drive Claude Code, Codex, Antigravity (agy), or T3 CLI inside an isolated 'agent/<slug>' git worktree and logged tmux session on the Mac mini.",
    parameters: {
      type: "object",
      properties: {
        cli: {
          type: "string",
          enum: ["claude", "codex", "agy", "t3", "copilot", "cursor"],
        },
        repoName: { type: "string" },
        branch: { type: "string" },
        prompt: { type: "string" },
        explicitOptIn: { type: "boolean" },
      },
      required: ["cli", "repoName", "branch", "prompt"],
    },
  },
];

const FILLER_EN: Record<string, string> = {
  handOffToTextAgent: "Working on that with your assistant…",
  gmailReadMessages: "Checking your inbox…",
  calendarReadEvents: "Checking your calendar…",
  driveReadFiles: "Searching your Google Drive…",
  githubReadPullRequests: "Checking GitHub pull requests…",
  getWeather: "Checking the weather…",
  getCurrentTime: "Checking the clock…",
  webSearch: "Searching the web…",
  getFixtures: "Checking fixtures…",
  recallMemories: "Checking your memory…",
  saveProfileFact: "Saving to your profile…",
  addJournalEntry: "Adding to your journal…",
  listMySchedules: "Checking your routines…",
  scheduleTask: "Preparing routine approval…",
  gmailCreateDraft: "Preparing Gmail draft approval…",
  calendarCreateDraftEvent: "Preparing Calendar approval…",
  driveCreateDraftDoc: "Preparing Drive draft approval…",
  draftOutboundMessage: "Preparing message approval…",
  delegateTask: "Creating task card…",
  cloudExec: "Running on Cloud Computer…",
  cloudWriteFile: "Writing file on Cloud Computer…",
  cloudExportFileToChat: "Attaching file to chat…",
  cloudBrowseUrl: "Opening page in Cloud Browser…",
  macExec: "Running on your Mac mini…",
  macRunAgentCli: "Starting CLI on your Mac mini…",
};

const FILLER_TR: Record<string, string> = {
  handOffToTextAgent: "Asistanla kontrol ediyorum…",
  gmailReadMessages: "Gelen kutuna bakıyorum…",
  calendarReadEvents: "Takvimine bakıyorum…",
  driveReadFiles: "Google Drive'da arıyorum…",
  githubReadPullRequests: "GitHub PR'larına bakıyorum…",
  getWeather: "Hava durumuna bakıyorum…",
  getCurrentTime: "Saate bakıyorum…",
  webSearch: "Web'de arıyorum…",
  getFixtures: "Fikstüre bakıyorum…",
  recallMemories: "Belleğine bakıyorum…",
  saveProfileFact: "Profiline kaydediyorum…",
  addJournalEntry: "Günlüğüne ekliyorum…",
  listMySchedules: "Rutinlerine bakıyorum…",
  scheduleTask: "Rutin onay kartı hazırlıyorum…",
  gmailCreateDraft: "Gmail taslak onayı hazırlıyorum…",
  calendarCreateDraftEvent: "Takvim onayı hazırlıyorum…",
  driveCreateDraftDoc: "Drive taslak onayı hazırlıyorum…",
  draftOutboundMessage: "Mesaj onayı hazırlıyorum…",
  delegateTask: "Görev kartı oluşturuyorum…",
  cloudExec: "Bulut bilgisayarda çalıştırıyorum…",
  cloudWriteFile: "Bulut bilgisayara dosya yazıyorum…",
  cloudExportFileToChat: "Dosyayı sohbete ekliyorum…",
  cloudBrowseUrl: "Bulut tarayıcıda açıyorum…",
  macExec: "Mac mini'de çalıştırıyorum…",
  macRunAgentCli: "Mac mini'de CLI başlatıyorum…",
};

export const CLIENT_FILLERS_EN: Record<string, string> = {
  handOffToTextAgent: "Working with your assistant…",
  gmailReadMessages: "Checking your inbox…",
  calendarReadEvents: "Checking your calendar…",
  driveReadFiles: "Searching Google Drive…",
  githubReadPullRequests: "Checking GitHub…",
  getWeather: "Checking the weather…",
  getCurrentTime: "Checking the clock…",
  webSearch: "Searching the web…",
  getFixtures: "Checking fixtures…",
  recallMemories: "Checking your memory…",
  saveProfileFact: "Saving to memory…",
  addJournalEntry: "Saving journal note…",
  listMySchedules: "Checking routines…",
  scheduleTask: "Preparing approval card…",
  gmailCreateDraft: "Preparing Gmail draft card…",
  calendarCreateDraftEvent: "Preparing Calendar card…",
  driveCreateDraftDoc: "Preparing Drive draft card…",
  draftOutboundMessage: "Preparing approval card…",
  delegateTask: "Creating task card…",
};

export const CLIENT_FILLERS_TR: Record<string, string> = {
  handOffToTextAgent: "Asistanla kontrol ediyorum…",
  gmailReadMessages: "Gelen kutuna bakıyorum…",
  calendarReadEvents: "Takvimine bakıyorum…",
  driveReadFiles: "Drive'da arıyorum…",
  githubReadPullRequests: "GitHub'a bakıyorum…",
  getWeather: "Hava durumuna bakıyorum…",
  getCurrentTime: "Saate bakıyorum…",
  webSearch: "Web'de arıyorum…",
  getFixtures: "Fikstüre bakıyorum…",
  recallMemories: "Belleğine bakıyorum…",
  saveProfileFact: "Belleğe kaydediyorum…",
  addJournalEntry: "Günlüğe ekliyorum…",
  listMySchedules: "Rutinlerine bakıyorum…",
  scheduleTask: "Onay kartı hazırlıyorum…",
  gmailCreateDraft: "Gmail onay kartı hazırlıyorum…",
  calendarCreateDraftEvent: "Takvim kartı hazırlıyorum…",
  driveCreateDraftDoc: "Drive kartı hazırlıyorum…",
  draftOutboundMessage: "Onay kartı hazırlıyorum…",
  delegateTask: "Görev kartı oluşturuyorum…",
};

export function fillerPhraseForTool(
  toolName: string,
  locale: "en" | "tr" = "en"
): string {
  const map = locale === "tr" ? FILLER_TR : FILLER_EN;
  return (
    map[toolName] ??
    (locale === "tr" ? "Kontrol ediyorum…" : "Checking that now…")
  );
}

const MAX_FILLER_UTTERANCE_CHARS = 120;

function normalizeFillerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\u0307/g, "")
    .replace(/[.…!]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_FILLER_KEYS = new Set<string>(
  [
    ...Object.values(FILLER_EN),
    ...Object.values(FILLER_TR),
    ...Object.values(CLIENT_FILLERS_EN),
    ...Object.values(CLIENT_FILLERS_TR),
    "Kontrol ediyorum…",
    "Checking that now…",
    "Hemen bakıyorum…",
    "Hemen kontrol ediyorum…",
    "Bir saniye…",
    "One moment…",
    "Just a second…",
    "Give me a sec…",
    "I'll get right back to you…",
  ].map(normalizeFillerKey)
);

const FILLER_PHRASE_RE =
  /(?:(?<!\p{L})(?:kontrol\s+ediyorum|bakıyorum|arıyorum|araştırıyorum|inceliyorum|sorguluyorum|hazırlıyorum|oluşturuyorum|kaydediyorum|ekliyorum|çalıştırıyorum|açıyorum|başlatıyorum|getiriyorum)(?!\p{L})|(?<!\p{L})(?:checking|looking(?:\s+(?:into|up|at|for))?|searching|finding|fetching|pulling\s+up|working\s+on|preparing|let\s+me\s+(?:check|look|search|find))(?!\p{L}))/iu;

const NON_FILLER_CONTENT_RE =
  /(?:(?<!\p{L})looking\s+forward(?!\p{L})|(?<!\p{L})(?:finished|done|found|here(?:'s| is| are)|there(?:'s| is| are)|you have|buldum|yok|değil|başarısız|failed|unable|could not|couldn't|oynayacak|oynuyor|oynandı|kazandı|yenildi|berabere|deplasmanda|evinde|stadyum|arena|faces|plays|playing|beat|won|lost|away\s+at|at\s+home|vs\.?|versus)(?!\p{L})|\d{1,2}[:.]\d{2}|\b\d+\s*[-–]\s*\d+\b|\bsaat\s+\d{1,2}\b|\b\d{1,2}\s*(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?!\p{L})|(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|\d+\s*(?:°|%|tl|usd|eur|gbp|puan|gol|maç|unread|emails?|messages?|derece)(?!\p{L}))/iu;

const ACK_PREFIX_CLAUSE_RE =
  /^(?:tamam|tabii|tabi|peki|elbette|anladım|sure|okay|ok|alright|got\s+it|of\s+course|right)$/iu;

const WAIT_FILLER_CLAUSE_RE =
  /^(?:(?:bir|bi)\s+(?:saniye|dakika|an)(?:\s+(?:bekle(?:yin)?|lütfen))?|lütfen\s+bekle(?:yin)?|bekle(?:yin)?\s+lütfen|one\s+moment(?:\s+please)?|just\s+a\s+(?:moment|second|sec)|give\s+me\s+a\s+(?:moment|second|sec)|hang\s+on|hold\s+on(?:\s+a\s+(?:moment|second|sec))?|bear\s+with\s+me)$/iu;

const TR_ACTION_CLAUSE_RE =
  /(?<!\p{L})(?:kontrol\s+ediyorum|bakıyorum|arıyorum|araştırıyorum|inceliyorum|sorguluyorum|hazırlıyorum|oluşturuyorum|kaydediyorum|ekliyorum|çalıştırıyorum|açıyorum|başlatıyorum|getiriyorum)$/iu;

const TR_PROMISE_END_RE =
  /(?<!\p{L})(?:bilgi(?:yi|leri)?\s+vereceğim|haber\s+vereceğim|söyleyeceğim|paylaşacağım|aktaracağım|ileteceğim|döneceğim|vereceğim|bakacağım|kontrol\s+edeceğim|arayacağım)$/iu;

const TR_PROMISE_CUE_RE =
  /(?<!\p{L})(?:hemen|şimdi|birazdan|az\s+sonra|kısa\s+sürede|bilgi(?:yi|leri)?|haber|güncel|detaylı|sonucu|kontrol\s+ed|bakacağım|arayacağım|döneceğim)(?!\p{L})/iu;

const EN_EXPLICIT_FILLER_RE =
  /^(?:(?:sure|okay|ok|alright|got\s+it|one\s+moment|just\s+a\s+(?:moment|second|sec)|give\s+me\s+a\s+(?:moment|second|sec)|hold\s+on|hang\s+on)[,.!]?\s+)*(?:(?:i(?:'m| am)|let\s+me|just)\s+(?:checking|check|looking\s+(?:into|up|at|for)|look\s+(?:into|up|at|for)|searching|search|fetching|pulling\s+up|working\s+on|preparing)(?!\p{L})|(?:checking|looking\s+(?:into|up)|searching|working\s+on|preparing|pulling\s+up)\s+(?:that|this|it|now|your(?!\p{L})|the\s+(?:latest\s+|detailed\s+)?(?:web|weather|clock|fixtures|schedule|scores|standings|news|inbox|calendar|drive|results|details)(?!\p{L})|fixtures(?!\p{L})|online(?!\p{L})|for\s+that(?!\p{L})|for\s+you(?!\p{L})))/iu;

const EN_PROMISE_CLAUSE_RE =
  /^(?:and\s+)?i(?:'ll| will)\s+(?:get\s+(?:right\s+)?back\s+to\s+you|let\s+you\s+know|tell\s+you|share\s+(?:the\s+)?(?:details|results?|update|info|answer)|give\s+you\s+(?:an?\s+update|the\s+(?:latest|details|info|information|answer|results?))|be\s+right\s+back|check\s+(?:that|this|it|on\s+that)(?:\s+(?:right\s+now|now|for\s+you))?|have\s+(?:that|the\s+answer|it)\s+(?:for\s+you\s+)?(?:in\s+a\s+(?:moment|second|sec)|shortly|right\s+away))(?:\s+(?:right\s+away|shortly|in\s+a\s+(?:moment|second|sec)|soon|now))?$/iu;

function classifyFillerClause(clause: string): "ack" | "filler" | "other" {
  const cleaned = clause.replace(/[.!…]+$/u, "").trim();
  if (!cleaned) {
    return "ack";
  }
  if (ACK_PREFIX_CLAUSE_RE.test(cleaned)) {
    return "ack";
  }
  if (
    WAIT_FILLER_CLAUSE_RE.test(cleaned) ||
    TR_ACTION_CLAUSE_RE.test(cleaned) ||
    (TR_PROMISE_END_RE.test(cleaned) && TR_PROMISE_CUE_RE.test(cleaned)) ||
    EN_EXPLICIT_FILLER_RE.test(cleaned) ||
    EN_PROMISE_CLAUSE_RE.test(cleaned)
  ) {
    return "filler";
  }
  return "other";
}

/**
 * Returns true when an assistant voice caption is only a short spoken filler
 * or wait/promise phrase ("Kontrol ediyorum…", "Maç programını kontrol ediyorum...",
 * "Detaylı fikstüre bakıyorum, hemen sana güncel bilgiyi vereceğim.",
 * "Checking that now…", "One moment, I'll get back to you.") that should NOT
 * be persisted as a separate chat bubble. Spoken audio is unaffected.
 */
export function isFillerOnlyUtterance(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return false;
  }
  const normalizedKey = normalizeFillerKey(trimmed);
  if (KNOWN_FILLER_KEYS.has(normalizedKey)) {
    return true;
  }
  if (trimmed.length > MAX_FILLER_UTTERANCE_CHARS) {
    return false;
  }
  if (trimmed.includes("?")) {
    return false;
  }
  const lower = trimmed.toLowerCase().replace(/\u0307/g, "");
  if (NON_FILLER_CONTENT_RE.test(lower)) {
    return false;
  }
  const sentences = lower
    .split(/(?:[.!]+|…)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 2) {
    return false;
  }

  const clauses = lower
    .split(/(?:[.!…]+(?:\s+|$)|\s*[,;]\s+)/u)
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length > 0 && clauses.length <= 3) {
    let sawFiller = false;
    let allFillerOrAck = true;
    for (const clause of clauses) {
      const kind = classifyFillerClause(clause);
      if (kind === "filler") {
        sawFiller = true;
      } else if (kind === "other") {
        allFillerOrAck = false;
        break;
      }
    }
    if (allFillerOrAck && sawFiller) {
      return true;
    }
  }

  const endsWithEllipsis = /(?:…|\.{2,})$/u.test(trimmed);
  if (endsWithEllipsis) {
    return FILLER_PHRASE_RE.test(lower);
  }
  return false;
}

function toGoogleFunctionDeclarations(
  tools?: readonly LiveToolDeclaration[],
  opts?: { vertex?: boolean }
) {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        ...(opts?.vertex ? {} : { behavior: "NON_BLOCKING" as const }),
        parameters: t.parameters,
      })),
    },
  ];
}

/** Only Gemini Live voice models are allowed for the speech-to-speech lane. */
export function isAllowedLiveModel(model: string): boolean {
  return /^(google\/)?gemini-\d+(\.\d+)?-live(-[a-z0-9-]+)?$/.test(
    model.trim()
  );
}

export type LiveVadConfig = {
  disabled: false;
  startOfSpeechSensitivity: "START_SENSITIVITY_LOW" | "START_SENSITIVITY_HIGH";
  endOfSpeechSensitivity: "END_SENSITIVITY_LOW" | "END_SENSITIVITY_HIGH";
  prefixPaddingMs: number;
  silenceDurationMs: number;
};

/**
 * Server VAD tuned for a phone speaker in a normal room:
 * - LOW start sensitivity resists background noise and residual echo.
 * - HIGH end sensitivity commits the turn quickly (lower latency).
 * - 300 ms of speech is required before a start is committed.
 * - 550 ms of silence ends the turn.
 */
export const LIVE_VAD: LiveVadConfig = {
  disabled: false,
  startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
  endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
  prefixPaddingMs: 300,
  silenceDurationMs: 550,
};

/** SDK-shaped LiveConnectConfig (used server-side to lock ephemeral tokens). */
export function buildLiveConnectConfig(opts: {
  systemInstruction: string;
  voiceName?: string;
  resumeHandle?: string | null;
  tools?: readonly LiveToolDeclaration[];
  vertex?: boolean;
}) {
  const googleTools = toGoogleFunctionDeclarations(opts.tools, {
    vertex: opts.vertex,
  });
  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: opts.voiceName ?? DEFAULT_LIVE_VOICE,
        },
      },
    },
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    ...(googleTools ? { tools: googleTools } : {}),
    realtimeInputConfig: {
      automaticActivityDetection: { ...LIVE_VAD },
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
  };
}

/** Raw WebSocket `setup` message body matching the locked token constraints. */
export function buildLiveSetupMessage(opts: {
  model: string;
  systemInstruction: string;
  voiceName?: string;
  resumeHandle?: string | null;
  tools?: readonly LiveToolDeclaration[];
}) {
  const isVertex = opts.model.startsWith("projects/");
  const config = buildLiveConnectConfig({ ...opts, vertex: isVertex });
  const normalizedModel =
    isVertex || opts.model.startsWith("models/")
      ? opts.model
      : `models/${opts.model}`;
  return {
    setup: {
      model: normalizedModel,
      generationConfig: {
        responseModalities: config.responseModalities,
        speechConfig: config.speechConfig,
      },
      systemInstruction: config.systemInstruction,
      ...(config.tools ? { tools: config.tools } : {}),
      realtimeInputConfig: config.realtimeInputConfig,
      inputAudioTranscription: config.inputAudioTranscription,
      outputAudioTranscription: config.outputAudioTranscription,
      contextWindowCompression: config.contextWindowCompression,
      sessionResumption: config.sessionResumption,
    },
  };
}

export function liveConstrainedSocketUrl(token: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURI(token)}`;
}

export function vertexLiveSocketUrl(
  accessToken: string,
  region = "us-central1"
): string {
  return `wss://${encodeURIComponent(region)}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent?access_token=${encodeURIComponent(accessToken)}`;
}

/** Normalized AI Gateway Realtime `session-update` message for Gemini 3.8 Live. */
export function buildGatewayLiveSetupMessage(opts: {
  systemInstruction: string;
  voiceName?: string;
  tools?: readonly LiveToolDeclaration[];
}) {
  return {
    type: "session-update" as const,
    config: {
      instructions: opts.systemInstruction,
      voice: opts.voiceName ?? DEFAULT_LIVE_VOICE,
      outputModalities: ["audio"],
      inputAudioFormat: { type: "audio/pcm", rate: LIVE_INPUT_SAMPLE_RATE },
      outputAudioFormat: { type: "audio/pcm", rate: LIVE_OUTPUT_SAMPLE_RATE },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(opts.tools && opts.tools.length > 0
        ? { tools: [...opts.tools] }
        : {}),
    },
  };
}

export function buildLiveToolOutputItemMessage(
  transport: LiveTransportKind,
  opts: {
    callId: string;
    name: string;
    output: Record<string, unknown>;
  }
) {
  if (transport === "gateway") {
    return {
      type: "conversation-item-create" as const,
      item: {
        type: "function-call-output" as const,
        callId: opts.callId,
        name: opts.name,
        output: JSON.stringify(opts.output),
      },
    };
  }
  return {
    toolResponse: {
      functionResponses: [
        {
          id: opts.callId,
          name: opts.name,
          response: { result: opts.output },
        },
      ],
    },
  };
}

export function buildLiveAudioClientMessage(
  transport: LiveTransportKind,
  base64Pcm16k: string
) {
  if (transport === "gateway") {
    return { type: "input-audio-append", audio: base64Pcm16k };
  }
  return {
    realtimeInput: {
      audio: {
        data: base64Pcm16k,
        mimeType: "audio/pcm;rate=16000",
      },
    },
  };
}

export function buildLiveStreamEndMessage(transport: LiveTransportKind) {
  if (transport === "gateway") {
    return { type: "input-audio-commit" };
  }
  return { realtimeInput: { audioStreamEnd: true } };
}

export function buildLiveCancelMessage(transport: LiveTransportKind) {
  return transport === "gateway" ? { type: "response-cancel" } : null;
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const length = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    out[i] = (pcm[i] ?? 0) / 32_768;
  }
  return out;
}

/** Box-filter decimation to 16 kHz (same algorithm as the AudioWorklet). */
export function downsampleTo16k(
  input: Float32Array,
  inputRate: number
): Int16Array {
  const ratio = inputRate / LIVE_INPUT_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  let acc = 0;
  let count = 0;
  let frac = 0;
  let o = 0;
  for (const sample of input) {
    acc += sample;
    count += 1;
    frac += 1;
    if (frac >= ratio && o < outLength) {
      frac -= ratio;
      const v = Math.max(-1, Math.min(1, acc / count));
      out[o] = v < 0 ? v * 0x80_00 : v * 0x7f_ff;
      o += 1;
      acc = 0;
      count = 0;
    }
  }
  return out;
}

export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

// ---------------------------------------------------------------------------
// Echo-aware mic gate
// ---------------------------------------------------------------------------

export type EchoGateDecision = {
  /** Frames to forward, in order (real audio or digital silence). */
  frames: Int16Array[];
  /** True when the user started talking over the assistant. */
  bargeIn: boolean;
  /** True while real mic audio is being forwarded. */
  open: boolean;
};

export type EchoGateOptions = {
  frameMs: number;
  prerollMs: number;
  idleOffsetDb: number;
  idleMinDb: number;
  bargeOffsetDb: number;
  bargeMinDb: number;
  idleMinSpeechMs: number;
  bargeMinSpeechMs: number;
  hangoverMs: number;
};

const DEFAULT_GATE: EchoGateOptions = {
  frameMs: LIVE_FRAME_MS,
  prerollMs: 320,
  idleOffsetDb: 10,
  idleMinDb: -50,
  bargeOffsetDb: 20,
  bargeMinDb: -35,
  idleMinSpeechMs: 80,
  bargeMinSpeechMs: 280,
  hangoverMs: 480,
};

/**
 * Second line of defence after the browser's acoustic echo canceller.
 *
 * - Tracks the room noise floor (falls instantly, rises ~1 dB/s).
 * - While the assistant is silent: opens at floor+10 dB (min -50 dBFS) after
 *   80 ms of speech, keeping a 320 ms pre-roll so first syllables are kept.
 * - While the assistant is audible (incl. a short tail): requires floor+20 dB
 *   (min -35 dBFS) for 280 ms before treating it as a real barge-in.
 * - Closed gate forwards digital silence, so residual speaker echo or room
 *   noise can never be heard by the model as a "user turn".
 * - Adaptive: if an echo leak is detected, the barge-in threshold is raised.
 */
export class EchoGate {
  private readonly opts: EchoGateOptions;
  private floorDb = -62;
  private speechMs = 0;
  private hangMs = 0;
  private openMs = 0;
  private isOpen = false;
  private openedDuringAssistant = false;
  private wasAssistantAudible = false;
  private preroll: Int16Array[] = [];
  private extraBargeDb = 0;

  constructor(options: Partial<EchoGateOptions> = {}) {
    this.opts = { ...DEFAULT_GATE, ...options };
  }

  get noiseFloorDb() {
    return this.floorDb;
  }

  get bargePenaltyDb() {
    return this.extraBargeDb;
  }

  /** Called when the model's input transcript echoes its own last reply. */
  reportEchoLeak() {
    this.extraBargeDb = Math.min(18, this.extraBargeDb + 6);
  }

  /** Slowly relaxes temporary echo penalty after clean turns. */
  decayEchoPenalty() {
    this.extraBargeDb = Math.max(0, this.extraBargeDb - 3);
  }

  reset() {
    this.speechMs = 0;
    this.hangMs = 0;
    this.openMs = 0;
    this.isOpen = false;
    this.openedDuringAssistant = false;
    this.preroll = [];
  }

  thresholdDb(assistantAudible: boolean): number {
    const o = this.opts;
    return assistantAudible
      ? Math.max(this.floorDb + o.bargeOffsetDb, o.bargeMinDb) +
          this.extraBargeDb
      : Math.max(this.floorDb + o.idleOffsetDb, o.idleMinDb);
  }

  process(
    frame: Int16Array,
    rms: number,
    assistantAudible: boolean
  ): EchoGateDecision {
    const o = this.opts;
    const db = rmsToDb(rms);

    // Assistant just started talking: a gate left open by the user's own
    // trailing hangover must not keep forwarding the speaker into the mic.
    if (
      assistantAudible &&
      !this.wasAssistantAudible &&
      this.isOpen &&
      !this.openedDuringAssistant
    ) {
      this.isOpen = false;
      this.speechMs = 0;
      this.hangMs = 0;
      this.openMs = 0;
    }
    this.wasAssistantAudible = assistantAudible;

    if (!this.isOpen && !assistantAudible) {
      if (db < this.floorDb) {
        this.floorDb = db;
      } else {
        this.floorDb += o.frameMs / 1000;
      }
      this.floorDb = Math.min(-30, Math.max(-80, this.floorDb));
    }

    const threshold = this.thresholdDb(assistantAudible);
    const silence = new Int16Array(frame.length);

    if (!this.isOpen) {
      // Leaky integrator: brief inter-syllable consonant dips don't wipe out
      // a genuine barge-in, while isolated knocks/coughs still decay away.
      this.speechMs =
        db >= threshold
          ? this.speechMs + o.frameMs
          : Math.max(0, this.speechMs - o.frameMs);
      this.preroll.push(frame);
      const maxPreroll = Math.max(1, Math.round(o.prerollMs / o.frameMs));
      while (this.preroll.length > maxPreroll) {
        this.preroll.shift();
      }
      const minSpeech = assistantAudible
        ? o.bargeMinSpeechMs
        : o.idleMinSpeechMs;
      if (this.speechMs >= minSpeech) {
        this.isOpen = true;
        this.openedDuringAssistant = assistantAudible;
        this.hangMs = o.hangoverMs;
        this.openMs = o.frameMs;
        const frames = this.preroll;
        this.preroll = [];
        return { frames, bargeIn: assistantAudible, open: true };
      }
      return { frames: [silence], bargeIn: false, open: false };
    }

    // Gate open: forward real audio, close after the hangover.
    this.openMs += o.frameMs;
    if (!assistantAudible && this.openMs > 4000 && db < threshold + 4) {
      // Let the floor adapt slowly if background room noise rose (AC/TV).
      this.floorDb = Math.min(-30, this.floorDb + (o.frameMs / 1000) * 0.5);
    }
    if (db >= threshold - 6) {
      this.hangMs = o.hangoverMs;
    } else {
      this.hangMs -= o.frameMs;
    }
    if (this.hangMs <= 0) {
      this.isOpen = false;
      this.openedDuringAssistant = false;
      this.speechMs = 0;
      this.openMs = 0;
      return { frames: [frame], bargeIn: false, open: false };
    }
    return { frames: [frame], bargeIn: false, open: true };
  }
}

// ---------------------------------------------------------------------------
// Transcript assembly
// ---------------------------------------------------------------------------

export type CommittedLiveTurn = {
  user: string;
  assistant: string;
  interrupted: boolean;
};

/**
 * Filters a committed live turn before UI rendering or DB persistence so
 * filler-only assistant bubbles are dropped while keeping user speech and
 * substantive assistant answers intact.
 */
export function filterCommittedLiveTurn(
  turn: CommittedLiveTurn,
  opts?: {
    dropFillerAssistant?: boolean;
  }
): CommittedLiveTurn | null {
  const user = turn.user.trim();
  let assistant = turn.assistant.trim();
  const shouldDrop =
    Boolean(opts?.dropFillerAssistant) ||
    (!user && Boolean(assistant) && isFillerOnlyUtterance(assistant));
  if (shouldDrop && assistant && isFillerOnlyUtterance(assistant)) {
    assistant = "";
  }
  if (!user && !assistant) {
    return null;
  }
  return {
    user,
    assistant,
    interrupted: turn.interrupted,
  };
}

/**
 * Tracks active tool calls and the post-tool window prior to the real spoken
 * answer so late pre-tool filler captions arriving on turnComplete, interrupted,
 * tool-done, pause, or stop are never persisted as chat bubbles.
 */
export class LiveToolTurnGuard {
  private readonly inFlight = new Set<string>();
  private awaitingPostToolAnswer = false;

  get hasInFlightTools(): boolean {
    return this.inFlight.size > 0;
  }

  get isDroppingFillers(): boolean {
    return this.inFlight.size > 0 || this.awaitingPostToolAnswer;
  }

  onToolStart(callId: string) {
    this.inFlight.add(callId);
    this.awaitingPostToolAnswer = true;
  }

  onToolDone(callId: string) {
    this.inFlight.delete(callId);
  }

  onToolCancelled(callId: string) {
    this.inFlight.delete(callId);
  }

  reset() {
    this.inFlight.clear();
    this.awaitingPostToolAnswer = false;
  }

  filterCommit(
    turn: CommittedLiveTurn,
    opts?: { dropFillerAssistant?: boolean }
  ): CommittedLiveTurn | null {
    const dropFillerAssistant =
      Boolean(opts?.dropFillerAssistant) || this.isDroppingFillers;
    const filtered = filterCommittedLiveTurn(turn, { dropFillerAssistant });
    if (
      filtered?.assistant &&
      this.inFlight.size === 0 &&
      !isFillerOnlyUtterance(filtered.assistant)
    ) {
      this.awaitingPostToolAnswer = false;
    }
    return filtered;
  }
}

/**
 * Builds the POST payload for `/api/voice/live-session` on initial start,
 * resume, or socket reconnect, preserving `chatId` and `timeZone` so the
 * server reloads recent chat context from Postgres.
 */
export function buildLiveSessionRequestBody(
  sessionBody: Record<string, unknown>,
  resumeHandle?: string | null
): Record<string, unknown> {
  return {
    ...sessionBody,
    ...(resumeHandle ? { resumeHandle } : {}),
  };
}

const UTTERANCE_PAUSE_GAP_MS = 850;

/**
 * Joins streaming transcription chunks while ensuring separate sentences and
 * paused utterances never glue together (`"Tamam.Tamam."` -> `"Tamam. Tamam."`,
 * `"paylaş...Ne oldu?"` -> `"paylaş... Ne oldu?"`).
 */
export function appendTranscriptSegment(
  existing: string,
  incoming: string,
  gapMs = 0
): string {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  if (gapMs >= UTTERANCE_PAUSE_GAP_MS) {
    const trimmedPrev = existing.trimEnd();
    const trimmedNext = incoming.trimStart();
    if (!trimmedPrev || !trimmedNext) {
      return `${existing}${incoming}`;
    }
    const endsWithPunct = /[.!?:…,;]$/.test(trimmedPrev);
    const startsWithUpper = /^\p{Lu}/u.test(trimmedNext);
    if (!endsWithPunct && startsWithUpper) {
      return `${trimmedPrev}. ${trimmedNext}`;
    }
    return `${trimmedPrev} ${trimmedNext}`;
  }

  if (/[.!?:…]$/.test(existing) && /^[\p{L}\p{N}]/u.test(incoming)) {
    return `${existing} ${incoming}`;
  }
  return `${existing}${incoming}`;
}

/**
 * Turns streamed input/output transcription chunks into committed chat turns.
 * Late input transcription chunks for the current turn still attach to `input`
 * even after assistant audio starts; only words arriving after an actual
 * barge-in (`markBargeIn`) route into `nextInput` for the next turn.
 */
export class LiveTurnAssembler {
  private input = "";
  private nextInput = "";
  private output = "";
  private outputStarted = false;
  private bargedIn = false;
  private lastInputAtMs = 0;
  private lastNextInputAtMs = 0;

  get userCaption() {
    return normalizeTranscript(this.bargedIn ? this.nextInput : this.input);
  }

  get assistantCaption() {
    return normalizeTranscript(this.output);
  }

  get hasPendingUser() {
    return (this.bargedIn ? this.nextInput : this.input).trim().length > 0;
  }

  addInput(text: string, nowMs = Date.now()) {
    if (this.bargedIn) {
      const gap =
        this.lastNextInputAtMs > 0
          ? Math.max(0, nowMs - this.lastNextInputAtMs)
          : 0;
      this.nextInput = appendTranscriptSegment(this.nextInput, text, gap);
      this.lastNextInputAtMs = nowMs;
    } else {
      const gap =
        this.lastInputAtMs > 0 ? Math.max(0, nowMs - this.lastInputAtMs) : 0;
      this.input = appendTranscriptSegment(this.input, text, gap);
      this.lastInputAtMs = nowMs;
    }
  }

  addOutput(text: string) {
    this.outputStarted = true;
    this.output = appendTranscriptSegment(this.output, text, 0);
  }

  clearAssistantOutput() {
    this.output = "";
  }

  markOutputStarted() {
    this.outputStarted = true;
  }

  markBargeIn() {
    if (this.outputStarted) {
      this.bargedIn = true;
    }
  }

  commit(interrupted: boolean): CommittedLiveTurn | null {
    const turn = {
      user: normalizeTranscript(this.input),
      assistant: normalizeTranscript(this.output),
      interrupted,
    };
    this.input = this.nextInput;
    this.lastInputAtMs = this.lastNextInputAtMs;
    this.nextInput = "";
    this.lastNextInputAtMs = 0;
    this.output = "";
    this.outputStarted = false;
    this.bargedIn = false;
    if (!turn.user && !turn.assistant) {
      return null;
    }
    return turn;
  }
}

export function normalizeTranscript(text: string): string {
  return text
    .replace(/\.{2,}(?=[\p{L}\p{N}])/gu, "... ")
    .replace(/([.!?:…])(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/([,;])(?=[\p{L}])/gu, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLettersAndSpaces(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.{2,}|…/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalizeLettersAndSpaces(text)
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

/**
 * Share of the user's words that also appear in the assistant's last reply.
 * A high score on a "user" turn means the speaker leaked into the mic.
 */
export function echoSimilarity(userText: string, assistantText: string) {
  const user = wordSet(userText);
  const assistant = wordSet(assistantText);
  if (user.size === 0 || assistant.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const w of user) {
    if (assistant.has(w)) {
      shared += 1;
    }
  }
  return shared / user.size;
}

function isSegmentEchoOfAssistant(
  segment: string,
  normalizedRefs: readonly string[],
  combinedRef: string
): boolean {
  const segNorm = normalizeLettersAndSpaces(segment);
  if (!segNorm) {
    return false;
  }
  const words = segNorm.split(" ").filter((w) => w.length > 1);
  // Short single-word acknowledgements like "Tamam." or "Evet." are genuine user speech unless the entire turn was only that echo.
  if (words.length < 2) {
    return false;
  }
  if (segNorm.length >= 10) {
    for (const refNorm of normalizedRefs) {
      if (refNorm.includes(segNorm)) {
        return true;
      }
    }
  }
  if (words.length >= 3 && echoSimilarity(segment, combinedRef) >= 0.65) {
    return true;
  }
  return false;
}

/**
 * Strips assistant loudspeaker echo from a user voice transcript — both when the
 * entire user turn is speaker echo AND when leading/embedded sentences in a
 * merged turn echoed the bot's own speech (e.g. `"Son gelişmelere hemen bakıyorum.
 * Sonra bu chat'te paylaş... Ne oldu? Tamam. Tamam."` -> `"Ne oldu? Tamam. Tamam."`).
 */
export function stripAssistantEchoFromUserTranscript(
  userText: string,
  assistantTexts: readonly string[]
): { cleaned: string; strippedEcho: boolean } {
  const normalizedUser = normalizeTranscript(userText);
  if (!normalizedUser) {
    return { cleaned: "", strippedEcho: false };
  }
  const refs = assistantTexts.map((t) => t.trim()).filter(Boolean);
  if (refs.length === 0) {
    return { cleaned: normalizedUser, strippedEcho: false };
  }

  const normalizedRefs = refs.map(normalizeLettersAndSpaces).filter(Boolean);
  const combinedRef = refs.join(" ");
  const userNorm = normalizeLettersAndSpaces(normalizedUser);
  const userWords = userNorm.split(" ").filter((w) => w.length > 1);

  if (
    userWords.length >= 2 &&
    ((userNorm.length >= 10 &&
      normalizedRefs.some((ref) => ref.includes(userNorm))) ||
      (userWords.length >= 3 &&
        refs.some((ref) => echoSimilarity(normalizedUser, ref) >= 0.72)))
  ) {
    return { cleaned: "", strippedEcho: true };
  }

  const segments = normalizedUser
    .split(/(?<=[.!?…]|\.{2,})\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    return { cleaned: normalizedUser, strippedEcho: false };
  }

  let strippedEcho = false;
  const kept: string[] = [];
  for (const segment of segments) {
    if (isSegmentEchoOfAssistant(segment, normalizedRefs, combinedRef)) {
      strippedEcho = true;
      continue;
    }
    kept.push(segment);
  }

  return {
    cleaned: normalizeTranscript(kept.join(" ")),
    strippedEcho,
  };
}

// ---------------------------------------------------------------------------
// Server message parsing
// ---------------------------------------------------------------------------

export type LiveServerEvent =
  | { type: "setup-complete" }
  | { type: "audio"; data: string }
  | { type: "input-transcript"; text: string }
  | { type: "output-transcript"; text: string }
  | {
      type: "tool-call";
      callId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: "tool-call-cancelled"; ids: string[] }
  | { type: "speech-started" }
  | { type: "interrupted" }
  | { type: "turn-complete" }
  | { type: "generation-complete" }
  | { type: "resumption"; handle: string }
  | { type: "go-away"; timeLeftMs: number }
  | { type: "error"; message: string };

type RawGoogleFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

type RawGoogleMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
    };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
  };
  toolCall?: { functionCalls?: RawGoogleFunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  goAway?: { timeLeft?: string };
  error?: { message?: string };
};

type RawGatewayMessage = {
  type: string;
  delta?: string;
  transcript?: string;
  speaker?: "user" | "assistant";
  message?: string;
  callId?: string;
  name?: string;
  arguments?: string;
  rawType?: string;
  raw?: RawGoogleMessage;
};

function parseJsonArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseDurationMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = value.match(/^([\d.]+)s$/);
  return match ? Math.round(Number.parseFloat(match[1] ?? "0") * 1000) : 0;
}

function parseGatewayMessage(msg: RawGatewayMessage): LiveServerEvent[] {
  switch (msg.type) {
    case "session-created":
    case "session-updated":
      return [{ type: "setup-complete" }];
    case "audio-delta":
    case "audio-chunk":
      return msg.delta ? [{ type: "audio", data: msg.delta }] : [];
    case "audio-transcript-delta":
      return msg.delta ? [{ type: "output-transcript", text: msg.delta }] : [];
    case "transcript-fragment":
      if (!msg.delta) {
        return [];
      }
      return [
        {
          type:
            msg.speaker === "user" ? "input-transcript" : "output-transcript",
          text: msg.delta,
        },
      ];
    case "input-transcription-completed":
      return msg.transcript
        ? [{ type: "input-transcript", text: msg.transcript }]
        : [];
    case "function-call-arguments-done":
      return msg.callId && msg.name
        ? [
            {
              type: "tool-call",
              callId: msg.callId,
              name: msg.name,
              args: parseJsonArgs(msg.arguments),
            },
          ]
        : [];
    case "speech-started":
      return [{ type: "speech-started" }];
    case "response-done":
      return [{ type: "turn-complete" }];
    case "error":
      return msg.message ? [{ type: "error", message: msg.message }] : [];
    case "custom": {
      const events: LiveServerEvent[] = [];
      const raw = msg.raw;
      if (raw?.serverContent?.interrupted) {
        events.push({ type: "interrupted" });
      }
      if (raw?.serverContent?.generationComplete) {
        events.push({ type: "generation-complete" });
      }
      for (const call of raw?.toolCall?.functionCalls ?? []) {
        if (call.id && call.name) {
          events.push({
            type: "tool-call",
            callId: call.id,
            name: call.name,
            args: call.args && typeof call.args === "object" ? call.args : {},
          });
        }
      }
      if (raw?.toolCallCancellation?.ids?.length) {
        events.push({
          type: "tool-call-cancelled",
          ids: raw.toolCallCancellation.ids,
        });
      }
      if (
        raw?.sessionResumptionUpdate?.resumable &&
        raw.sessionResumptionUpdate.newHandle
      ) {
        events.push({
          type: "resumption",
          handle: raw.sessionResumptionUpdate.newHandle,
        });
      }
      if (raw?.goAway) {
        events.push({
          type: "go-away",
          timeLeftMs: parseDurationMs(raw.goAway.timeLeft),
        });
      }
      return events;
    }
    default:
      return [];
  }
}

/** Splits one server frame into ordered events (supports AI Gateway & Google Direct). */
export function parseLiveServerMessage(raw: string): LiveServerEvent[] {
  let parsed: RawGoogleMessage & Partial<RawGatewayMessage>;
  try {
    parsed = JSON.parse(raw) as RawGoogleMessage & Partial<RawGatewayMessage>;
  } catch {
    return [];
  }
  if (typeof parsed.type === "string") {
    return parseGatewayMessage(parsed as RawGatewayMessage);
  }
  const msg = parsed;
  const events: LiveServerEvent[] = [];
  if (msg.setupComplete !== undefined) {
    events.push({ type: "setup-complete" });
  }
  const content = msg.serverContent;
  if (content) {
    if (content.interrupted) {
      events.push({ type: "interrupted" });
    }
    if (content.inputTranscription?.text) {
      events.push({
        type: "input-transcript",
        text: content.inputTranscription.text,
      });
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        events.push({ type: "audio", data: part.inlineData.data });
      }
    }
    if (content.outputTranscription?.text) {
      events.push({
        type: "output-transcript",
        text: content.outputTranscription.text,
      });
    }
    if (content.generationComplete) {
      events.push({ type: "generation-complete" });
    }
    if (content.turnComplete) {
      events.push({ type: "turn-complete" });
    }
  }
  if (msg.toolCall?.functionCalls?.length) {
    for (const call of msg.toolCall.functionCalls) {
      if (call.id && call.name) {
        events.push({
          type: "tool-call",
          callId: call.id,
          name: call.name,
          args: call.args && typeof call.args === "object" ? call.args : {},
        });
      }
    }
  }
  if (msg.toolCallCancellation?.ids?.length) {
    events.push({
      type: "tool-call-cancelled",
      ids: msg.toolCallCancellation.ids,
    });
  }
  if (
    msg.sessionResumptionUpdate?.resumable &&
    msg.sessionResumptionUpdate.newHandle
  ) {
    events.push({
      type: "resumption",
      handle: msg.sessionResumptionUpdate.newHandle,
    });
  }
  if (msg.goAway) {
    events.push({
      type: "go-away",
      timeLeftMs: parseDurationMs(msg.goAway.timeLeft),
    });
  }
  if (msg.error?.message) {
    events.push({ type: "error", message: msg.error.message });
  }
  return events;
}
