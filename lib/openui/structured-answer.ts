import type {
  ComparisonRow,
  SeriesPoint,
  TimelineEvent,
  VisualSnapshot,
} from "./snapshot";

const VISUAL_CANDIDATE_PATTERN =
  /\b(vs\.?|versus|compare|comparison|difference\s+between|pros\s+and\s+cons|trade[- ]?offs?|top\s+\d+|highest[- ]paid|top\s+earners?|rank(?:ing)?|chart|graph|plot|breakdown|market\s+share|table|schedule|tax\s+bands?|pricing|rates?|salary|compensation|timeline|chronology|milestones?|roadmap|key\s+dates|history\s+of|where\s+is|map\s+of|coordinates|karşılaştır\p{L}*|kıyasla\p{L}*|arasındaki\s+fark\p{L}*|en\s+çok\s+\p{L}+|en\s+yüksek\s+\p{L}+|sıralama\p{L}*|grafik\p{L}*|tablo\p{L}*|oran\p{L}*|maaş\p{L}*|kazanç\p{L}*|fiyat\p{L}*|zaman\s+çizelgesi|kronoloji\p{L}*|tarihçe\p{L}*|aşamalar\p{L}*|kilometre\s+taş\p{L}*|nerede|harita\p{L}*)\b/iu;

export function isVisualCandidateTurn(
  userText: string,
  requestedTools: readonly string[]
): boolean {
  if (
    requestedTools.includes("getWeather") ||
    requestedTools.includes("webSearch")
  ) {
    return true;
  }
  return VISUAL_CANDIDATE_PATTERN.test(userText);
}

