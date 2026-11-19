import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { Session } from "next-auth";
import { systemPrompt } from "../../lib/ai/prompts";
import {
  clearFixtureCache,
  getFixtures,
} from "../../lib/ai/tools/get-fixtures";
import {
  executeSharedVoiceToolCall,
  runServerWebSearch,
} from "../../lib/ai/tools/shared-registry";
import {
  extractRelevantWebPassage,
  runFirecrawlSearch,
} from "../../lib/connectors/firecrawl";
import {
  FIXTURES_COVERAGE_NOTE,
  type FixturePayload,
  readFixturePayload,
} from "../../lib/fixtures";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import {
  createInMemoryApprovalPreferencesStore,
  createInMemoryExecutionJournalStore,
} from "../../lib/safety/approval-preferences";
import { createInMemoryVaultStore } from "../../lib/vault/secret-vault";
import {
  buildLiveSessionRequestBody,
  filterCommittedLiveTurn,
  isFillerOnlyUtterance,
  LIVE_VOICE_TOOL_DECLARATIONS,
  LiveToolTurnGuard,
  LiveTurnAssembler,
} from "../../lib/voice/live-protocol";
import {
  buildCompactVoiceRecentTurns,
  buildVoiceSystemInstruction,
  formatVoiceRecentContextBlock,
  resolveLiveSessionTimeZone,
  type StoredVoiceMessageRow,
} from "../../lib/voice/live-session";
import { executeVoiceTextAgentHandoff } from "../../lib/voice/text-agent-handoff";
import {
  transcribeVoiceMemo,
  VOICE_STT_SPORTS_VOCABULARY_HINT,
  VOICE_VAULT_SECRET_NAMES,
} from "../../lib/voice/voice-service";

const fakeSession: Session = {
  expires: new Date(Date.now() + 3_600_000).toISOString(),
  user: {
    id: "97a9a7c5-e220-425d-9589-7e63b607ca75",
    email: "owner@example.test",
    name: "Çağlar",
    type: "regular",
  },
};

const mockUsage: LanguageModelV4Usage = {
  inputTokens: { total: 140, noCache: 140, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 35, text: 35, reasoning: 0 },
};

function makeTurkishClubFetch(club: "Fenerbahçe" | "Galatasaray") {
  const idTeam = club === "Fenerbahçe" ? "133805" : "133804";
  const nextEvents =
    club === "Fenerbahçe"
      ? [
          {
            idEvent: "1001",
            strTimestamp: "2026-11-21T16:00:00",
            strLeague: "Turkish Super Lig",
            strVenue: "Şükrü Saracoğlu Stadyumu",
            strHomeTeam: "Fenerbahçe",
            strAwayTeam: "Kocaelispor",
            strHomeTeamBadge: null,
            strAwayTeamBadge: null,
            intHomeScore: null,
            intAwayScore: null,
            strSeason: "2026-2027",
            intRound: "13",
            idLeague: "4339",
          },
          {
            idEvent: "1002",
            strTimestamp: "2026-11-29T17:00:00",
            strLeague: "Turkish Super Lig",
            strVenue: "Kazım Karabekir Stadyumu",
            strHomeTeam: "Erzurumspor",
            strAwayTeam: "Fenerbahçe",
            strHomeTeamBadge: null,
            strAwayTeamBadge: null,
            intHomeScore: null,
            intAwayScore: null,
            strSeason: "2026-2027",
            intRound: "14",
            idLeague: "4339",
          },
        ]
      : [
          {
            idEvent: "2001",
            strTimestamp: "2026-11-21T13:00:00",
            strLeague: "Turkish Super Lig",
            strVenue: "Rams Park",
            strHomeTeam: "Galatasaray",
            strAwayTeam: "Samsunspor",
            strHomeTeamBadge: null,
            strAwayTeamBadge: null,
            intHomeScore: null,
            intAwayScore: null,
            strSeason: "2026-2027",
            intRound: "13",
            idLeague: "4339",
          },
        ];

  return ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("searchteams.php")) {
      return Promise.resolve(
        Response.json({
          teams: [
            {
              idTeam,
              strTeam: club,
              strSport: "Soccer",
              idLeague: "4339",
              strBadge: null,
            },
          ],
        })
      );
    }
    if (url.includes("eventsnext.php")) {
      return Promise.resolve(Response.json({ events: [nextEvents[0]] }));
    }
    if (url.includes("eventslast.php")) {
      return Promise.resolve(Response.json({ results: [] }));
    }
    if (url.includes("eventsround.php")) {
      return Promise.resolve(Response.json({ events: nextEvents }));
    }
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Item 1 & Item 3: getFixtures coverage caveat, competitions list, local time
// ---------------------------------------------------------------------------

