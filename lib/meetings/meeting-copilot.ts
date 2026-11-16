import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  createPostgresMemoryStore,
  type JournalEntry,
  type MemoryCategory,
  type MemoryStore,
  type ProfileFact,
} from "@/lib/memory/store";
import {
  fenceUntrustedContent,
  type InjectionSignal,
} from "@/lib/safety/untrusted-content";
import {
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
  createPostgresTaskStore,
} from "@/lib/tasks/runner";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";
import {
  transcribeVoiceMemo,
  validateAudioUpload,
} from "@/lib/voice/voice-service";

export type SpeakerTurn = {
  speaker: string;
  rawText: string;
  fencedText: string;
  suspicious: boolean;
  signals: InjectionSignal[];
};

export type ProposedProfileFactReview = {
  category: MemoryCategory;
  key: string;
  value: string;
  speaker: string;
  quarantined: boolean;
  status: "pending_owner_review";
};

export type ProposedFollowUpDraft = {
  channel: "email" | "message";
  recipientHint: string;
  subject: string;
  body: string;
  quarantined: boolean;
  sent: false;
  status: "pending_owner_review";
};

export type MeetingReviewPackage = {
  meetingTitle: string;
  fencedTranscript: string;
  speakerTurns: SpeakerTurn[];
  suspicious: boolean;
  signals: InjectionSignal[];
  proposedJournalEntry: {
    title: string;
    body: string;
    tags: string[];
  };
  proposedProfileFacts: ProposedProfileFactReview[];
  proposedOutboundDrafts: ProposedFollowUpDraft[];
};

export function buildPreMeetingBrief(opts: {
  meetingTitle: string;
  attendees?: string[];
  profileFacts: ProfileFact[];
  recentJournal: JournalEntry[];
  calendarSummary?: string[];
}): {
  meetingTitle: string;
  attendees: string[];
  relevantFacts: Array<{ key: string; value: string; category: string }>;
  recentContext: Array<{ title: string; snippet: string }>;
  upcomingScheduleNotes: string[];
  briefMarkdown: string;
} {
  const attendees = (opts.attendees ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 20);
  const titleTokens = opts.meetingTitle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3);

  const relevantFacts = opts.profileFacts
    .filter((fact) => {
      if (titleTokens.length === 0 && attendees.length === 0) {
        return true;
      }
      const hay = `${fact.key} ${fact.value} ${fact.category}`.toLowerCase();
      return (
        titleTokens.some((t) => hay.includes(t)) ||
        attendees.some((a) => hay.includes(a.toLowerCase()))
      );
    })
    .slice(0, 8)
    .map((f) => ({ key: f.key, value: f.value, category: f.category }));

  const recentContext = opts.recentJournal.slice(0, 4).map((entry) => ({
    title: entry.title,
    snippet: entry.body.slice(0, 180),
  }));

  const upcomingScheduleNotes = (opts.calendarSummary ?? []).slice(0, 5);

  const lines: string[] = [
    `# Pre-Meeting Brief: ${opts.meetingTitle.trim() || "Upcoming Session"}`,
    attendees.length > 0
      ? `**Attendees:** ${attendees.join(", ")}`
      : "**Attendees:** Owner solo / unspecified",
    "",
    "## Key Profile Context",
    ...(relevantFacts.length > 0
      ? relevantFacts.map((f) => `- **${f.key}** (${f.category}): ${f.value}`)
      : ["- No matching profile facts stored yet."]),
    "",
    "## Recent Journal Continuity",
    ...(recentContext.length > 0
      ? recentContext.map((j) => `- **${j.title}**: ${j.snippet}`)
      : ["- No recent journal entries recorded."]),
  ];

  if (upcomingScheduleNotes.length > 0) {
    lines.push(
      "",
      "## Calendar Context",
      ...upcomingScheduleNotes.map((note) => `- ${note}`)
    );
  }

  return {
    meetingTitle: opts.meetingTitle.trim() || "Upcoming Session",
    attendees,
    relevantFacts,
    recentContext,
    upcomingScheduleNotes,
    briefMarkdown: lines.join("\n"),
  };
}

