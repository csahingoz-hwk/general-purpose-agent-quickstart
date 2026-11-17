import { resolveGoogleAccessTokenFromVault } from "@/lib/connectors/google-vault-auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import {
  createPostgresVaultStore,
  type SecretVaultStore,
  VaultError,
} from "@/lib/vault/secret-vault";

export const GITHUB_VAULT_SECRET_NAME = "GITHUB_CONNECTOR_PAT";

export function isGithubConnectorEnabled(): boolean {
  return process.env.GITHUB_CONNECTOR_ENABLED !== "false";
}

const FORBIDDEN_CALENDAR_GITHUB_SEGMENTS =
  /\/(?:merge|delete|squash|git\/refs|hooks|collaborators|acl|clear)\b/i;

export function assertSafeCalendarOrGithubRequest(
  method: string,
  rawUrl: string
): URL {
  const upper = method.toUpperCase();
  const parsed = new URL(rawUrl);

  if (parsed.protocol !== "https:") {
    throw new Error("Connector requests must use HTTPS");
  }

  if (FORBIDDEN_CALENDAR_GITHUB_SEGMENTS.test(parsed.pathname)) {
    throw new Error(
      `Blocked forbidden connector endpoint (${upper} ${parsed.pathname})`
    );
  }

  if (parsed.hostname === "www.googleapis.com") {
    if (
      upper === "GET" &&
      parsed.pathname === "/calendar/v3/calendars/primary/events"
    ) {
      return parsed;
    }
    if (
      upper === "POST" &&
      parsed.pathname === "/calendar/v3/calendars/primary/events" &&
      parsed.searchParams.get("sendUpdates") === "none"
    ) {
      return parsed;
    }
    throw new Error(
      `Blocked Google Calendar request (${upper} ${parsed.pathname}${parsed.search}): only GET events and POST tentative draft events with sendUpdates=none are permitted.`
    );
  }

  if (parsed.hostname === "api.github.com") {
    if (
      upper === "GET" &&
      /^\/repos\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:pulls|issues)(?:\/\d+)?$/.test(
        parsed.pathname
      )
    ) {
      return parsed;
    }
    if (
      upper === "POST" &&
      /^\/repos\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pulls\/\d+\/reviews$/.test(
        parsed.pathname
      )
    ) {
      return parsed;
    }
    throw new Error(
      `Blocked GitHub API request (${upper} ${parsed.pathname}): only read PRs/issues and PENDING draft PR reviews are permitted.`
    );
  }

  throw new Error(`Disallowed connector host: ${parsed.hostname}`);
}

export type FencedCalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  fencedSummary: string;
  suspicious: boolean;
};