test("Item 1 & 3: getFixtures includes coverageNote, competitions list, and converts to Europe/Istanbul (TSİ) by default for Turkish clubs and to explicit browser time zones", async () => {
  clearFixtureCache();
  const now = new Date("2026-11-19T12:00:00Z");

  // 1) No user time zone known -> Turkish club defaults to Europe/Istanbul (TSİ)
  const gsToolDefault = getFixtures({
    now: () => now,
    fetchImpl: makeTurkishClubFetch("Galatasaray"),
    footballDataKey: null,
    timeZone: null,
  });
  const gsRaw = (await (gsToolDefault as any).execute(
    { team: "Galatasaray" },
    { toolCallId: "fx-gs-1", messages: [] }
  )) as FixturePayload;

  assert.equal(gsRaw.timeZone, "Europe/Istanbul");
  assert.equal(gsRaw.kickoffTimeZone, "Europe/Istanbul (TSİ)");
  assert.deepEqual(gsRaw.competitions, ["Turkish Super Lig"]);
  assert.equal(gsRaw.coverageNote, FIXTURES_COVERAGE_NOTE);
  assert.match(gsRaw.coverageNote ?? "", /domestic league matches only/i);
  assert.match(gsRaw.coverageNote ?? "", /Champions League/i);
  assert.match(gsRaw.coverageNote ?? "", /webSearch/i);

  // 2026-11-21T13:00:00Z -> 16:00 in Europe/Istanbul (UTC+3)
  assert.equal(gsRaw.upcoming[0]?.kickoffUtc, "2026-11-21T13:00:00Z");
  assert.equal(gsRaw.upcoming[0]?.kickoffLocal, "21 Kasım Cumartesi 16:00");
  assert.equal(gsRaw.upcoming[0]?.kickoffTimeZone, "Europe/Istanbul (TSİ)");

  // readFixturePayload validates the enriched Europe/Istanbul payload cleanly
  const parsedPayload = readFixturePayload(gsRaw);
  assert.ok(parsedPayload, "readFixturePayload must accept Europe/Istanbul");
  assert.equal(parsedPayload.timeZone, "Europe/Istanbul");
  assert.equal(parsedPayload.kickoffTimeZone, "Europe/Istanbul (TSİ)");

  // toModelOutput exposes coverageNote, competitions, kickoffLocal, kickoffTimeZone
  const modelOut = (gsToolDefault as any).toModelOutput({ output: gsRaw });
  const parsedModel = JSON.parse(modelOut.value) as Record<string, any>;
  assert.equal(parsedModel.timeZone, "Europe/Istanbul");
  assert.equal(parsedModel.kickoffTimeZone, "Europe/Istanbul (TSİ)");
  assert.deepEqual(parsedModel.competitions, ["Turkish Super Lig"]);
  assert.match(parsedModel.coverageNote, /domestic league/i);
  assert.equal(parsedModel.next.kickoffLocal, "21 Kasım Cumartesi 16:00");
  assert.match(parsedModel.note, /never raw UTC/i);

  // 2) Provided browser time zone (e.g. Europe/London) overrides default cleanly even on cache hit
  const gsToolLondon = getFixtures({
    now: () => now,
    fetchImpl: makeTurkishClubFetch("Galatasaray"),
    footballDataKey: null,
    timeZone: "Europe/London",
    locale: "en",
  });
  const gsLondon = (await (gsToolLondon as any).execute(
    { team: "Galatasaray" },
    { toolCallId: "fx-gs-2", messages: [] }
  )) as FixturePayload;

  assert.equal(gsLondon.timeZone, "Europe/London");
  assert.equal(gsLondon.kickoffTimeZone, "Europe/London (GMT)");
  assert.equal(
    gsLondon.upcoming[0]?.kickoffLocal,
    "Saturday, 21 November 13:00"
  );

  // 3) Voice executeSharedVoiceToolCall returns local times + coverageNote + competitions and omits raw UTC from voiceResult
  clearFixtureCache();
  const voiceOutcome = await executeSharedVoiceToolCall({
    session: fakeSession,
    userId: fakeSession.user.id,
    timeZone: "Europe/Istanbul",
    locale: "tr",
    now,
    homeLocation: null,
    toolCallId: "tc-fb-1",
    toolName: "getFixtures",
    args: { team: "Fenerbahçe" },
    fetchImpl: makeTurkishClubFetch("Fenerbahçe"),
  });

  assert.equal(voiceOutcome.voiceResult.status, "ok");
  assert.equal(voiceOutcome.voiceResult.timeZone, "Europe/Istanbul");
  assert.equal(
    voiceOutcome.voiceResult.kickoffTimeZone,
    "Europe/Istanbul (TSİ)"
  );
  assert.deepEqual(voiceOutcome.voiceResult.competitions, [
    "Turkish Super Lig",
  ]);
  assert.match(
    String(voiceOutcome.voiceResult.coverageNote ?? ""),
    /domestic league matches only/i
  );
  const voiceNext = voiceOutcome.voiceResult.next as Record<string, unknown>;
  // 2026-11-21T16:00:00Z -> 19:00 in Europe/Istanbul (TSİ)
  assert.equal(voiceNext.kickoffLocal, "21 Kasım Cumartesi 19:00");
  assert.equal(voiceNext.kickoffTimeZone, "Europe/Istanbul (TSİ)");
  assert.equal(
    "kickoffUtc" in voiceNext,
    false,
    "voiceResult must not hand raw UTC to the voice model"
  );
  assert.match(
    String(voiceOutcome.voiceResult.spokenInstruction ?? ""),
    /Türkiye saatiyle/i
  );
  assert.match(
    String(voiceOutcome.voiceResult.spokenInstruction ?? ""),
    /never give raw UTC/i
  );
  assert.match(
    String(voiceOutcome.voiceResult.spokenInstruction ?? ""),
    /webSearch/i
  );
});

