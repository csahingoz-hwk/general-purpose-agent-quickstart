import { tool } from "ai";
import { z } from "zod";
import {
  fetchGroundedNewsBriefing,
  isNewsPageOrBriefingTarget,
  validateGroundedNewsPageContent,
} from "@/lib/ai/grounded-news";
import { vertexEnabled } from "@/lib/ai/routing/catalog";
import type { UsageLedger } from "@/lib/ai/routing/ledger";
import {
  cloudReadWorkspaceFile,
  cloudRunExec,
  cloudWriteWorkspaceFile,
  isCloudComputerConfigured,
  resolveSafeWorkspacePath,
} from "@/lib/cloud-computer/client";
import {
  type CloudComputerLifecycleStore,
  resolveCloudLifecycleStore,
} from "@/lib/cloud-computer/lifecycle";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { sanitizeAttachmentFilename } from "@/lib/files/attachment-validator";
import { createSignedFileToken } from "@/lib/files/signed-url";
import {
  getDefaultPrivateFileStore,
  type PrivateFileStore,
} from "@/lib/files/store";
import { generateImageWithImagen } from "@/lib/media/media-studio";

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Strips any script patterns attempting top-frame navigation (`window.top.location`,
 * `parent.location`, `<base target="_top">`) so generated HTML pages stay strictly
 * inside their opaque sandboxed iframe.
 */