function cleanCell(raw: string, max = 140): string {
  return raw
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function emptySnap(title: string, summary: string): VisualSnapshot {
  return {
    header: { title, summary },
    series: {},
    tables: {},
    stats: {},
    places: {},
    comparisons: {},
    timelines: {},
  };
}

function parseMetricCell(raw: string): { value: number; unit: string } | null {
  const cleaned = cleanCell(raw, 60).replace(/^[~≈]\s*/, "");
  if (!cleaned) {
    return null;
  }
  // e.g. "$161.8M", "161,8 milyon $", "45%", "34.4 TRY", "1,250 ms"
  const currencyPrefix =
    /^([$€£₺])\s*([-+]?\d+(?:[.,]\d+)?)\s*([BMK]|billion|million|milyon|milyar)?\b/i.exec(
      cleaned
    );
  if (currencyPrefix) {
    const sym = currencyPrefix[1] ?? "";
    const num = Number(currencyPrefix[2]?.replace(",", "."));
    const suffix = currencyPrefix[3] ?? "";
    if (Number.isFinite(num)) {
      const unitSuffix = suffix
        ? suffix.length === 1
          ? suffix.toUpperCase()
          : suffix.toLowerCase() === "milyon" ||
              suffix.toLowerCase() === "million"
            ? "M"
            : suffix.toLowerCase() === "milyar" ||
                suffix.toLowerCase() === "billion"
              ? "B"
              : suffix
        : "";
      return { value: num, unit: `${sym}${unitSuffix}`.trim() };
    }
  }

  const suffixMatch =
    /^([-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[-+]?\d+(?:[.,]\d+)?)\s*(%|°[CF]?|ms|s|GB|TB|MB|km\/h|mph|USD|EUR|GBP|TRY|\$|€|£|₺|milyon\s*\$?|million\s*\$?|M\s*\$?)?$/i.exec(
      cleaned
    );
  if (!suffixMatch) {
    return null;
  }
  const rawNum = suffixMatch[1] ?? "";
  // Distinguish thousands comma (1,250) from decimal comma (161,8)
  const normalizedNum =
    rawNum.includes(",") && !rawNum.includes(".")
      ? /,\d{3}$/.test(rawNum)
        ? rawNum.replace(/,/g, "")
        : rawNum.replace(",", ".")
      : rawNum.replace(/,/g, "");
  const num = Number(normalizedNum);
  if (!Number.isFinite(num)) {
    return null;
  }
  const rawUnit = (suffixMatch[2] ?? "").trim();
  const unit = /milyon\s*\$/i.test(rawUnit)
    ? "$M"
    : /milyon/i.test(rawUnit)
      ? "M"
      : rawUnit.slice(0, 12);
  return { value: num, unit };
}

function parseVisualJsonBlock(rawText: string): {
  title: string;
  summary: string;
  data: VisualSnapshot;
} | null {
  const closedMatch = /```visual-json\s*([\s\S]*?)```/i.exec(rawText);
  if (!closedMatch?.[1]) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(closedMatch[1].trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const kind =
    typeof obj.kind === "string" ? obj.kind.trim().toLowerCase() : "";
  const title = cleanCell(String(obj.title ?? ""), 90) || "Overview";
  const summary =
    cleanCell(String(obj.summary ?? ""), 140) ||
    (kind === "comparison"
      ? "Side-by-side comparison"
      : kind === "timeline"
        ? "Key milestones"
        : kind === "map"
          ? "Location overview"
          : "Structured breakdown");

  if (kind === "comparison") {
    const rawOptions = Array.isArray(obj.options) ? obj.options : [];
    const options = rawOptions
      .map((o) => cleanCell(String(o ?? ""), 44))
      .filter(Boolean)
      .slice(0, 3);
    const rawRows = Array.isArray(obj.rows) ? obj.rows : [];
    const rows: ComparisonRow[] = [];
    for (const r of rawRows) {
      if (!r || typeof r !== "object") {
        continue;
      }
      const rec = r as Record<string, unknown>;
      const feature = cleanCell(String(rec.feature ?? rec.label ?? ""), 60);
      const vals = Array.isArray(rec.values)
        ? rec.values.map((v) => cleanCell(String(v ?? ""), 90))
        : [];
      if (!feature || vals.length < options.length) {
        continue;
      }
      const winner =
        typeof rec.winnerIndex === "number" &&
        Number.isInteger(rec.winnerIndex) &&
        rec.winnerIndex >= 0 &&
        rec.winnerIndex < options.length
          ? rec.winnerIndex
          : undefined;
      rows.push({
        feature,
        values: vals.slice(0, options.length),
        ...(winner !== undefined ? { winnerIndex: winner } : {}),
      });
      if (rows.length >= 8) {
        break;
      }
    }
    if (options.length < 2 || rows.length < 2) {
      return null;
    }
    const verdict =
      typeof obj.verdict === "string"
        ? cleanCell(obj.verdict, 180) || undefined
        : undefined;
    const snap = emptySnap(title, summary);
    snap.comparisons = {
      comparison: { options, rows, ...(verdict ? { verdict } : {}) },
    };
    return { title, summary, data: snap };
  }

  if (kind === "timeline") {
    const rawEvents = Array.isArray(obj.events) ? obj.events : [];
    const events: TimelineEvent[] = [];
    for (const item of rawEvents) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const when = cleanCell(String(rec.when ?? rec.date ?? ""), 36);
      const evTitle = cleanCell(String(rec.title ?? ""), 90);
      const detail =
        typeof rec.detail === "string"
          ? cleanCell(rec.detail, 160) || undefined
          : undefined;
      const badge =
        typeof rec.badge === "string"
          ? cleanCell(rec.badge, 28) || undefined
          : undefined;
      if (!when || !evTitle) {
        continue;
      }
      events.push({
        when,
        title: evTitle,
        ...(detail ? { detail } : {}),
        ...(badge ? { badge } : {}),
      });
      if (events.length >= 8) {
        break;
      }
    }
    if (events.length < 2) {
      return null;
    }
    const snap = emptySnap(title, summary);
    snap.timelines = { timeline: { events } };
    return { title, summary, data: snap };
  }

  if (kind === "chart") {
    const chartKind =
      obj.chartKind === "line" || obj.chartKind === "pie"
        ? obj.chartKind
        : "bar";
    const unit =
      typeof obj.unit === "string" ? cleanCell(obj.unit, 14) : undefined;
    const rawPoints = Array.isArray(obj.points) ? obj.points : [];
    const points: SeriesPoint[] = [];
    for (const p of rawPoints) {
      if (!p || typeof p !== "object") {
        continue;
      }
      const rec = p as Record<string, unknown>;
      const label = cleanCell(String(rec.label ?? ""), 32);
      const val =
        typeof rec.value === "number" && Number.isFinite(rec.value)
          ? rec.value
          : Number(rec.value);
      if (!label || !Number.isFinite(val)) {
        continue;
      }
      points.push({ label, value: Math.round(val * 100) / 100 });
      if (points.length >= 8) {
        break;
      }
    }
    if (points.length < 2) {
      return null;
    }
    const snap = emptySnap(title, summary);
    snap.series.ranking = {
      title,
      kind: chartKind,
      ...(unit ? { unit } : {}),
      points,
    };
    snap.tables.rankingTable = {
      columns: ["Item", unit ? `Value (${unit})` : "Value"],
      rows: points.map((pt) => [
        pt.label,
        unit ? `${pt.value} ${unit}` : String(pt.value),
      ]),
    };
    const top = [...points].sort((a, b) => b.value - a.value)[0];
    if (top && chartKind === "bar") {
      snap.stats.highlight = {
        label: "Top figure",
        value: unit ? `${top.value} ${unit}` : String(top.value),
        hint: top.label,
      };
    }
    return { title, summary, data: snap };
  }

  if (kind === "table") {
    const columns = Array.isArray(obj.columns)
      ? obj.columns
          .map((c) => cleanCell(String(c ?? ""), 36))
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const rawRows = Array.isArray(obj.rows) ? obj.rows : [];
    const rows: string[][] = [];
    for (const r of rawRows) {
      if (!Array.isArray(r)) {
        continue;
      }
      const cells = r
        .slice(0, columns.length)
        .map((c) => cleanCell(String(c ?? ""), 90));
      if (cells.some(Boolean)) {
        rows.push(cells);
      }
      if (rows.length >= 10) {
        break;
      }
    }
    if (columns.length < 2 || rows.length < 2) {
      return null;
    }
    const snap = emptySnap(title, summary);
    snap.tables.structured = { columns, rows };
    return { title, summary, data: snap };
  }

  if (kind === "map") {
    const lat = Number(obj.latitude);
    const lon = Number(obj.longitude);
    const label = cleanCell(String(obj.label ?? title), 64);
    if (
      !label ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -85 ||
      lat > 85 ||
      lon < -180 ||
      lon > 180
    ) {
      return null;
    }
    const snap = emptySnap(title, summary);
    snap.places.here = { label, latitude: lat, longitude: lon };
    return { title, summary, data: snap };
  }

  return null;
}

function parseMarkdownTableFallback(rawText: string): {
  title: string;
  summary: string;
  data: VisualSnapshot;
} | null {
  // Never parse while an unclosed visual-json / code fence is still streaming
  const fenceCount = (rawText.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    return null;
  }
  const withoutCode = rawText.replace(/```[\s\S]*?```/g, "");
  const lines = withoutCode.split(/\r?\n/);

  let headerIdx = -1;
  for (let i = 0; i < lines.length - 2; i++) {
    const cur = lines[i]?.trim() ?? "";
    const sep = lines[i + 1]?.trim() ?? "";
    if (
      cur.includes("|") &&
      /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(sep)
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return null;
  }

  const splitRow = (line: string): string[] => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((c) => cleanCell(c, 90));
  };

  const columns = splitRow(lines[headerIdx] ?? "").filter(Boolean);
  if (columns.length < 2 || columns.length > 5) {
    return null;
  }

  const rows: string[][] = [];
  for (let j = headerIdx + 2; j < lines.length; j++) {
    const line = lines[j]?.trim() ?? "";
    if (!line.includes("|")) {
      break;
    }
    const cells = splitRow(line).slice(0, columns.length);
    if (cells.length >= 2 && cells.some(Boolean)) {
      while (cells.length < columns.length) {
        cells.push("—");
      }
      rows.push(cells);
    }
    if (rows.length >= 8) {
      break;
    }
  }
  if (rows.length < 2) {
    return null;
  }

  // Find heading above table if present
  let heading = "";
  for (let k = headerIdx - 1; k >= Math.max(0, headerIdx - 4); k--) {
    const hMatch = /^#{1,4}\s+(.+)$/.exec(lines[k]?.trim() ?? "");
    if (hMatch?.[1]) {
      heading = cleanCell(hMatch[1], 80);
      break;
    }
  }

  const firstColHeader = (columns[0] ?? "").toLowerCase();
  const isTimelineHeader =
    /^(year|date|when|era|period|phase|step|milestone|yıl|tarih|dönem|aşama)\b/i.test(
      firstColHeader
    );
  const allFirstColDates = rows.every((r) =>
    /^(?:\d{4}(?:[-–]\d{2,4})?|Q[1-4]\s*\d{4}|(?:Step|Phase|Stage|Aşama)\s*\d+)/i.test(
      r[0] ?? ""
    )
  );

  if ((isTimelineHeader || allFirstColDates) && columns.length <= 3) {
    const title = heading || "Timeline";
    const summary = `${rows.length} key milestones`;
    const snap = emptySnap(title, summary);
    snap.timelines = {
      timeline: {
        events: rows.map((r) => ({
          when: r[0] ?? "",
          title: r[1] ?? "",
          ...(r[2] && r[2] !== "—" ? { detail: r[2] } : {}),
        })),
      },
    };
    return { title, summary, data: snap };
  }

  // Check if numeric column exists for Chart + Table
  for (let colIdx = 1; colIdx < columns.length; colIdx++) {
    const parsedCol = rows.map((r) => parseMetricCell(r[colIdx] ?? ""));
    if (parsedCol.every((item) => item !== null)) {
      const unit = parsedCol[0]?.unit ?? "";
      const title = heading || `${columns[0]} — ${columns[colIdx]}`;
      const summary = `${rows.length} items compared`;
      const snap = emptySnap(title, summary);
      const points: SeriesPoint[] = rows.map((r, idx) => ({
        label: (r[0] ?? "").slice(0, 28),
        value: parsedCol[idx]?.value ?? 0,
      }));
      snap.series.ranking = {
        title: columns[colIdx] ?? title,
        kind: allFirstColDates ? "line" : "bar",
        ...(unit ? { unit } : {}),
        points,
      };
      snap.tables.rankingTable = { columns, rows };
      return { title, summary, data: snap };
    }
  }

  // Check if 2-3 option comparison table (`| Feature | Option A | Option B |`)
  const isFeatureHeader =
    /^(feature|criterion|aspect|category|metric|spec|dimension|özellik|kriter|kategori|boyut)\b/i.test(
      firstColHeader
    );
  if (isFeatureHeader && columns.length >= 3 && columns.length <= 4) {
    const options = columns.slice(1);
    const title = heading || options.join(" vs ");
    const summary = "Side-by-side comparison";
    const snap = emptySnap(title, summary);
    snap.comparisons = {
      comparison: {
        options,
        rows: rows.map((r) => ({
          feature: r[0] ?? "",
          values: r.slice(1, 1 + options.length),
        })),
      },
    };
    return { title, summary, data: snap };
  }

  const title = heading || "Summary table";
  const summary = `${rows.length} rows`;
  const snap = emptySnap(title, summary);
  snap.tables.structured = { columns, rows };
  return { title, summary, data: snap };
}

export function extractAnswerVisualSnapshot(rawText: string): {
  title: string;
  summary: string;
  data: VisualSnapshot;
} | null {
  if (!rawText || rawText.length < 24) {
    return null;
  }
  // If a visual-json fence started but hasn't closed yet, wait until it closes.
  if (
    /```visual-json\b/i.test(rawText) &&
    !/```visual-json\s*[\s\S]*?```/i.test(rawText)
  ) {
    return null;
  }
  return (
    parseVisualJsonBlock(rawText) ?? parseMarkdownTableFallback(rawText) ?? null
  );
}