test("Item 3: Live session prompt uses the browser's timezone instead of a hardcoded London fallback", () => {
  const fixedNow = new Date("2026-11-19T12:00:00Z");
  assert.equal(
    resolveLiveSessionTimeZone("Europe/Istanbul", "Europe/London"),
    "Europe/Istanbul"
  );
  assert.equal(
    resolveLiveSessionTimeZone(undefined, "Europe/Istanbul"),
    "Europe/Istanbul"
  );
  assert.equal(resolveLiveSessionTimeZone(undefined, null), "Europe/London");

  const istanbulPrompt = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/Istanbul",
    now: fixedNow,
  });
  assert.match(istanbulPrompt, /User time zone: Europe\/Istanbul \(TSİ\)/);
  assert.match(istanbulPrompt, /15:00 \(Europe\/Istanbul\)/);
  assert.doesNotMatch(istanbulPrompt, /Default home timezone: Europe\/London/);
});

// ---------------------------------------------------------------------------
// Item 2: webSearch voice result extracts trimmed fenced Firecrawl content
// ---------------------------------------------------------------------------

test("Item 2: webSearch voice result includes query-relevant trimmed fenced page content (<=1500/source, <=5000 total) and spokenInstruction while enforcing employer boundary first", async () => {
  // Build long noisy markdown with navigation junk up front and the real fixture buried deep
  const noiseBlock =
    "Menu | Haberler | Galeri | Video | Mağaza | Üyelik | Sponsorlar | ".repeat(
      60
    );
  const realMatchDetails =
    "UEFA Şampiyonlar Ligi fikstürümüz belli oldu: Fenerbahçe 25 Kasım Salı saat 20:45 (CET) / 22:45 TSİ'de Shakhtar Donetsk ile deplasmanda Polonya'daki Henryk Reyman Stadyumu'nda karşılaşacak.";
  const longMd1 = `${noiseBlock}\n\n${realMatchDetails}\n\n${noiseBlock}`;
  const longMd2 = `${"Diğer haberler ".repeat(220)}\n\nUEFA.com match centre: Shakhtar Donetsk vs Fenerbahçe — 25 November 2026, Kick-off 20:45 CET, Venue: Henryk Reyman Stadium, Krakow.\n\n${"Footer links ".repeat(150)}`;
  const longMd3 = `${"Mackolik reklam ".repeat(200)}\n\nFenerbahçe'nin Avrupa maç programı: 25 Kasım Shakhtar Donetsk deplasmanı, hakem ve yayın bilgileri açıklandı.`;
  const longMd4 = "Fourth source content that should not bloat voiceResult.";

  // 1) Helper selects the relevant passage containing query terms + dates
  const extracted = extractRelevantWebPassage(
    longMd1,
    "Fenerbahçe Şampiyonlar Ligi Shakhtar Donetsk maçı ne zaman nerede",
    1500
  );
  assert.ok(extracted.length <= 1500);
  assert.match(extracted, /25 Kasım/);
  assert.match(extracted, /Shakhtar Donetsk/);
  assert.match(extracted, /Henryk Reyman Stadyumu/);

  // 2) runFirecrawlSearch exposes focused fenced markdown even for long scraped pages
  const fcRes = await runFirecrawlSearch({
    query: "Fenerbahçe Şampiyonlar Ligi Shakhtar Donetsk maçı",
    apiKey: "test-key",
    fetchImpl: (() =>
      Promise.resolve(
        Response.json({
          success: true,
          data: [
            {
              title: "Fenerbahçe SK — Şampiyonlar Ligi fikstürümüz belli oldu",
              url: "https://www.fenerbahce.org/haberler/futbol/cl-fikstur",
              description: "Fenerbahçe'nin Avrupa maç programı açıklandı.",
              markdown: longMd1,
            },
          ],
        })
      )) as typeof fetch,
  });
  assert.equal(fcRes.status, "ok");
  if (fcRes.status === "ok") {
    assert.match(fcRes.results[0]?.fencedMarkdown ?? "", /<untrusted_content/);
    assert.match(
      fcRes.results[0]?.fencedMarkdown ?? "",
      /Henryk Reyman Stadyumu/
    );
  }

  // 3) executeSharedVoiceToolCall("webSearch") includes fenced page content for top 3, caps total <= 5000, adds spokenInstruction, and never logs content
  const logged: string[] = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...args: unknown[]) =>
    logged.push(args.map(String).join(" "));
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));

  try {
    const voiceOutcome = await executeSharedVoiceToolCall({
      session: fakeSession,
      userId: fakeSession.user.id,
      timeZone: "Europe/Istanbul",
      locale: "tr",
      homeLocation: null,
      toolCallId: "tc-web-cl",
      toolName: "webSearch",
      args: {
        query: "Fenerbahçe Şampiyonlar Ligi Shakhtar Donetsk maçı nerede",
      },
      firecrawlSearch: ({ query }) =>
        Promise.resolve({
          status: "ok" as const,
          query,
          fetchedAtIso: "2026-11-19",
          results: [
            {
              title: "fenerbahce.org — Şampiyonlar Ligi fikstürümüz belli oldu",
              url: "https://www.fenerbahce.org/cl-fikstur",
              description: "Fikstür belli oldu.",
              publishedDate: "2026-11-19",
              fencedMarkdown: `<untrusted_content source="firecrawl:search:fb" trust="untrusted" suspicious="false">\n${longMd1}\n</untrusted_content>`,
            },
            {
              title: "UEFA.com — Shakhtar vs Fenerbahçe",
              url: "https://www.uefa.com/match/fb-shakhtar",
              description: "Match centre.",
              publishedDate: "2026-11-19",
              fencedMarkdown: `<untrusted_content source="firecrawl:search:uefa" trust="untrusted" suspicious="false">\n${longMd2}\n</untrusted_content>`,
            },
            {
              title: "Mackolik — Fenerbahçe Avrupa fikstürü",
              url: "https://www.mackolik.com/fb-cl",
              description: "Maç programı.",
              publishedDate: "2026-11-19",
              fencedMarkdown: `<untrusted_content source="firecrawl:search:mackolik" trust="untrusted" suspicious="false">\n${longMd3}\n</untrusted_content>`,
            },
            {
              title: "Milliyet — Spor haberleri",
              url: "https://www.milliyet.com.tr/skorer/fb",
              description: "Detaylar.",
              publishedDate: "2026-11-19",
              fencedMarkdown: `<untrusted_content source="firecrawl:search:milliyet" trust="untrusted" suspicious="false">\n${longMd4}\n</untrusted_content>`,
            },
          ],
        }),
    });

    assert.equal(voiceOutcome.blocked, false);
    assert.equal(voiceOutcome.voiceResult.status, "ok");
    const sources = voiceOutcome.voiceResult.sources as Array<{
      title: string;
      url: string;
      content?: string;
    }>;
    assert.equal(sources.length, 4);

    // Top 3 have fenced page content containing concrete match facts; 4th omits content
    let totalContentChars = 0;
    for (let i = 0; i < 3; i += 1) {
      const content = sources[i]?.content ?? "";
      assert.ok(content.length > 0, `source ${i} must include trimmed content`);
      assert.match(content, /^<untrusted_content source="webSearch:/);
      assert.match(content, /<\/untrusted_content>$/);
      assert.ok(
        content.length <= 1700,
        `source ${i} content too large: ${content.length}`
      );
      totalContentChars += content.length;
    }
    assert.ok(
      totalContentChars <= 5000,
      `total content must be <= 5000 chars, got ${totalContentChars}`
    );
    assert.equal(sources[3]?.content, undefined);
    assert.match(sources[0]?.content ?? "", /Henryk Reyman Stadyumu/);
    assert.match(sources[1]?.content ?? "", /Krakow/);

    // spokenInstruction tells voice model to answer directly with concrete facts & cite source
    const instr = String(voiceOutcome.voiceResult.spokenInstruction ?? "");
    assert.match(instr, /concrete facts/i);
    assert.match(instr, /date.*time.*opponent.*venue/i);
    assert.match(instr, /cite the source name/i);
    assert.match(instr, /only say details are unavailable/i);

    // Never logged scraped content
    assert.ok(
      !logged.some((l) => l.includes("Henryk Reyman") || l.includes("Krakow")),
      "Scraped web content must never be logged"
    );

    // Employer data-boundary block still runs FIRST before Firecrawl
    let firecrawlCalled = false;
    const blocked = await runServerWebSearch({
      query: "Korn Ferry SA90 EOSB accrual schedule",
      firecrawlSearch: () => {
        firecrawlCalled = true;
        return Promise.reject(new Error("must not call firecrawl"));
      },
    });
    assert.equal(blocked.status, "blocked_data_boundary");
    assert.equal(firecrawlCalled, false);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
  }
});

