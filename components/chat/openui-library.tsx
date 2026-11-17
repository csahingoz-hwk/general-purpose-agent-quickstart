"use client";

import {
  createLibrary,
  defineComponent,
  Renderer,
} from "@openuidev/react-lang";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import { z } from "zod/v4";
import {
  chartProps,
  comparisonProps,
  mapProps,
  sliderProps,
  statProps,
  tableProps,
  tabsProps,
  timelineProps,
} from "@/lib/openui/schemas";
import {
  filterSeries,
  type SeriesPoint,
  type VisualSnapshot,
  type WeatherIconKind,
} from "@/lib/openui/snapshot";

const DataContext = createContext<VisualSnapshot | null>(null);
const FilterContext = createContext<{
  minimum: Record<string, number>;
  setMinimum: (series: string, value: number) => void;
} | null>(null);

function useSnapshot(): VisualSnapshot {
  return (
    useContext(DataContext) ?? {
      series: {},
      tables: {},
      stats: {},
      places: {},
    }
  );
}

function formatMetricValue(value: number, unit?: string): string {
  const rounded = Number.isInteger(value)
    ? String(value)
    : value.toFixed(Math.abs(value) >= 100 ? 0 : 1).replace(/\.0$/, "");
  if (!unit) {
    return rounded;
  }
  if (unit.startsWith("°") || unit === "%") {
    return `${rounded}${unit}`;
  }
  return `${rounded} ${unit}`;
}

function formatPointCallout(value: number, unit?: string): string {
  const rounded = Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, "");
  if (unit?.startsWith("°")) {
    return `${rounded}°`;
  }
  if (unit === "%") {
    return `${rounded}%`;
  }
  return rounded;
}

function formatShortAxisLabel(label: string, maxLen = 10): string {
  const trimmed = label.trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && words[0] && words[1]) {
    const initialForm = `${words[0][0]}. ${words.at(-1)}`;
    if (initialForm.length <= maxLen + 1) {
      return initialForm;
    }
  }
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function WeatherGlyph({ kind }: { kind: WeatherIconKind }) {
  switch (kind) {
    case "sun":
      return (
        <svg
          aria-hidden="true"
          className="size-10 shrink-0 text-amber-500"
          fill="none"
          viewBox="0 0 36 36"
        >
          <circle cx="18" cy="18" fill="currentColor" opacity="0.2" r="11" />
          <circle cx="18" cy="18" fill="currentColor" r="7" />
          <path
            d="M18 3v3M18 30v3M3 18h3M30 18h3M7.4 7.4l2.1 2.1M26.5 26.5l2.1 2.1M28.6 7.4l-2.1 2.1M9.5 26.5l-2.1 2.1"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </svg>
      );
    case "partly-cloudy":
      return (
        <svg
          aria-hidden="true"
          className="size-10 shrink-0"
          fill="none"
          viewBox="0 0 36 36"
        >
          <circle
            className="text-amber-500"
            cx="14"
            cy="13"
            fill="currentColor"
            r="6"
          />
          <path
            className="text-amber-500"
            d="M14 4v2M5 13h2M7.6 6.6l1.5 1.5M20.4 6.6l-1.5 1.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            className="text-sky-500 dark:text-sky-400"
            d="M13 27h13.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 14.3 16.5 5 5 0 0 0 13 27Z"
            fill="currentColor"
          />
        </svg>
      );
    case "rain":
    case "drizzle":
      return (
        <svg
          aria-hidden="true"
          className="size-10 shrink-0 text-sky-500 dark:text-sky-400"
          fill="none"
          viewBox="0 0 36 36"
        >
          <path
            d="M10.5 23h15a4.5 4.5 0 0 0 .6-8.96A6.8 6.8 0 0 0 12.8 12.2 5.2 5.2 0 0 0 10.5 23Z"
            fill="currentColor"
            opacity="0.88"
          />
          <path
            d="M13 26.5l-1.5 4M18.5 26.5l-1.5 4M24 26.5l-1.5 4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </svg>
      );
    case "snow":
      return (
        <svg
          aria-hidden="true"
          className="size-10 shrink-0 text-sky-400"
          fill="none"
          viewBox="0 0 36 36"
        >
          <path
            d="M10.5 23h15a4.5 4.5 0 0 0 .6-8.96A6.8 6.8 0 0 0 12.8 12.2 5.2 5.2 0 0 0 10.5 23Z"
            fill="currentColor"
            opacity="0.85"
          />
          <circle cx="13" cy="28.5" fill="currentColor" r="1.6" />
          <circle cx="18.5" cy="30" fill="currentColor" r="1.6" />
          <circle cx="24" cy="28.5" fill="currentColor" r="1.6" />
        </svg>
      );
    case "storm":
      return (
        <svg
          aria-hidden="true"
          className="size-10 shrink-0 text-indigo-500 dark:text-indigo-400"
          fill="none"
          viewBox="0 0 36 36"
        >
          <path
            d="M10.5 22h15a4.5 4.5 0 0 0 .6-8.96A6.8 6.8 0 0 0 12.8 11.2 5.2 5.2 0 0 0 10.5 22Z"
            fill="currentColor"
            opacity="0.88"
          />
          <path
            className="text-amber-400"
            d="M19 21l-3 5.5h3.5L17 32"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.3"
          />
        </svg>
      );
    default:
      return (
        <svg
          aria-hidden="true"
          className="size-10 shrink-0 text-slate-400 dark:text-slate-300"
          fill="none"
          viewBox="0 0 36 36"
        >
          <path
            d="M10.5 25h15.5a5 5 0 0 0 .6-9.96A7 7 0 0 0 13 13.2 5.5 5.5 0 0 0 10.5 25Z"
            fill="currentColor"
          />
        </svg>
      );
  }
}