const SPEAKER_LINE_REGEX =
  /^(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?([A-Za-z0-9 _.-]{1,40}):\s+(.+)$/;

export function parseAndFenceMeetingTranscript(rawTranscript: string): {
  fencedTranscript: string;
  speakerTurns: SpeakerTurn[];
  suspicious: boolean;
  signals: InjectionSignal[];
} {
  const lines = rawTranscript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const speakerTurns: SpeakerTurn[] = [];
  const signalSet = new Set<InjectionSignal>();

  for (const line of lines) {
    const match = SPEAKER_LINE_REGEX.exec(line);
    const speaker = match?.[1]?.trim() || "Participant";
    const text = match?.[2]?.trim() || line;
    const safeSpeakerSlug =
      speaker.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "participant";

    const fenced = fenceUntrustedContent({
      text,
      source: `meeting:speaker:${safeSpeakerSlug}`,
      maxChars: 4000,
    });
    for (const sig of fenced.signals) {
      signalSet.add(sig);
    }
    speakerTurns.push({
      speaker,
      rawText: text,
      fencedText: fenced.fencedText,
      suspicious: fenced.suspicious,
      signals: fenced.signals,
    });
  }

  const wholeFence = fenceUntrustedContent({
    text: rawTranscript,
    source: "meeting:transcript",
    maxChars: 12_000,
  });
  for (const sig of wholeFence.signals) {
    signalSet.add(sig);
  }

  return {
    fencedTranscript: wholeFence.fencedText,
    speakerTurns,
    suspicious: wholeFence.suspicious || speakerTurns.some((t) => t.suspicious),
    signals: [...signalSet],
  };
}

function extractCandidateReviews(
  meetingTitle: string,
  turns: SpeakerTurn[]
): {
  actionBullets: string[];
  proposedProfileFacts: ProposedProfileFactReview[];
  proposedOutboundDrafts: ProposedFollowUpDraft[];
} {
  const actionBullets: string[] = [];
  const proposedProfileFacts: ProposedProfileFactReview[] = [];
  const proposedOutboundDrafts: ProposedFollowUpDraft[] = [];

  for (const turn of turns) {
    const cleanSnippet = turn.rawText.slice(0, 220);
    if (
      /\b(action item|follow[- ]?up|todo|next step|i will send|let'?s send|we should email|deadline)\b/i.test(
        turn.rawText
      )
    ) {
      actionBullets.push(
        turn.suspicious
          ? `[QUARANTINED - SUSPICIOUS SPEAKER TURN (${turn.speaker})] ${cleanSnippet}`
          : `${turn.speaker}: ${cleanSnippet}`
      );
      proposedOutboundDrafts.push({
        channel: "email",
        recipientHint: turn.speaker,
        subject: `[DRAFT] Follow-up: ${meetingTitle}`,
        body: turn.suspicious
          ? "[SUSPICIOUS SPEAKER INPUT — VERIFY MANUALLY BEFORE SENDING]"
          : `Hi ${turn.speaker},\n\nFollowing up from "${meetingTitle}":\n- ${cleanSnippet}\n\nBest,`,
        quarantined: turn.suspicious,
        sent: false,
        status: "pending_owner_review",
      });
    }

    const preferenceMatch =
      /\b(?:prefers?|time\s*zone is|based in)\s+([A-Za-z0-9 /_+-]{2,60})/i.exec(
        turn.rawText
      );
    if (preferenceMatch?.[1]) {
      const slug = turn.speaker
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      proposedProfileFacts.push({
        category: "preference",
        key: `contact_${slug || "participant"}_note`,
        value: preferenceMatch[1].trim(),
        speaker: turn.speaker,
        quarantined: turn.suspicious,
        status: "pending_owner_review",
      });
    }
  }

  if (proposedOutboundDrafts.length === 0) {
    proposedOutboundDrafts.push({
      channel: "email",
      recipientHint: "attendees",
      subject: `[DRAFT] Notes & Next Steps: ${meetingTitle}`,
      body: `Summary notes from "${meetingTitle}" are staged for owner review.`,
      quarantined: turns.some((t) => t.suspicious),
      sent: false,
      status: "pending_owner_review",
    });
  }

  return {
    actionBullets,
    proposedProfileFacts,
    proposedOutboundDrafts,
  };
}

export type IngestMeetingResult =
  | {
      status: "awaiting_approval";
      task: BackgroundTaskRecord;
      review: MeetingReviewPackage;
    }
  | {
      status: "blocked_data_boundary" | "setup_required" | "error";
      message: string;
    };

export async function ingestMeetingSession(opts: {
  userId: string;
  meetingTitle: string;
  rawTranscript?: string;
  audioBytes?: Uint8Array;
  audioMimeType?: string;
  taskStore?: BackgroundTaskStore;
  vaultStore?: SecretVaultStore;
  fetchImpl?: typeof fetch;
}): Promise<IngestMeetingResult> {
  const title = opts.meetingTitle.trim() || "Recorded Meeting";

  if (containsRestrictedWorkData(title)) {
    return {
      status: "blocked_data_boundary",
      message:
        "Blocked by data-governance rule: restricted employer meeting titles/recordings cannot be processed on the personal assistant stack.",
    };
  }

  let transcriptText = (opts.rawTranscript ?? "").trim();

  if (!transcriptText && opts.audioBytes) {
    const audioCheck = validateAudioUpload({
      declaredType: opts.audioMimeType ?? "audio/webm",
      bytes: opts.audioBytes,
    });
    if (!audioCheck.valid) {
      return {
        status: "error",
        message: audioCheck.error,
      };
    }
    const stt = await transcribeVoiceMemo({
      userId: opts.userId,
      mimeType: audioCheck.mimeType,
      bytes: opts.audioBytes,
      vaultStore: opts.vaultStore,
      fetchImpl: opts.fetchImpl,
    });
    if (stt.status !== "ok") {
      return {
        status: stt.status,
        message: stt.message,
      };
    }
    transcriptText = stt.transcript;
  }

  if (!transcriptText) {
    return {
      status: "error",
      message:
        "Meeting ingestion requires a non-empty transcript or audio clip.",
    };
  }

  if (containsRestrictedWorkData(transcriptText)) {
    return {
      status: "blocked_data_boundary",
      message:
        "Blocked by data-governance rule: restricted employer content detected in meeting transcript.",
    };
  }

  const fenced = parseAndFenceMeetingTranscript(transcriptText);
  const extracted = extractCandidateReviews(title, fenced.speakerTurns);

  const journalBodyLines = [
    `Meeting: ${title}`,
    `Turns analyzed: ${fenced.speakerTurns.length}`,
    fenced.suspicious
      ? `Security notice: Prompt-injection signal(s) detected (${fenced.signals.join(", ")}) and quarantined inside <untrusted_content>.`
      : "Security check: All external speaker turns fenced in <untrusted_content>.",
    ...(extracted.actionBullets.length > 0
      ? ["", "Action Items:", ...extracted.actionBullets.map((b) => `- ${b}`)]
      : []),
  ];

  const review: MeetingReviewPackage = {
    meetingTitle: title,
    fencedTranscript: fenced.fencedTranscript,
    speakerTurns: fenced.speakerTurns,
    suspicious: fenced.suspicious,
    signals: fenced.signals,
    proposedJournalEntry: {
      title: `Meeting Notes: ${title}`,
      body: journalBodyLines.join("\n"),
      tags: ["meeting", ...(fenced.suspicious ? ["quarantined"] : [])],
    },
    proposedProfileFacts: extracted.proposedProfileFacts,
    proposedOutboundDrafts: extracted.proposedOutboundDrafts,
  };

  const taskStore = opts.taskStore ?? createPostgresTaskStore();
  let task = await taskStore.enqueueTask({
    userId: opts.userId,
    kind: "meeting_copilot",
    title: `Meeting review: ${title.slice(0, 72)}`,
    prompt: `Review fenced transcript, ${review.proposedProfileFacts.length} candidate profile fact(s), and ${review.proposedOutboundDrafts.length} unsent follow-up draft(s).`,
    riskLevel: "high",
  });

  // Hard safety gate (PLAN.md P3.3): NEVER auto-save profile facts or auto-send follow-up drafts.
  // Always park in awaiting_approval for explicit owner review.
  task =
    (await taskStore.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "awaiting_approval",
      stepMessage: fenced.suspicious
        ? `Quarantined suspicious speaker turn(s) (${fenced.signals.join(", ")}); awaiting owner review before saving memory or follow-up drafts.`
        : "Fenced speaker transcript and staged journal + unsent follow-up drafts in awaiting_approval.",
      output: JSON.stringify(review, null, 2),
    })) ?? task;

  return {
    status: "awaiting_approval",
    task,
    review,
  };
}