export async function readGoogleCalendarEvents(opts: {
  userId: string;
  maxResults?: number;
  timeMinIso?: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<
  | { status: "ok"; events: FencedCalendarEvent[] }
  | { status: "setup_required"; message: string }
  | { status: "error"; message: string }
> {
  const auth = await resolveGoogleAccessTokenFromVault({
    userId: opts.userId,
    vaultStore: opts.vaultStore,
    fetchImpl: opts.fetchImpl,
  });
  if (!auth.ok) {
    return { status: "setup_required", message: auth.message };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const maxResults = Math.min(Math.max(1, opts.maxResults ?? 8), 15);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("timeMin", opts.timeMinIso ?? new Date().toISOString());

  assertSafeCalendarOrGithubRequest("GET", url.toString());

  const res = await fetchFn(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!res || !res.ok) {
    return {
      status: "error",
      message: `Google Calendar read failed${res ? ` (HTTP ${res.status})` : ""}.`,
    };
  }

  const json = (await res.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };

  const events: FencedCalendarEvent[] = [];
  for (const item of (json.items ?? []).slice(0, maxResults)) {
    const id = item.id ?? "evt";
    const summary = item.summary ?? "(Untitled event)";
    const start = item.start?.dateTime ?? item.start?.date ?? "";
    const end = item.end?.dateTime ?? item.end?.date ?? "";
    const raw = `Event: ${summary}\nStart: ${start}\nEnd: ${end}\nLocation: ${item.location ?? "none"}\nNotes: ${item.description ?? ""}`;
    const fenced = fenceUntrustedContent({
      text: raw,
      source: `connector:gcal:${id}`,
      maxChars: 2500,
    });
    events.push({
      id,
      summary: summary.slice(0, 140),
      start,
      end,
      fencedSummary: fenced.fencedText,
      suspicious: fenced.suspicious,
    });
  }

  return { status: "ok", events };
}

export async function createGoogleCalendarDraftEvent(opts: {
  userId: string;
  title: string;
  startIso: string;
  endIso: string;
  description?: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<
  | { status: "draft_event_created"; eventId: string; summary: string }
  | { status: "blocked_data_boundary"; message: string }
  | { status: "setup_required"; message: string }
  | { status: "error"; message: string }
> {
  if (containsRestrictedWorkData(`${opts.title}\n${opts.description ?? ""}`)) {
    return {
      status: "blocked_data_boundary",
      message:
        "Blocked: employer/Korn Ferry material cannot be saved to personal Google Calendar.",
    };
  }

  const auth = await resolveGoogleAccessTokenFromVault({
    userId: opts.userId,
    vaultStore: opts.vaultStore,
    fetchImpl: opts.fetchImpl,
  });
  if (!auth.ok) {
    return { status: "setup_required", message: auth.message };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none";
  assertSafeCalendarOrGithubRequest("POST", url);

  const summary = opts.title.trim().startsWith("[DRAFT]")
    ? opts.title.trim().slice(0, 140)
    : `[DRAFT] ${opts.title.trim().slice(0, 130)}`;

  // Zero attendees + sendUpdates=none + private/tentative guarantees NO invites are ever sent.
  const payload = {
    summary,
    description: opts.description?.trim().slice(0, 2000) ?? "",
    status: "tentative",
    visibility: "private",
    start: { dateTime: opts.startIso },
    end: { dateTime: opts.endIso },
  };

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!res || !res.ok) {
    return {
      status: "error",
      message: `Calendar draft event creation failed${res ? ` (HTTP ${res.status})` : ""}.`,
    };
  }

  const created = (await res.json()) as { id?: string; summary?: string };
  return {
    status: "draft_event_created",
    eventId: created.id ?? "cal-draft",
    summary: created.summary ?? summary,
  };
}

async function resolveGithubPatFromVault(
  userId: string,
  vaultStore?: SecretVaultStore
): Promise<string | null> {
  if (!vaultStore && process.env.GITHUB_CONNECTOR_PAT?.trim()) {
    return process.env.GITHUB_CONNECTOR_PAT.trim();
  }
  const store = vaultStore ?? createPostgresVaultStore();
  try {
    const token = await store.resolveSecret({
      userId,
      name: GITHUB_VAULT_SECRET_NAME,
    });
    return token?.trim() || null;
  } catch (err) {
    if (err instanceof VaultError) {
      return null;
    }
    throw err;
  }
}

export async function readGithubPullRequests(opts: {
  userId: string;
  owner: string;
  repo: string;
  maxResults?: number;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<
  | {
      status: "ok";
      items: Array<{
        number: number;
        title: string;
        state: string;
        fencedBody: string;
        suspicious: boolean;
      }>;
    }
  | { status: "setup_required"; message: string }
  | { status: "error"; message: string }
> {
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(opts.owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(opts.repo)
  ) {
    return {
      status: "error",
      message: "Invalid GitHub owner or repository name.",
    };
  }

  const pat = await resolveGithubPatFromVault(opts.userId, opts.vaultStore);
  if (!pat) {
    return {
      status: "setup_required",
      message: `Save ${GITHUB_VAULT_SECRET_NAME} (read/PR-scoped token) in Secret Vault to read GitHub pull requests.`,
    };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const maxResults = Math.min(Math.max(1, opts.maxResults ?? 5), 10);
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls?state=open&per_page=${maxResults}`;
  assertSafeCalendarOrGithubRequest("GET", url);

  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!res || !res.ok) {
    return {
      status: "error",
      message: `GitHub pull request read failed${res ? ` (HTTP ${res.status})` : ""}.`,
    };
  }

  const list = (await res.json()) as Array<{
    number?: number;
    title?: string;
    state?: string;
    body?: string | null;
    user?: { login?: string };
  }>;

  const items = list.slice(0, maxResults).map((pr) => {
    const number = pr.number ?? 0;
    const title = pr.title ?? "(Untitled PR)";
    const raw = `PR #${number}: ${title}\nAuthor: ${pr.user?.login ?? "unknown"}\n\n${pr.body ?? ""}`;
    const fenced = fenceUntrustedContent({
      text: raw,
      source: `connector:github:${opts.owner}/${opts.repo}#${number}`,
      maxChars: 3000,
    });
    return {
      number,
      title: title.slice(0, 160),
      state: pr.state ?? "open",
      fencedBody: fenced.fencedText,
      suspicious: fenced.suspicious,
    };
  });

  return { status: "ok", items };
}

export async function createGithubPendingDraftReview(opts: {
  userId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<
  | { status: "pending_review_draft_created"; reviewId: string }
  | { status: "approved_dry_run_draft"; note: string }
  | { status: "error"; message: string }
> {
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(opts.owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(opts.repo)
  ) {
    return {
      status: "error",
      message: "Invalid GitHub owner or repository name.",
    };
  }

  const pat = await resolveGithubPatFromVault(opts.userId, opts.vaultStore);
  if (!pat) {
    return {
      status: "approved_dry_run_draft",
      note: `Approved in dry-run mode (save ${GITHUB_VAULT_SECRET_NAME} in Secret Vault to save PENDING draft PR reviews on GitHub).`,
    };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/reviews`;
  assertSafeCalendarOrGithubRequest("POST", url);

  // Omitting `event` creates a PENDING (unpublished draft) PR review visible ONLY to the token owner!
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body: opts.body }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!res || !res.ok) {
    return {
      status: "error",
      message: `GitHub draft review creation failed${res ? ` (HTTP ${res.status})` : ""}.`,
    };
  }

  const created = (await res.json()) as { id?: number | string };
  return {
    status: "pending_review_draft_created",
    reviewId: String(created.id ?? "pending-review"),
  };
}