// ---------------------------------------------------------------------------
// Item 4: Filler detection (incl. promise clauses) & engine/server drop paths
// ---------------------------------------------------------------------------

test("Item 4a: isFillerOnlyUtterance catches Turkish/English promise & wait fillers while preserving real match facts", () => {
  for (const filler of [
    "Detaylı fikstüre bakıyorum, hemen sana güncel bilgiyi vereceğim.",
    "Maç programını kontrol ediyorum...",
    "Maç programını kontrol ediyorum.",
    "Hemen sana bilgi vereceğim.",
    "Hemen kontrol edip sana söyleyeceğim.",
    "Bir saniye, hemen bakıyorum.",
    "Bir saniye.",
    "Hemen bakıyorum.",
    "One moment, I'll get back to you.",
    "Give me a sec, checking that now.",
    "One moment.",
    "Give me a sec.",
    "Checking the detailed fixtures, I'll let you know shortly.",
  ]) {
    assert.equal(
      isFillerOnlyUtterance(filler),
      true,
      `Expected filler=true for: ${filler}`
    );
  }

  for (const real of [
    "Fenerbahçe 25 Kasım'da Shakhtar ile deplasmanda oynayacak.",
    "Galatasaray Samsunspor maçı 21 Kasım 16:00'da.",
    "Fenerbahçe 2-1 kazandı.",
    "Shakhtar Donetsk maçı Krakow'da oynanacak.",
    "Tamam.",
    "Yarın saat 15:00'te bilgi vereceğim.",
    "I finished checking your inbox and you have 3 unread messages from Ali.",
    "Web araması şu an başarısız oldu, tekrar denememi ister misin?",
  ]) {
    assert.equal(
      isFillerOnlyUtterance(real),
      false,
      `Expected filler=false for: ${real}`
    );
  }
});