/**
 * Commits a reviewed Meeting Copilot package ONLY after explicit owner approval.
 * Quarantined (prompt-injected) profile facts are never saved, and follow-up
 * drafts remain strictly unsent (`sent: false`).
 */
export async function commitApprovedMeetingReview(opts: {
  userId: string;
  taskId: string;
  taskStore?: BackgroundTaskStore;
  memoryStore?: MemoryStore;
}): Promise<{
  task: BackgroundTaskRecord;
  journalEntry: JournalEntry;
  savedFacts: ProfileFact[];
  unsentDrafts: ProposedFollowUpDraft[];
}> {
  const taskStore = opts.taskStore ?? createPostgresTaskStore();
  const memoryStore = opts.memoryStore ?? createPostgresMemoryStore();

  const existing = await taskStore.getTask({
    userId: opts.userId,
    id: opts.taskId,
  });
  if (!existing || existing.kind !== "meeting_copilot") {
    throw new Error("Meeting review task not found.");
  }
  if (existing.status !== "awaiting_approval") {
    throw new Error(
      `Meeting review task must be in awaiting_approval (current: ${existing.status}).`
    );
  }
  if (!existing.output) {
    throw new Error("Meeting review task has no staged review payload.");
  }

  const review = JSON.parse(existing.output) as MeetingReviewPackage;

  const journalEntry = await memoryStore.addJournalEntry({
    userId: opts.userId,
    title: review.proposedJournalEntry.title,
    body: review.proposedJournalEntry.body,
    tags: review.proposedJournalEntry.tags,
    source: "manual",
  });

  const savedFacts: ProfileFact[] = [];
  for (const candidate of review.proposedProfileFacts) {
    if (candidate.quarantined) {
      continue;
    }
    const saved = await memoryStore.upsertProfileFact({
      userId: opts.userId,
      category: candidate.category,
      key: candidate.key,
      value: candidate.value,
      sharedAcrossBots: true,
    });
    savedFacts.push(saved);
  }

  const unsentDrafts = review.proposedOutboundDrafts
    .filter((d) => !d.quarantined)
    .map((d) => ({ ...d, sent: false as const }));

  const updated =
    (await taskStore.transitionTask({
      userId: opts.userId,
      id: existing.id,
      status: "succeeded",
      stepMessage: `Owner approved meeting review: saved 1 journal entry, ${savedFacts.length} profile fact(s), and staged ${unsentDrafts.length} unsent follow-up draft(s).`,
    })) ?? existing;

  return {
    task: updated,
    journalEntry,
    savedFacts,
    unsentDrafts,
  };
}