function ChartView({
  props,
}: {
  props: { title: string; kind: "line" | "bar" | "pie"; series: string };
}) {
  const data = useSnapshot();
  const filters = useContext(FilterContext);
  const series = data.series[props.series];
  if (!series) {
    return null;
  }
  const minimum = filters?.minimum[props.series];
  const points =
    minimum === undefined
      ? series.points
      : filterSeries(series.points, minimum);
  const secondaryPoints =
    minimum === undefined ? series.secondaryPoints : undefined;

  return (
    <figure className="space-y-2 rounded-2xl bg-background/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-medium text-[14px] leading-tight">
          {props.title}
          {series.unit && !props.title.includes(series.unit) ? (
            <span className="ml-1 font-normal text-muted-foreground text-xs">
              ({series.unit})
            </span>
          ) : null}
        </figcaption>
        {secondaryPoints && secondaryPoints.length === points.length && (
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block size-2 rounded-full bg-[var(--send)]"
              />
              High
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block size-2 rounded-full bg-muted-foreground/60"
              />
              {series.secondaryTitle ?? "Low"}
            </span>
          </div>
        )}
      </div>
      <ChartGraphic
        kind={props.kind}
        points={points}
        secondaryPoints={secondaryPoints}
        unit={series.unit}
      />
    </figure>
  );
}