test("Item 4b: LiveToolTurnGuard & commit paths drop late pre-tool fillers across tool-in-flight, tool-done, turnComplete, and interrupt", () => {
  const guard = new LiveToolTurnGuard();
  const assembler = new LiveTurnAssembler();

  // 1) User speaks; tool-call arrives before filler output transcript finishes
  assembler.addInput("Fenerbahçe'nin Şampiyonlar Ligi maçı nerede?");
  guard.onToolStart("call-1");
  const preToolCommit = assembler.commit(false);
  assert.ok(preToolCommit);
  const keptPreTool = guard.filterCommit(preToolCommit, {
    dropFillerAssistant: true,
  });
  assert.deepEqual(keptPreTool, {
    user: "Fenerbahçe'nin Şampiyonlar Ligi maçı nerede?",
    assistant: "",
    interrupted: false,
  });

  // 2) While tool is in flight, late filler arrives and an interrupt occurs -> DROPPED
  assembler.addOutput(
    "Detaylı fikstüre bakıyorum, hemen sana güncel bilgiyi vereceğim."
  );
  const midToolCommit = assembler.commit(true);
  assert.ok(midToolCommit);
  assert.equal(guard.filterCommit(midToolCommit), null);

  // 3) Tool finishes, and AFTER toolDone a late filler arrives on turn-complete -> STILL DROPPED
  guard.onToolDone("call-1");
  assert.equal(guard.isDroppingFillers, true);
  assembler.addOutput("Maç programını kontrol ediyorum...");
  const lateAfterToolCommit = assembler.commit(false);
  assert.ok(lateAfterToolCommit);
  assert.equal(guard.filterCommit(lateAfterToolCommit), null);
  assert.equal(
    guard.isDroppingFillers,
    true,
    "Guard stays armed until a real non-filler post-tool answer commits"
  );

  // 4) Real post-tool answer arrives and commits -> KEPT, and guard disarms
  assembler.addOutput(
    "Fenerbahçe 25 Kasım'da Shakhtar ile deplasmanda oynayacak."
  );
  const realCommit = assembler.commit(false);
  assert.ok(realCommit);
  const keptReal = guard.filterCommit(realCommit);
  assert.deepEqual(keptReal, {
    user: "",
    assistant: "Fenerbahçe 25 Kasım'da Shakhtar ile deplasmanda oynayacak.",
    interrupted: false,
  });
  assert.equal(guard.isDroppingFillers, false);

  // 5) filterCommittedLiveTurn safety net drops assistant-only filler even outside tool window
  assert.equal(
    filterCommittedLiveTurn({
      user: "",
      assistant:
        "Detaylı fikstüre bakıyorum, hemen sana güncel bilgiyi vereceğim.",
      interrupted: false,
    }),
    null
  );

  // 6) Verify server route live-transcript and client voice-memo-button wire the safety net
  const liveTranscriptSrc = readFileSync(
    resolve(process.cwd(), "app/api/voice/live-transcript/route.ts"),
    "utf8"
  );
  assert.match(liveTranscriptSrc, /isFillerOnlyUtterance/);
  const voiceMemoSrc = readFileSync(
    resolve(process.cwd(), "components/chat/voice-memo-button.tsx"),
    "utf8"
  );
  assert.match(voiceMemoSrc, /filterCommittedLiveTurn/);
});