export function sanitizeSandboxedHtmlDocument(html: string): string {
  return html
    .replace(/<base\b[^>]*target\s*=\s*["']?_top["']?[^>]*>/gi, "")
    .replace(
      /\b(?:window\.top|top|parent)\s*\.\s*location(?:\s*\.\s*(?:href|assign|replace))?\b/gi,
      "/* sandbox-blocked-top-nav */ void 0"
    );
}

export type DashboardKpiInput = {
  label: string;
  value: string;
  delta?: string;
  tone?: "positive" | "negative" | "neutral";
};

export type DashboardChartInput = {
  id?: string;
  title: string;
  subtitle?: string;
  heightPx?: number;
  option: Record<string, unknown>;
};

export function composeSingleFileHtmlDashboard(input: {
  title: string;
  subtitle?: string;
  kpis?: readonly DashboardKpiInput[];
  charts?: readonly DashboardChartInput[];
  bodyHtml?: string;
  fullHtml?: string;
}): string {
  if (input.fullHtml?.trim()) {
    const raw = sanitizeSandboxedHtmlDocument(input.fullHtml.trim());
    if (/<!doctype\s+html|<html\b/i.test(raw)) {
      return raw;
    }
  }

  const kpis = input.kpis ?? [];
  const charts = input.charts ?? [];
  const hasCharts = charts.length > 0;
  const safeTitle = escapeHtml(input.title.trim() || "Dashboard");
  const safeSubtitle = input.subtitle?.trim()
    ? escapeHtml(input.subtitle.trim())
    : "";

  const kpiHtml =
    kpis.length > 0
      ? `<section class="kpi-grid">${kpis
          .map((kpi) => {
            const toneClass =
              kpi.tone === "positive"
                ? "delta-pos"
                : kpi.tone === "negative"
                  ? "delta-neg"
                  : "delta-neu";
            return `<article class="card kpi-card">
              <div class="kpi-label">${escapeHtml(kpi.label)}</div>
              <div class="kpi-value">${escapeHtml(kpi.value)}</div>
              ${kpi.delta ? `<div class="kpi-delta ${toneClass}">${escapeHtml(kpi.delta)}</div>` : ""}
            </article>`;
          })
          .join("\n")}</section>`
      : "";

  const chartsHtml =
    charts.length > 0
      ? `<section class="charts-grid">${charts
          .map((chart, idx) => {
            const chartId = `echart_${idx + 1}`;
            const height = Math.min(640, Math.max(220, chart.heightPx ?? 320));
            return `<article class="card chart-card">
              <header class="chart-header">
                <h2>${escapeHtml(chart.title)}</h2>
                ${chart.subtitle ? `<p>${escapeHtml(chart.subtitle)}</p>` : ""}
              </header>
              <div id="${chartId}" class="chart-box" style="height:${height}px;"></div>
            </article>`;
          })
          .join("\n")}</section>`
      : "";

  const serializedChartSpecs = JSON.stringify(
    charts.map((chart, idx) => ({
      domId: `echart_${idx + 1}`,
      option: chart.option,
    }))
  ).replace(/<\//g, "<\\/");

  const bodySection = input.bodyHtml?.trim()
    ? `<section class="card custom-body">${sanitizeSandboxedHtmlDocument(input.bodyHtml.trim())}</section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${safeTitle}</title>
  ${hasCharts ? '<script src="https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js"></script>' : ""}
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --fg: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --accent: #2563eb;
      --pos: #059669;
      --neg: #dc2626;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #090d16;
        --surface: #111827;
        --fg: #f8fafc;
        --muted: #94a3b8;
        --border: #1e293b;
        --accent: #60a5fa;
        --pos: #34d399;
        --neg: #f87171;
      }
    }
    :root[data-theme="dark"] {
      --bg: #090d16;
      --surface: #111827;
      --fg: #f8fafc;
      --muted: #94a3b8;
      --border: #1e293b;
      --accent: #60a5fa;
      --pos: #34d399;
      --neg: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
    }
    .wrap { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
    .topbar { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: clamp(1.25rem, 2.5vw, 1.75rem); letter-spacing: -0.02em; }
    .subtitle { margin: 4px 0 0; color: var(--muted); font-size: 0.92rem; }
    .theme-btn {
      min-height: 38px;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--fg);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
    }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .kpi-label { font-size: 0.78rem; color: var(--muted); font-weight: 500; }
    .kpi-value { margin-top: 6px; font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .kpi-delta { margin-top: 4px; font-size: 0.78rem; font-weight: 600; }
    .delta-pos { color: var(--pos); }
    .delta-neg { color: var(--neg); }
    .delta-neu { color: var(--muted); }
    .chart-header h2 { margin: 0; font-size: 1rem; }
    .chart-header p { margin: 3px 0 0; font-size: 0.82rem; color: var(--muted); }
    .chart-box { width: 100%; margin-top: 10px; }
    .custom-body a { color: var(--accent); text-underline-offset: 2px; }
    .custom-body table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    .custom-body th, .custom-body td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
  </style>
</head>
<body>
  <main class="wrap">
    <header class="topbar">
      <div>
        <h1>${safeTitle}</h1>
        ${safeSubtitle ? `<p class="subtitle">${safeSubtitle}</p>` : ""}
      </div>
      <button id="themeToggle" class="theme-btn" type="button">Dark / Light</button>
    </header>
    ${kpiHtml}
    ${chartsHtml}
    ${bodySection}
  </main>
  <script>
    (function () {
      var root = document.documentElement;
      var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      function isDarkActive() {
        var forced = root.getAttribute("data-theme");
        if (forced === "dark") return true;
        if (forced === "light") return false;
        return Boolean(mq && mq.matches);
      }
      var specs = ${serializedChartSpecs};
      var instances = [];
      function renderCharts() {
        if (!window.echarts || !specs.length) return;
        for (var i = 0; i < instances.length; i++) {
          try { instances[i].dispose(); } catch (_) {}
        }
        instances = [];
        var dark = isDarkActive();
        var fg = dark ? "#e2e8f0" : "#0f172a";
        var muted = dark ? "#94a3b8" : "#475569";
        var split = dark ? "#1e293b" : "#e2e8f0";
        for (var j = 0; j < specs.length; j++) {
          var el = document.getElementById(specs[j].domId);
          if (!el) continue;
          var inst = window.echarts.init(el, dark ? "dark" : null, { renderer: "canvas" });
          var baseOpt = Object.assign(
            {
              backgroundColor: "transparent",
              textStyle: { color: fg },
              legend: { textStyle: { color: muted } },
              tooltip: { trigger: "axis" }
            },
            specs[j].option || {}
          );
          if (baseOpt.xAxis && !Array.isArray(baseOpt.xAxis)) {
            baseOpt.xAxis = Object.assign({ axisLabel: { color: muted }, splitLine: { lineStyle: { color: split } } }, baseOpt.xAxis);
          }
          if (baseOpt.yAxis && !Array.isArray(baseOpt.yAxis)) {
            baseOpt.yAxis = Object.assign({ axisLabel: { color: muted }, splitLine: { lineStyle: { color: split } } }, baseOpt.yAxis);
          }
          inst.setOption(baseOpt);
          instances.push(inst);
        }
      }
      var btn = document.getElementById("themeToggle");
      if (btn) {
        btn.addEventListener("click", function () {
          root.setAttribute("data-theme", isDarkActive() ? "light" : "dark");
          renderCharts();
        });
      }
      if (mq && mq.addEventListener) {
        mq.addEventListener("change", renderCharts);
      }
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          for (var k = 0; k < instances.length; k++) {
            try { instances[k].resize(); } catch (_) {}
          }
        });
        ro.observe(document.body);
      }
      renderCharts();
    })();
  </script>
</body>
</html>`;
}

export type InfographicStat = {
  label: string;
  value: string;
  caption?: string;
};

export type InfographicSection = {
  heading: string;
  bullets: string[];
};

const PALETTES = {
  indigo: {
    bg: "#0f172a",
    card: "#1e293b",
    accent: "#818cf8",
    accentSoft: "#312e81",
    fg: "#f8fafc",
    muted: "#cbd5e1",
  },
  emerald: {
    bg: "#06221c",
    card: "#0d3b31",
    accent: "#34d399",
    accentSoft: "#065f46",
    fg: "#f0fdf4",
    muted: "#a7f3d0",
  },
  amber: {
    bg: "#1c1408",
    card: "#2e210d",
    accent: "#fbbf24",
    accentSoft: "#78350f",
    fg: "#fffbeb",
    muted: "#fde68a",
  },
  slate: {
    bg: "#f8fafc",
    card: "#ffffff",
    accent: "#2563eb",
    accentSoft: "#dbeafe",
    fg: "#0f172a",
    muted: "#475569",
  },
} as const;

export function buildInfographicSvgAndHtml(input: {
  title: string;
  subtitle?: string;
  stats: readonly InfographicStat[];
  sections: readonly InfographicSection[];
  footerNote?: string;
  palette?: keyof typeof PALETTES;
  heroImageBase64Png?: string | null;
}): { svg: string; html: string; width: number; height: number } {
  const pal = PALETTES[input.palette ?? "indigo"] ?? PALETTES.indigo;
  const width = 1200;
  const hasHero = Boolean(input.heroImageBase64Png);
  const statsRows = Math.ceil(Math.min(8, input.stats.length) / 2);
  const sectionsCount = Math.min(6, input.sections.length);
  const height = Math.max(
    1350,
    320 + (hasHero ? 320 : 0) + statsRows * 165 + sectionsCount * 210 + 110
  );

  let cursorY = 72;
  const titleSvg = `<text x="72" y="${cursorY + 44}" fill="${pal.fg}" font-size="46" font-weight="800" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif">${escapeHtml(input.title.slice(0, 68))}</text>`;
  cursorY += 68;
  const subtitleSvg = input.subtitle
    ? `<text x="72" y="${cursorY + 28}" fill="${pal.muted}" font-size="23" font-weight="500" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif">${escapeHtml(input.subtitle.slice(0, 110))}</text>`
    : "";
  if (input.subtitle) {
    cursorY += 52;
  }
  cursorY += 28;

  let heroSvg = "";
  if (input.heroImageBase64Png) {
    heroSvg = `<g>
      <clipPath id="heroClip"><rect x="72" y="${cursorY}" width="1056" height="280" rx="24" /></clipPath>
      <image href="data:image/png;base64,${input.heroImageBase64Png}" x="72" y="${cursorY}" width="1056" height="280" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)" />
    </g>`;
    cursorY += 312;
  }

  const statBlocks: string[] = [];
  const boundedStats = input.stats.slice(0, 8);
  for (let i = 0; i < boundedStats.length; i += 1) {
    const stat = boundedStats[i];
    if (!stat) {
      continue;
    }
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 72 + col * 540;
    const y = cursorY + row * 160;
    statBlocks.push(`<g>
      <rect x="${x}" y="${y}" width="516" height="140" rx="22" fill="${pal.card}" stroke="${pal.accentSoft}" stroke-width="2" />
      <text x="${x + 28}" y="${y + 44}" fill="${pal.muted}" font-size="19" font-weight="600" font-family="Inter, -apple-system, sans-serif">${escapeHtml(stat.label.slice(0, 44))}</text>
      <text x="${x + 28}" y="${y + 96}" fill="${pal.accent}" font-size="42" font-weight="800" font-family="Inter, -apple-system, sans-serif">${escapeHtml(stat.value.slice(0, 26))}</text>
      ${stat.caption ? `<text x="${x + 28}" y="${y + 124}" fill="${pal.muted}" font-size="16" font-family="Inter, -apple-system, sans-serif">${escapeHtml(stat.caption.slice(0, 56))}</text>` : ""}
    </g>`);
  }
  cursorY += statsRows * 160 + (statsRows > 0 ? 24 : 0);

  const sectionBlocks: string[] = [];
  for (const sec of input.sections.slice(0, 6)) {
    const bullets = sec.bullets.slice(0, 4);
    const boxH = 74 + bullets.length * 34;
    const bulletTexts = bullets
      .map(
        (b, idx) =>
          `<circle cx="104" cy="${cursorY + 72 + idx * 34}" r="5" fill="${pal.accent}" />
           <text x="122" y="${cursorY + 78 + idx * 34}" fill="${pal.fg}" font-size="20" font-family="Inter, -apple-system, sans-serif">${escapeHtml(b.slice(0, 88))}</text>`
      )
      .join("\n");
    sectionBlocks.push(`<g>
      <rect x="72" y="${cursorY}" width="1056" height="${boxH}" rx="22" fill="${pal.card}" />
      <text x="98" y="${cursorY + 42}" fill="${pal.accent}" font-size="24" font-weight="700" font-family="Inter, -apple-system, sans-serif">${escapeHtml(sec.heading.slice(0, 68))}</text>
      ${bulletTexts}
    </g>`);
    cursorY += boxH + 22;
  }

  const footerText = input.footerNote?.trim() || "";
  const footerSvg = footerText
    ? `<text x="72" y="${height - 36}" fill="${pal.muted}" font-size="17" font-family="Inter, -apple-system, sans-serif">${escapeHtml(footerText.slice(0, 125))}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${pal.bg}" />
  <rect x="72" y="48" width="96" height="8" rx="4" fill="${pal.accent}" />
  ${titleSvg}
  ${subtitleSvg}
  ${heroSvg}
  ${statBlocks.join("\n")}
  ${sectionBlocks.join("\n")}
  ${footerSvg}
</svg>`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: ${pal.bg}; }
    svg { display: block; width: ${width}px; height: ${height}px; }
  </style>
</head>
<body>${svg}</body>
</html>`;

  return { svg, html, width, height };
}

export function createVisualStudioTools(opts: {
  userId: string;
  fileStore?: PrivateFileStore;
  lifecycleStore?: CloudComputerLifecycleStore;
  ledger?: UsageLedger;
  relayUrl?: string;
  hmacSecret?: string;
  signingSecret?: string;
  fetchImpl?: typeof fetch;
  groundedNewsFetcher?: typeof fetchGroundedNewsBriefing;
}) {
  const fileStore = opts.fileStore ?? getDefaultPrivateFileStore();
  const lifecycle = resolveCloudLifecycleStore(opts.lifecycleStore);

  const buildHtmlPageOrDashboard = tool({
    description:
      "Build a single-file interactive HTML page or ECharts dashboard (readable in both dark and light modes), save it to /workspace on the Cloud Computer, and render a sandboxed preview in chat with Open full screen and Download (working on iPhone Safari).",
    inputSchema: z.object({
      filename: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe("Output HTML filename, e.g. 'sales_dashboard.html'."),
      title: z.string().trim().min(1).max(300),
      subtitle: z.string().trim().max(600).optional(),
      kpis: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(180),
            value: z.string().trim().min(1).max(120),
            delta: z.string().trim().max(120).optional(),
            tone: z.enum(["positive", "negative", "neutral"]).optional(),
          })
        )
        .max(16)
        .optional(),
      charts: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(240),
            subtitle: z.string().trim().max(320).optional(),
            heightPx: z.number().int().min(160).max(900).optional(),
            optionJson: z
              .string()
              .trim()
              .min(2)
              .max(64_000)
              .describe(
                'JSON-serialized Apache ECharts option object, e.g. \'{"xAxis":{"type":"category","data":["Q1","Q2"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[12,19]}]}\'.'
              ),
          })
        )
        .max(10)
        .optional(),
      bodyHtml: z
        .string()
        .max(80_000)
        .optional()
        .describe(
          "Optional semantic HTML body content (tables, cards, dated news links)."
        ),
      fullHtml: z
        .string()
        .max(120_000)
        .optional()
        .describe("Optional complete single-file HTML document override."),
    }),
    execute: async (input) => {
      const combinedText = JSON.stringify(input);
      if (containsRestrictedWorkData(combinedText)) {
        return {
          status: "blocked" as const,
          message:
            "Blocked: employer/Korn Ferry material cannot be rendered on the personal Cloud Computer.",
        };
      }

      const parsedCharts: DashboardChartInput[] = [];
      for (const chart of input.charts ?? []) {
        let parsedOption: unknown;
        const cleanedJson = chart.optionJson
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        try {
          parsedOption = JSON.parse(cleanedJson);
        } catch {
          return {
            status: "error" as const,
            code: "invalid_echarts_json" as const,
            message: `Invalid JSON in charts[].optionJson for "${chart.title}". Provide a valid JSON object string.`,
          };
        }
        if (
          !parsedOption ||
          typeof parsedOption !== "object" ||
          Array.isArray(parsedOption)
        ) {
          return {
            status: "error" as const,
            code: "invalid_echarts_json" as const,
            message: `charts[].optionJson for "${chart.title}" must serialize a JSON object.`,
          };
        }
        parsedCharts.push({
          title: chart.title,
          subtitle: chart.subtitle,
          heightPx: chart.heightPx,
          option: parsedOption as Record<string, unknown>,
        });
      }

      const requestedFilename = input.filename?.trim() || "dashboard.html";
      const rawBase = requestedFilename.toLowerCase().endsWith(".html")
        ? requestedFilename
        : `${requestedFilename}.html`;
      const safeName = sanitizeAttachmentFilename(rawBase);
      const html = composeSingleFileHtmlDashboard({
        title: input.title,
        subtitle: input.subtitle,
        kpis: input.kpis,
        charts: parsedCharts,
        bodyHtml: input.bodyHtml,
        fullHtml: input.fullHtml,
      });

      if (
        isNewsPageOrBriefingTarget({
          path: safeName,
          title: input.title,
          content: html,
        })
      ) {
        const newsCheck = validateGroundedNewsPageContent(html);
        if (!newsCheck.valid) {
          const briefing = await (
            opts.groundedNewsFetcher ?? fetchGroundedNewsBriefing
          )(input.title).catch(() => null);
          return {
            status: "error" as const,
            code: "ungrounded_news_rejected" as const,
            reason: newsCheck.reason,
            filename: safeName,
            message:
              "Rejected: news HTML pages must use real webSearch / Firecrawl results with publication dates and clickable https:// source links — never invented items.",
            ...(briefing?.ok
              ? {
                  fetchedAtIso: briefing.fetchedAtIso,
                  groundedSummary: briefing.summaryText,
                  groundedSources: briefing.sources,
                }
              : {}),
          };
        }
      }

      const workspacePath = resolveSafeWorkspacePath(`/workspace/${safeName}`);
      const hasCloudRelay = Boolean(
        (opts.relayUrl && opts.hmacSecret) || isCloudComputerConfigured()
      );
      if (hasCloudRelay) {
        await lifecycle
          .ensureAwakeForTask({ userId: opts.userId })
          .catch(() => null);
        await cloudWriteWorkspaceFile({
          path: workspacePath,
          contentBase64: Buffer.from(html, "utf8").toString("base64"),
          relayUrl: opts.relayUrl,
          hmacSecret: opts.hmacSecret,
          fetchImpl: opts.fetchImpl,
        }).catch(() => null);
        await lifecycle
          .recordActivity({ userId: opts.userId })
          .catch(() => null);
      }

      const bytes = new Uint8Array(Buffer.from(html, "utf8"));
      const encodedPath = encodeURIComponent(workspacePath);
      let downloadUrl = `/api/cloud-computer/files?path=${encodedPath}&disposition=attachment`;
      let previewUrl = `/api/cloud-computer/files?path=${encodedPath}&disposition=inline`;

      try {
        const stored = await fileStore.save({
          userId: opts.userId,
          safeName,
          contentType: "text/html",
          bytes,
        });
        const token = createSignedFileToken({
          uid: opts.userId,
          fid: stored.fileId,
          name: safeName,
          ct: "text/html",
          size: bytes.byteLength,
          ref: stored.storageRef,
          secret: opts.signingSecret,
        });
        const baseFileUrl = `/api/files/${encodeURIComponent(token)}`;
        downloadUrl = baseFileUrl;
        previewUrl = `${baseFileUrl}?disposition=inline`;
      } catch {
        /* falls back to owner-authenticated /api/cloud-computer/files */
      }

      return {
        status: "ok" as const,
        kind: "html_dashboard" as const,
        title: input.title,
        path: workspacePath,
        filename: safeName,
        mediaType: "text/html" as const,
        sizeBytes: bytes.byteLength,
        downloadUrl,
        previewUrl,
        autoOpenPreview: true,
        textPreview: html.slice(0, 48_000),
      };
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value:
        output.status === "ok"
          ? {
              status: "ok",
              kind: output.kind,
              title: output.title,
              filename: output.filename,
              path: output.path,
              sizeBytes: output.sizeBytes,
              note: "Interactive HTML dashboard preview card with Full Screen and Download buttons is already rendered in chat. Reply with a brief 1-2 sentence summary in the user's language without repeating the raw HTML.",
            }
          : output,
    }),
  });

  const generateInfographic = tool({
    description:
      "Generate a high-resolution Infographic from an HTML/SVG template rendered to PNG via headless Chromium on the Cloud Computer, shown in chat as an image card with Download. Optional AI hero illustrations use ONLY Vertex AI on the Google AI Ultra credit (zero pay-per-use APIs).",
    inputSchema: z.object({
      title: z.string().trim().min(1).max(300),
      subtitle: z.string().trim().max(400).optional(),
      palette: z.enum(["indigo", "emerald", "amber", "slate"]).optional(),
      stats: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(160),
            value: z.string().trim().min(1).max(100),
            caption: z.string().trim().max(200).optional(),
          })
        )
        .max(16)
        .optional(),
      sections: z
        .array(
          z.object({
            heading: z.string().trim().min(1).max(200),
            bullets: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
          })
        )
        .max(12)
        .optional(),
      footerNote: z.string().trim().max(320).optional(),
      heroIllustrationPrompt: z
        .string()
        .trim()
        .max(800)
        .optional()
        .describe(
          "Optional Vertex Imagen illustration prompt (runs ONLY on Vertex Ultra credit, never pay-per-use)."
        ),
    }),
    execute: async (input) => {
      if (containsRestrictedWorkData(JSON.stringify(input))) {
        return {
          status: "blocked" as const,
          message:
            "Blocked: employer/Korn Ferry material cannot be rendered in personal infographics.",
        };
      }

      let heroBase64Png: string | null = null;
      // Optional AI image STRICTLY via Vertex on Ultra credit (never pay-per-use API keys)
      if (input.heroIllustrationPrompt && vertexEnabled()) {
        const imgRes = await generateImageWithImagen({
          userId: opts.userId,
          prompt: input.heroIllustrationPrompt,
          aspectRatio: "16:9",
          ledger: opts.ledger,
          fileStore,
          signingSecret: opts.signingSecret,
          fetchImpl: opts.fetchImpl,
        }).catch(() => null);
        if (imgRes && imgRes.status === "ok") {
          heroBase64Png = imgRes.base64Png;
        }
      }

      const rendered = buildInfographicSvgAndHtml({
        title: input.title,
        subtitle: input.subtitle,
        stats: input.stats ?? [],
        sections: input.sections ?? [],
        footerNote: input.footerNote,
        palette: input.palette ?? "indigo",
        heroImageBase64Png: heroBase64Png,
      });

      const slug = sanitizeAttachmentFilename(
        input.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || "infographic"
      );
      const htmlPath = resolveSafeWorkspacePath(
        `/workspace/infographics/${slug}.html`
      );
      const pngPath = resolveSafeWorkspacePath(
        `/workspace/infographics/${slug}.png`
      );

      let finalBytes: Uint8Array | null = null;
      let contentType: "image/png" | "image/svg+xml" = "image/png";
      let filename = `${slug}.png`;
      let renderedVia: "cloud_chromium" | "svg_template" = "cloud_chromium";

      const hasCloudRelay = Boolean(
        (opts.relayUrl && opts.hmacSecret) || isCloudComputerConfigured()
      );
      if (hasCloudRelay) {
        try {
          await lifecycle
            .ensureAwakeForTask({ userId: opts.userId })
            .catch(() => null);
          await cloudWriteWorkspaceFile({
            path: htmlPath,
            contentBase64: Buffer.from(rendered.html, "utf8").toString(
              "base64"
            ),
            relayUrl: opts.relayUrl,
            hmacSecret: opts.hmacSecret,
            fetchImpl: opts.fetchImpl,
          });
          const shotCmd = `mkdir -p /workspace/infographics && (chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=${rendered.width},${rendered.height} --screenshot=${pngPath} file://${htmlPath} || chromium-browser --headless --no-sandbox --disable-gpu --hide-scrollbars --window-size=${rendered.width},${rendered.height} --screenshot=${pngPath} file://${htmlPath} || google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=${rendered.width},${rendered.height} --screenshot=${pngPath} file://${htmlPath})`;
          const execRes = await cloudRunExec({
            command: shotCmd,
            cwd: "/workspace",
            timeoutSec: 35,
            relayUrl: opts.relayUrl,
            hmacSecret: opts.hmacSecret,
            fetchImpl: opts.fetchImpl,
          });
          if (execRes.exitCode === 0) {
            const pngRead = await cloudReadWorkspaceFile({
              path: pngPath,
              relayUrl: opts.relayUrl,
              hmacSecret: opts.hmacSecret,
              fetchImpl: opts.fetchImpl,
            });
            if (pngRead.base64) {
              finalBytes = new Uint8Array(
                Buffer.from(pngRead.base64, "base64")
              );
            }
          }
          await lifecycle
            .recordActivity({ userId: opts.userId })
            .catch(() => null);
        } catch {
          /* fall back to crisp SVG image card if VM Chromium unavailable */
        }
      }

      if (!finalBytes || finalBytes.byteLength === 0) {
        finalBytes = new Uint8Array(Buffer.from(rendered.svg, "utf8"));
        contentType = "image/svg+xml";
        filename = `${slug}.svg`;
        renderedVia = "svg_template";
      }

      let imageUrl = `data:${contentType};base64,${Buffer.from(finalBytes).toString("base64")}`;
      let downloadUrl = imageUrl;

      try {
        const stored = await fileStore.save({
          userId: opts.userId,
          safeName: filename,
          contentType,
          bytes: finalBytes,
        });
        const token = createSignedFileToken({
          uid: opts.userId,
          fid: stored.fileId,
          name: filename,
          ct: contentType,
          size: finalBytes.byteLength,
          ref: stored.storageRef,
          secret: opts.signingSecret,
        });
        const baseFileUrl = `/api/files/${encodeURIComponent(token)}`;
        imageUrl = `${baseFileUrl}?disposition=inline`;
        downloadUrl = `${baseFileUrl}?disposition=attachment`;
      } catch {
        /* keeps inline data URI fallback in hermetic environments */
      }

      return {
        status: "ok" as const,
        kind: "infographic" as const,
        title: input.title,
        subtitle: input.subtitle ?? null,
        filename,
        mediaType: contentType,
        width: rendered.width,
        height: rendered.height,
        sizeBytes: finalBytes.byteLength,
        imageUrl,
        downloadUrl,
        renderedVia,
        usedVertexHeroImage: Boolean(heroBase64Png),
      };
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value:
        output.status === "ok"
          ? {
              status: "ok",
              kind: output.kind,
              title: output.title,
              filename: output.filename,
              mediaType: output.mediaType,
              width: output.width,
              height: output.height,
              renderedVia: output.renderedVia,
              note: "Infographic image card with Download button is already rendered in chat. Reply with a brief 1-2 sentence summary in the user's language.",
            }
          : output,
    }),
  });

  return {
    buildHtmlPageOrDashboard,
    generateInfographic,
  };
}