function ChartGraphic({
  kind,
  points,
  secondaryPoints,
  unit,
}: {
  kind: "line" | "bar" | "pie";
  points: SeriesPoint[];
  secondaryPoints?: SeriesPoint[];
  unit?: string;
}) {
  const chartGradientId = useId();
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No points in this range.</p>
    );
  }
  const hasSecondary =
    kind === "line" &&
    Array.isArray(secondaryPoints) &&
    secondaryPoints.length === points.length;
  const allValues = [
    ...points.map((point) => point.value),
    ...(hasSecondary ? secondaryPoints.map((point) => point.value) : []),
  ];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;

  if (kind === "pie") {
    const total =
      points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
    let cursor = 0;
    const stops = points.map((point, index) => {
      const start = cursor;
      cursor += (Math.max(point.value, 0) / total) * 100;
      const color = `color-mix(in srgb, var(--send) ${35 + ((index * 22) % 60)}%, var(--foreground))`;
      return `${color} ${start}% ${cursor}%`;
    });
    return (
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="relative size-24 shrink-0 rounded-full"
          style={{ background: `conic-gradient(${stops.join(",")})` }}
        >
          <div className="absolute inset-4 rounded-full bg-card" />
        </div>
        <ul className="min-w-0 flex-1 space-y-1 text-[13px] tabular-nums">
          {points.map((point, index) => {
            const pct = Math.round((Math.max(point.value, 0) / total) * 100);
            const swatch = `color-mix(in srgb, var(--send) ${35 + ((index * 22) % 60)}%, var(--foreground))`;
            return (
              <li
                className="flex items-center justify-between gap-2"
                key={point.label}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: swatch }}
                  />
                  <span className="truncate">{point.label}</span>
                </span>
                <span className="shrink-0 font-medium">
                  {formatMetricValue(point.value, unit)} ({pct}%)
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const showEveryLabel = points.length <= 6;
  const labelStride = showEveryLabel ? 1 : Math.ceil(points.length / 5);
  const leftPad = showEveryLabel ? 18 : 38;
  const rightPad = 18;
  const topPad = 24;
  const bottomPad = 126;
  const innerTop = topPad + 8;
  const innerBottom = bottomPad - 16;
  const plotWidth = 320 - leftPad - rightPad;
  const plotHeight = innerBottom - innerTop;

  const xFor = (index: number) =>
    points.length === 1
      ? leftPad + plotWidth / 2
      : leftPad + (index * plotWidth) / (points.length - 1);
  const yFor = (val: number) => innerBottom - ((val - min) / span) * plotHeight;

  const highCoords = points.map((p, i) => ({
    x: xFor(i),
    y: yFor(p.value),
    label: p.label,
    value: p.value,
  }));
  const lowCoords = hasSecondary
    ? secondaryPoints.map((p, i) => ({
        x: xFor(i),
        y: yFor(p.value),
        label: p.label,
        value: p.value,
      }))
    : [];

  const areaPolygon =
    kind === "line" && highCoords.length > 1
      ? hasSecondary
        ? [
            ...highCoords.map((c) => `${c.x},${c.y}`),
            ...[...lowCoords].reverse().map((c) => `${c.x},${c.y}`),
          ].join(" ")
        : [
            ...highCoords.map((c) => `${c.x},${c.y}`),
            `${highCoords.at(-1)?.x ?? leftPad},${bottomPad}`,
            `${highCoords[0]?.x ?? leftPad},${bottomPad}`,
          ].join(" ")
      : "";

  return (
    <svg
      aria-label={`${kind} chart`}
      className="h-40 w-full select-none overflow-visible"
      data-testid="openui-chart-svg"
      role="img"
      viewBox="0 0 320 152"
    >
      <title>{kind}</title>
      <defs>
        <linearGradient id={chartGradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--send)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--send)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Y-axis horizontal reference lines & min/max labels */}
      <line
        stroke="currentColor"
        strokeDasharray="3 3"
        strokeOpacity="0.14"
        x1={leftPad}
        x2={320 - rightPad}
        y1={topPad}
        y2={topPad}
      />
      <line
        stroke="currentColor"
        strokeDasharray="3 3"
        strokeOpacity="0.1"
        x1={leftPad}
        x2={320 - rightPad}
        y1={(topPad + bottomPad) / 2}
        y2={(topPad + bottomPad) / 2}
      />
      <line
        stroke="currentColor"
        strokeOpacity="0.18"
        x1={leftPad}
        x2={320 - rightPad}
        y1={bottomPad}
        y2={bottomPad}
      />
      {!showEveryLabel && (
        <>
          <text
            className="fill-muted-foreground text-[10px] tabular-nums"
            dominantBaseline="middle"
            textAnchor="end"
            x={leftPad - 6}
            y={innerTop}
          >
            {formatPointCallout(max, unit)}
          </text>
          <text
            className="fill-muted-foreground text-[10px] tabular-nums"
            dominantBaseline="middle"
            textAnchor="end"
            x={leftPad - 6}
            y={innerBottom}
          >
            {formatPointCallout(min, unit)}
          </text>
        </>
      )}

      {kind === "line" && areaPolygon && (
        <polygon fill={`url(#${chartGradientId})`} points={areaPolygon} />
      )}

      {kind === "line" && highCoords.length > 1 && (
        <polyline
          fill="none"
          points={highCoords.map((c) => `${c.x},${c.y}`).join(" ")}
          stroke="var(--send)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
      )}

      {hasSecondary && lowCoords.length > 1 && (
        <polyline
          fill="none"
          points={lowCoords.map((c) => `${c.x},${c.y}`).join(" ")}
          stroke="currentColor"
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.45"
          strokeWidth="1.8"
        />
      )}

      {kind === "bar" &&
        points.map((point, index) => {
          const slotWidth = plotWidth / points.length;
          const barWidth = Math.min(28, Math.max(12, slotWidth * 0.62));
          const barX = leftPad + index * slotWidth + (slotWidth - barWidth) / 2;
          const barY = yFor(point.value);
          const barH = Math.max(4, bottomPad - barY);
          const showLabel =
            index % labelStride === 0 || index === points.length - 1;
          return (
            <g key={point.label}>
              <rect
                fill="var(--send)"
                height={barH}
                rx="5"
                width={barWidth}
                x={barX}
                y={barY}
              />
              {showLabel && (
                <>
                  <text
                    className="fill-foreground font-medium text-[10px] tabular-nums"
                    textAnchor="middle"
                    x={barX + barWidth / 2}
                    y={barY - 5}
                  >
                    {formatPointCallout(point.value, unit)}
                  </text>
                  <text
                    className="fill-muted-foreground text-[10px]"
                    textAnchor="middle"
                    x={barX + barWidth / 2}
                    y={bottomPad + 16}
                  >
                    {formatShortAxisLabel(point.label)}
                  </text>
                </>
              )}
            </g>
          );
        })}

      {kind === "line" &&
        highCoords.map((coord, index) => {
          const showLabel =
            index % labelStride === 0 || index === highCoords.length - 1;
          const low = lowCoords[index];
          return (
            <g key={coord.label}>
              <circle
                cx={coord.x}
                cy={coord.y}
                fill="var(--send)"
                r="3.8"
                stroke="var(--card)"
                strokeWidth="1.5"
              />
              {showLabel && (
                <text
                  className="fill-foreground font-semibold text-[10.5px] tabular-nums"
                  textAnchor="middle"
                  x={coord.x}
                  y={coord.y - 7}
                >
                  {formatPointCallout(coord.value, unit)}
                </text>
              )}
              {low && (
                <>
                  <circle
                    cx={low.x}
                    cy={low.y}
                    fill="currentColor"
                    fillOpacity="0.55"
                    r="3"
                  />
                  {showLabel && (
                    <text
                      className="fill-muted-foreground font-medium text-[10px] tabular-nums"
                      textAnchor="middle"
                      x={low.x}
                      y={low.y + 13}
                    >
                      {formatPointCallout(low.value, unit)}
                    </text>
                  )}
                </>
              )}
              {showLabel && (
                <text
                  className="fill-muted-foreground font-medium text-[10.5px]"
                  textAnchor="middle"
                  x={coord.x}
                  y={bottomPad + 17}
                >
                  {coord.label.slice(0, 9)}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}

function domainOf(value: string): string | null {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function CellValue({ value }: { value: string }) {
  const domain = domainOf(value);
  if (!domain) {
    return value;
  }
  return (
    <a
      className="text-[var(--bot-link)] underline"
      href={value}
      rel="noopener noreferrer"
      target="_blank"
    >
      {domain}
    </a>
  );
}

function FixtureList({ rows }: { rows: string[][] }) {
  const filled = rows.filter((row) => row[1]?.trim());
  if (filled.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1.5" data-testid="openui-fixture">
      {filled.map((row) => {
        const label = row[0] ?? "";
        const value = row[1] ?? "";
        if (label === "Match") {
          return (
            <p className="font-semibold text-[15px] leading-snug" key={label}>
              {value}
            </p>
          );
        }
        return (
          <div
            className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-x-2 text-[13px] leading-snug"
            key={label}
          >
            <div className="text-muted-foreground">{label}</div>
            <div className="min-w-0 break-words">
              <CellValue value={value} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isNumericCell(value: string): boolean {
  return /^[-+]?\d+(?:[.,]\d+)?\s*(?:°[CF]?|%|km\/h)?$/.test(value.trim());
}

function TableView({ props }: { props: { title: string; dataset: string } }) {
  const table = useSnapshot().tables[props.dataset];
  if (!table || props.dataset === "sources") {
    return null;
  }
  if (props.dataset === "fixtures") {
    return <FixtureList rows={table.rows} />;
  }
  const rows = table.rows.filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) {
    return null;
  }
  const numericColumns = table.columns.map((_, colIndex) =>
    rows.every(
      (row) =>
        !row[colIndex]?.trim() ||
        row[colIndex] === "—" ||
        isNumericCell(row[colIndex] ?? "")
    )
  );

  return (
    <div className="space-y-1.5">
      <h3 className="font-medium text-[14px] leading-tight">{props.title}</h3>
      <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border/60 bg-background/60">
        <table className="w-full border-separate border-spacing-0 text-left text-[13px] leading-snug tabular-nums">
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th
                  className={`whitespace-nowrap border-b border-border/70 px-2.5 py-1.5 font-medium text-muted-foreground text-xs ${
                    index > 0 && numericColumns[index] ? "text-right" : ""
                  }`}
                  key={column}
                  scope="col"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.join("|")}>
                {table.columns.map((column, index) => {
                  const cell = row[index] ?? "";
                  const isLastRow = rowIndex === rows.length - 1;
                  return (
                    <td
                      className={`${
                        isLastRow ? "" : "border-b border-border/50"
                      } px-2.5 py-1.5 align-middle ${
                        index === 0
                          ? "whitespace-nowrap font-medium text-foreground"
                          : numericColumns[index]
                            ? "whitespace-nowrap text-right text-foreground"
                            : "break-words"
                      }`}
                      key={`${column}-${cell}`}
                    >
                      <CellValue value={cell} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatView({ props }: { props: { label: string; dataset: string } }) {
  const stat = useSnapshot().stats[props.dataset];
  if (!stat) {
    return null;
  }
  if (stat.icon || stat.description) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-2xl bg-background/90 px-3.5 py-3"
        data-testid="openui-weather-hero"
      >
        <div className="flex items-center gap-3">
          {stat.icon && <WeatherGlyph kind={stat.icon} />}
          <div>
            <p className="font-semibold text-[28px] leading-none tracking-tight tabular-nums">
              {stat.value}
            </p>
            {stat.description && (
              <p className="mt-1 font-medium text-[14px] leading-tight">
                {stat.description}
              </p>
            )}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <p className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
            {props.label}
          </p>
          {stat.subtext ? (
            <p className="mt-0.5 text-[12.5px] text-muted-foreground leading-snug tabular-nums">
              {stat.subtext}
            </p>
          ) : (
            stat.hint && (
              <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                {stat.hint}
              </p>
            )
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-background/90 px-3.5 py-2.5">
      <div>
        <p className="text-[12.5px] text-muted-foreground">{props.label}</p>
        <p className="font-semibold text-[22px] leading-tight tabular-nums">
          {stat.value}
        </p>
      </div>
      {stat.hint && (
        <p className="text-right text-[12.5px] text-muted-foreground">
          {stat.hint}
        </p>
      )}
    </div>
  );
}

function SliderView({ props }: { props: { label: string; series: string } }) {
  const series = useSnapshot().series[props.series];
  const filters = useContext(FilterContext);
  const fieldId = useId();
  if (!series || !filters) {
    return null;
  }
  const values = series.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const current = filters.minimum[props.series] ?? min;
  return (
    <label className="block space-y-1 text-sm" htmlFor={fieldId}>
      <span className="flex items-center justify-between gap-2">
        <span>{props.label}</span>
        <span className="font-medium text-muted-foreground text-xs tabular-nums">
          {formatMetricValue(current, series.unit)}
        </span>
      </span>
      <input
        className="w-full accent-[var(--send)]"
        data-testid="openui-slider"
        id={fieldId}
        max={max}
        min={min}
        onChange={(event) => {
          filters.setMinimum(props.series, Number(event.target.value));
        }}
        step="any"
        type="range"
        value={current}
      />
    </label>
  );
}

function TabsView({
  props,
}: {
  props: { labels: string[]; datasets: string[] };
}) {
  const [active, setActive] = useState(0);
  const data = useSnapshot();
  const index = Math.min(active, props.labels.length - 1);
  const id = props.datasets[index] ?? "";
  const table = data.tables[id];
  const series = data.series[id];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="tablist">
        {props.labels.map((label, tabIndex) => {
          const isSelected = tabIndex === index;
          return (
            <button
              aria-selected={isSelected}
              className={`min-h-11 rounded-full border px-3.5 font-medium text-sm transition-colors ${
                isSelected
                  ? "border-transparent bg-[var(--send)] text-white"
                  : "border-[color:var(--hairline)] bg-background text-foreground"
              }`}
              key={label}
              onClick={() => setActive(tabIndex)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
      {table && (
        <TableView props={{ title: props.labels[index] ?? "", dataset: id }} />
      )}
      {series && (
        <ChartGraphic
          kind={series.kind}
          points={series.points}
          secondaryPoints={series.secondaryPoints}
          unit={series.unit}
        />
      )}
    </div>
  );
}

function formatLatLon(latitude: number, longitude: number): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)}°${ns}, ${Math.abs(longitude).toFixed(2)}°${ew}`;
}

function MapGraphic({ props }: { props: { title: string; place: string } }) {
  const place = useSnapshot().places[props.place];
  const [tileFailed, setTileFailed] = useState(false);

  const zoom = 12;
  const n = 2 ** zoom;
  const clampedLat = place ? Math.max(-85, Math.min(85, place.latitude)) : 0;
  const latRad = (clampedLat * Math.PI) / 180;
  const xFloat = place ? ((place.longitude + 180) / 360) * n : 0;
  const yFloat = place
    ? ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n
    : 0;

  const centerTileX = Math.floor(xFloat);
  const centerTileY = Math.floor(yFloat);
  const fracX = xFloat - centerTileX;
  const fracY = yFloat - centerTileY;

  useEffect(() => {
    if (!place) {
      return;
    }
    setTileFailed(false);
    const tx = ((centerTileX % n) + n) % n;
    const probe = new window.Image();
    probe.onerror = () => setTileFailed(true);
    probe.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${centerTileY}/${tx}`;
    return () => {
      probe.onerror = null;
    };
  }, [place, centerTileX, centerTileY, n]);

  if (!place || tileFailed) {
    return null;
  }

  const tileSize = 256;
  const cols = [-1, 0, 1] as const;
  const rows = fracY < 0.5 ? ([-1, 0] as const) : ([0, 1] as const);
  const anchorRow = fracY < 0.5 ? 1 : 0;

  return (
    <figure className="space-y-1.5" data-testid="openui-map">
      <div className="flex items-baseline justify-between gap-2">
        <figcaption className="font-medium text-[14px] leading-tight">
          {props.title}
        </figcaption>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatLatLon(place.latitude, place.longitude)}
        </span>
      </div>
      <div
        aria-label={`Map of ${place.label}`}
        className="relative h-36 w-full overflow-hidden rounded-xl border border-border/70 bg-muted/40"
        role="img"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            width: `${tileSize * 3}px`,
            height: `${tileSize * 2}px`,
            left: `calc(50% - ${(1 + fracX) * tileSize}px)`,
            top: `calc(50% - ${(anchorRow + fracY) * tileSize}px)`,
          }}
        >
          {rows.map((dy, rIdx) =>
            cols.map((dx, cIdx) => {
              const tx = (((centerTileX + dx) % n) + n) % n;
              const ty = centerTileY + dy;
              if (ty < 0 || ty >= n) {
                return null;
              }
              // Note ArcGIS tile URL order is /tile/{z}/{y}/{x}
              const src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${ty}/${tx}`;
              return (
                // biome-ignore lint/performance/noImgElement: 3x2 slippy map raster tiles positioned via CSS grid offsets
                <img
                  alt=""
                  className="absolute max-w-none select-none"
                  decoding="async"
                  draggable={false}
                  height={tileSize}
                  key={`${tx}-${ty}`}
                  src={src}
                  style={{
                    left: `${cIdx * tileSize}px`,
                    top: `${rIdx * tileSize}px`,
                    width: `${tileSize}px`,
                    height: `${tileSize}px`,
                  }}
                  width={tileSize}
                />
              );
            })
          )}
        </div>
        {/* Exact coordinate pin */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <span className="block size-7 rounded-full bg-[var(--send)]/25 p-1.5">
            <span className="block size-full rounded-full border-2 border-white bg-[var(--send)] shadow-md" />
          </span>
        </div>
        <span className="pointer-events-none absolute right-1.5 bottom-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur-xs">
          © Esri · OpenStreetMap
        </span>
      </div>
    </figure>
  );
}

function ComparisonView({
  props,
}: {
  props: { title: string; dataset: string };
}) {
  const comp = useSnapshot().comparisons?.[props.dataset];
  if (!comp || comp.rows.length === 0 || comp.options.length < 2) {
    return null;
  }
  const gridColsClass =
    comp.options.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className="space-y-2.5" data-testid="openui-comparison">
      <div className={`grid ${gridColsClass} gap-2`}>
        {comp.options.map((opt) => (
          <div
            className="min-w-0 rounded-xl border border-border/70 bg-background/90 px-2.5 py-2 text-center"
            key={opt}
          >
            <span className="block truncate font-semibold text-[13px] text-foreground">
              {opt}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {comp.rows.map((row) => (
          <div
            className="rounded-xl border border-border/60 bg-background/60 p-2.5"
            key={row.feature}
          >
            <p className="mb-1.5 font-medium text-[11.5px] text-muted-foreground uppercase tracking-wide">
              {row.feature}
            </p>
            <div className={`grid ${gridColsClass} gap-2`}>
              {comp.options.map((opt, idx) => {
                const val = row.values[idx] ?? "—";
                const isWinner = row.winnerIndex === idx;
                return (
                  <div
                    className={`min-w-0 rounded-lg px-2 py-1.5 text-[13px] leading-snug ${
                      isWinner
                        ? "border border-[var(--send)]/45 bg-[var(--send)]/10 font-medium text-foreground"
                        : "bg-muted/35 text-foreground"
                    }`}
                    key={`${row.feature}-${opt}`}
                  >
                    <span className="block break-words">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {comp.verdict && (
        <div className="rounded-xl border border-[var(--send)]/30 bg-[var(--send)]/8 px-3 py-2 text-[13px] text-foreground leading-snug">
          <span className="font-semibold">Takeaway: </span>
          {comp.verdict}
        </div>
      )}
    </div>
  );
}

function TimelineView({
  props,
}: {
  props: { title: string; dataset: string };
}) {
  const tl = useSnapshot().timelines?.[props.dataset];
  if (!tl || tl.events.length === 0) {
    return null;
  }

  return (
    <ol
      className="relative ml-2 space-y-3 border-[var(--send)]/35 border-l-2 pl-4"
      data-testid="openui-timeline"
    >
      {tl.events.map((ev) => (
        <li className="relative min-w-0" key={`${ev.when}-${ev.title}`}>
          <span
            aria-hidden="true"
            className="absolute top-1.5 -left-[1.3125rem] block size-2.5 rounded-full border-2 border-card bg-[var(--send)]"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-[var(--send)]/12 px-2 py-0.5 font-semibold text-[11.5px] text-foreground tabular-nums">
              {ev.when}
            </span>
            {ev.badge && (
              <span className="inline-flex items-center rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                {ev.badge}
              </span>
            )}
          </div>
          <p className="mt-1 break-words font-semibold text-[14px] text-foreground leading-snug">
            {ev.title}
          </p>
          {ev.detail && (
            <p className="mt-0.5 break-words text-[13px] text-muted-foreground leading-snug">
              {ev.detail}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

const Chart = defineComponent({
  name: "Chart",
  description: "Line, bar, or pie chart for a series id.",
  props: chartProps,
  component: ChartView,
});
const Table = defineComponent({
  name: "Table",
  description: "Rows for a table id.",
  props: tableProps,
  component: TableView,
});
const Stat = defineComponent({
  name: "Stat",
  description: "One labeled figure for a stat id.",
  props: statProps,
  component: StatView,
});
const Slider = defineComponent({
  name: "Slider",
  description: "Local minimum filter for a series id.",
  props: sliderProps,
  component: SliderView,
});
const Tabs = defineComponent({
  name: "Tabs",
  description: "Local switch between dataset ids.",
  props: tabsProps,
  component: TabsView,
});
const MapView = defineComponent({
  name: "Map",
  description: "Map for a place id.",
  props: mapProps,
  component: MapGraphic,
});
const Comparison = defineComponent({
  name: "Comparison",
  description: "Side-by-side comparison for a comparison id.",
  props: comparisonProps,
  component: ComparisonView,
});
const Timeline = defineComponent({
  name: "Timeline",
  description: "Chronological rail for a timeline id.",
  props: timelineProps,
  component: TimelineView,
});

function CardRootView({
  props,
  renderNode,
}: {
  props: { title: string; summary: string; children: unknown[] };
  renderNode: (node: unknown) => ReactNode;
}) {
  const header = useSnapshot().header;
  const displayTitle = header?.title || props.title;
  const displaySummary = header?.summary || props.summary;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-[17px] leading-tight">
          {displayTitle}
        </h2>
        <p className="text-[13px] text-muted-foreground">{displaySummary}</p>
      </div>
      {props.children.map((child) => {
        const statementId =
          child && typeof child === "object" && "statementId" in child
            ? String(child.statementId)
            : displayTitle;
        return <div key={statementId}>{renderNode(child)}</div>;
      })}
    </div>
  );
}

const Card = defineComponent({
  name: "Card",
  description: "Root frame.",
  props: z.object({
    title: z.string(),
    summary: z.string(),
    children: z.array(
      z.union([
        Chart.ref,
        Table.ref,
        Stat.ref,
        Slider.ref,
        Tabs.ref,
        MapView.ref,
        Comparison.ref,
        Timeline.ref,
      ])
    ),
  }),
  component: CardRootView,
});

export const openUiViewLibrary = createLibrary({
  root: "Card",
  components: [
    Card,
    Chart,
    Table,
    Stat,
    Slider,
    Tabs,
    MapView,
    Comparison,
    Timeline,
  ],
});

export function OpenUiRenderer({
  spec,
  data,
}: {
  spec: string;
  data: VisualSnapshot;
}) {
  const [minimum, setMinimumState] = useState<Record<string, number>>({});
  return (
    <DataContext.Provider value={data}>
      <FilterContext.Provider
        value={{
          minimum,
          setMinimum: (series, value) => {
            setMinimumState((current) => ({ ...current, [series]: value }));
          },
        }}
      >
        <Renderer
          isStreaming={false}
          library={openUiViewLibrary}
          publishObservability={false}
          response={spec}
          toolProvider={null}
        />
      </FilterContext.Provider>
    </DataContext.Provider>
  );
}