// ---------------------------------------------------------------------------
// Item 5: Lost context — 20-row builder, tool summaries, caps, reconnect, handoff
// ---------------------------------------------------------------------------

test("Item 5: buildCompactVoiceRecentTurns scans 20 rows, skips fillers, summarizes webSearch/getFixtures, enforces 6000-char cap, and preserves chatId on reconnect", () => {
  const rows: StoredVoiceMessageRow[] = [];
  // Add 4 older rows beyond the 20-row window
  for (let i = 1; i <= 4; i += 1) {
    rows.push({
      role: "user",
      parts: [{ type: "text", text: `Very old message #${i}` }],
    });
  }
  // Add 20 recent rows mixing user turns, filler bubbles, webSearch tool, getFixtures tool, and answers
  rows.push(
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: "Fenerbahçe'nin Şampiyonlar Ligi maçı ne zaman?",
        },
      ],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Detaylı fikstüre bakıyorum, hemen sana güncel bilgiyi vereceğim.",
        },
      ],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "tool-webSearch",
          state: "output-available",
          input: { query: "Fenerbahçe Şampiyonlar Ligi fikstür" },
          output: {
            results: [
              {
                title: "UEFA.com — Shakhtar vs Fenerbahçe",
                url: "https://www.uefa.com/match/1",
                snippet: "25 Kasım Salı 22:45 TSİ Krakow deplasmanı.",
              },
              {
                title: "fenerbahce.org — Şampiyonlar Ligi fikstürümüz",
                url: "https://www.fenerbahce.org/cl",
                snippet: "Shakhtar Donetsk ile deplasmanda karşılaşacağız.",
              },
            ],
            summary:
              "UEFA.com ve fenerbahce.org: Fenerbahçe 25 Kasım Salı 22:45 TSİ'de Shakhtar Donetsk ile Polonya Krakow'da oynayacak.",
          },
        },
      ],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Maç programını kontrol ediyorum...",
        },
      ],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Fenerbahçe 25 Kasım'da Shakhtar Donetsk ile deplasmanda oynayacak.",
        },
      ],
    },
    {
      role: "user",
      parts: [{ type: "text", text: "Süper Lig'de sıradaki maçı ne zaman?" }],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "tool-getFixtures",
          state: "output-available",
          input: { team: "Fenerbahçe" },
          output: {
            team: { id: "133805", name: "Fenerbahçe", badge: null },
            timeZone: "Europe/Istanbul",
            kickoffTimeZone: "Europe/Istanbul (TSİ)",
            competitions: ["Turkish Super Lig"],
            now: "2026-11-19T12:00:00Z",
            upcoming: [
              {
                id: "fb-1",
                competition: "Turkish Super Lig",
                venue: "Şükrü Saracoğlu Stadyumu",
                kickoffUtc: "2026-11-21T16:00:00Z",
                kickoffLocal: "21 Kasım Cumartesi 19:00",
                kickoffTimeZone: "Europe/Istanbul (TSİ)",
                home: { name: "Fenerbahçe", badge: null },
                away: { name: "Kocaelispor", badge: null },
                homeScore: null,
                awayScore: null,
              },
            ],
            last: null,
          },
        },
      ],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Korn Ferry SA90 confidential accrual work note should be stripped.",
        },
      ],
    }
  );
  // Pad remaining slots up to 20 recent rows
  for (let i = 1; i <= 12; i += 1) {
    rows.push({
      role: i % 2 === 0 ? "assistant" : "user",
      parts: [{ type: "text", text: `Follow-up chat turn #${i}` }],
    });
  }

  const turns = buildCompactVoiceRecentTurns(rows, {
    maxRows: 20,
    maxChars: 6000,
    timeZone: "Europe/Istanbul",
  });
  const block = formatVoiceRecentContextBlock(turns);

  // Older than 20 rows excluded
  assert.doesNotMatch(block, /Very old message #1/);
  // Fillers skipped
  assert.doesNotMatch(block, /Detaylı fikstüre bakıyorum/);
  assert.doesNotMatch(block, /Maç programını kontrol ediyorum/);
  // Restricted work data dropped
  assert.doesNotMatch(block, /Korn Ferry|SA90/i);
  // Tool summaries included
  assert.match(block, /\[webSearch "Fenerbahçe Şampiyonlar Ligi fikstür"\]/);
  assert.match(block, /UEFA\.com — Shakhtar vs Fenerbahçe/);
  assert.match(block, /Polonya Krakow/);
  assert.match(block, /\[getFixtures Fenerbahçe\]/);
  assert.match(block, /Fenerbahçe vs Kocaelispor \(21 Kasım Cumartesi 19:00/);
  assert.match(block, /Follow-up chat turn #12/);
  assert.ok(block.length <= 6200);

  // Respects strict total char cap and keeps the NEWEST turns
  const hugeRows: StoredVoiceMessageRow[] = Array.from(
    { length: 20 },
    (_, idx) => ({
      role: idx % 2 === 0 ? "user" : "assistant",
      parts: [
        {
          type: "text",
          text: `Turn-${idx + 1}: ${"x".repeat(500)}`,
        },
      ],
    })
  );
  const capped = buildCompactVoiceRecentTurns(hugeRows, {
    maxRows: 20,
    maxChars: 2000,
  });
  const cappedBlock = formatVoiceRecentContextBlock(capped, { maxChars: 2000 });
  assert.ok(
    cappedBlock.length <= 2100,
    `Expected capped block near 2000 chars, got ${cappedBlock.length}`
  );
  assert.match(cappedBlock, /Turn-20:/, "Must preserve the newest turn");
  assert.doesNotMatch(cappedBlock, /Turn-1:/, "Oldest turns drop first on cap");

  // Reconnect request body preserves chatId & timeZone (with or without resumeHandle)
  const chatId = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(
    buildLiveSessionRequestBody(
      { chatId, timeZone: "Europe/Istanbul" },
      "resume-token-1"
    ),
    {
      chatId,
      timeZone: "Europe/Istanbul",
      resumeHandle: "resume-token-1",
    }
  );
  assert.deepEqual(
    buildLiveSessionRequestBody({ chatId, timeZone: "Europe/Istanbul" }, null),
    {
      chatId,
      timeZone: "Europe/Istanbul",
    }
  );
});

test("Item 5: executeVoiceTextAgentHandoff passes compact recent context into its system prompt", async () => {
  let capturedSystem = "";
  const mockModel = new MockLanguageModelV4({
    doGenerate: (opts) => {
      const sysMsg = opts.prompt.find((m) => m.role === "system");
      capturedSystem =
        sysMsg && typeof sysMsg.content === "string" ? sysMsg.content : "";
      return Promise.resolve({
        content: [
          {
            type: "text" as const,
            text: "Shakhtar Donetsk maçı 25 Kasım'da Krakow'da oynanacak.",
          },
        ],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: mockUsage,
        warnings: [],
      });
    },
  });

  const res = await executeVoiceTextAgentHandoff({
    session: fakeSession,
    userId: fakeSession.user.id,
    chatId: crypto.randomUUID(),
    request: "O maç hangi statta oynanıyor?",
    locale: "tr",
    timeZone: "Europe/Istanbul",
    recentTurns: [
      {
        role: "assistant",
        text: '[webSearch "Fenerbahçe Şampiyonlar Ligi"] Sources: UEFA.com — Shakhtar Donetsk vs Fenerbahçe 25 Kasım Krakow',
      },
      {
        role: "assistant",
        text: "Detaylı fikstüre bakıyorum, hemen sana güncel bilgiyi vereceğim.",
      },
    ],
    memoryStore: createInMemoryMemoryStore(),
    approvalPrefsStore: createInMemoryApprovalPreferencesStore(),
    journalStore: createInMemoryExecutionJournalStore(),
    modelOverride: mockModel,
  });

  assert.equal(res.blocked, false);
  assert.match(capturedSystem, /Recent conversation in this chat/);
  assert.match(
    capturedSystem,
    /Shakhtar Donetsk vs Fenerbahçe 25 Kasım Krakow/
  );
  assert.doesNotMatch(
    capturedSystem,
    /Detaylı fikstüre bakıyorum/,
    "Handoff context must skip filler utterances too"
  );
});

// ---------------------------------------------------------------------------
// Item 1, 3 & 6: Prompt, declaration & STT sports hint assertions
// ---------------------------------------------------------------------------

test("Item 1, 3 & 6: prompts, tool declarations, and STT include European/cup web trust, no-contradiction re-check, local zone rule, and sports STT hints", async () => {
  // Voice getFixtures tool declaration
  const voiceFixturesDecl = LIVE_VOICE_TOOL_DECLARATIONS.find(
    (t) => t.name === "getFixtures"
  );
  assert.ok(voiceFixturesDecl);
  assert.match(voiceFixturesDecl.description, /domestic league/i);
  assert.match(voiceFixturesDecl.description, /Champions League/i);
  assert.match(voiceFixturesDecl.description, /webSearch/i);

  // Text getFixtures tool description
  const textFixturesTool = getFixtures();
  const textDesc =
    (textFixturesTool as { description?: string }).description ?? "";
  assert.match(textDesc, /domestic league/i);
  assert.match(textDesc, /Champions League/i);
  assert.match(textDesc, /webSearch/i);
  assert.match(textDesc, /never give raw UTC/i);

  // Voice system instruction
  const voicePrompt = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/Istanbul",
    now: new Date("2026-11-19T12:00:00Z"),
  });
  assert.match(
    voicePrompt,
    /trust the web sources for European and cup matches/i
  );
  assert.match(
    voicePrompt,
    /NEVER deny or contradict something you stated earlier.*re-checking with webSearch/i
  );
  assert.match(voicePrompt, /Türkiye saatiyle/i);
  assert.match(voicePrompt, /never give raw UTC/i);
  assert.match(voicePrompt, /convert it to Europe\/Istanbul/i);
  assert.match(voicePrompt, /Schalke Dortmund.*Shakhtar Donetsk/i);

  // Text system prompt with includeFixtures
  const textPrompt = systemPrompt({
    supportsTools: true,
    includeFixtures: true,
    includeWebSearch: true,
  });
  assert.match(
    textPrompt,
    /trust the web sources for European and cup matches/i
  );
  assert.match(
    textPrompt,
    /NEVER deny or contradict something you said earlier.*re-checking with webSearch/i
  );
  assert.match(textPrompt, /Türkiye saatiyle/i);
  assert.match(textPrompt, /never give raw UTC/i);

  // STT /api/voice/transcribe includes sports vocabulary hint in existing prompt field
  assert.match(VOICE_STT_SPORTS_VOCABULARY_HINT, /Shakhtar Donetsk/);
  assert.match(VOICE_STT_SPORTS_VOCABULARY_HINT, /Şampiyonlar Ligi/);
  assert.match(VOICE_STT_SPORTS_VOCABULARY_HINT, /Fenerbahçe/);
  assert.match(VOICE_STT_SPORTS_VOCABULARY_HINT, /Galatasaray/);

  const vault = createInMemoryVaultStore(
    "0123456789abcdef0123456789abcdef-voice-vault-key"
  );
  await vault.upsertSecret({
    userId: "owner-stt",
    name: VOICE_VAULT_SECRET_NAMES.geminiApiKey,
    plaintext: "AIzaSy-test-stt-key",
  });
  let capturedBody = "";
  const sttRes = await transcribeVoiceMemo({
    userId: "owner-stt",
    mimeType: "audio/webm",
    bytes: new Uint8Array(1024),
    vaultStore: vault,
    fetchImpl: ((_url, init) => {
      capturedBody = String(init?.body ?? "");
      return Promise.resolve(
        Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: "Fenerbahçe Shakhtar Donetsk maçı nerede?" }],
              },
            },
          ],
        })
      );
    }) as typeof fetch,
  });
  assert.equal(sttRes.status, "ok");
  assert.match(capturedBody, /Shakhtar Donetsk/);
  assert.match(capturedBody, /Şampiyonlar Ligi/);
});
