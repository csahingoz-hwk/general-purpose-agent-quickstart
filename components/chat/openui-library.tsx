"use client";

import {
  createLibrary,
  defineComponent,
  Renderer,
} from "@openuidev/react-lang";
import { createContext, useContext, useId, useState } from "react";
import { z } from "zod/v4";
import {
  chartProps,
  mapProps,
  sliderProps,
  statProps,
  tableProps,
  tabsProps,
} from "@/lib/openui/schemas";
import {
  filterSeries,
  type SeriesPoint,
  type VisualSnapshot,
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
  return (
    <figure className="space-y-2">
      <figcaption className="font-medium text-[15px]">{props.title}</figcaption>
      <ChartGraphic kind={props.kind} points={points} unit={series.unit} />
    </figure>
  );
}

function ChartGraphic({
  kind,
  points,
  unit,
}: {
  kind: "line" | "bar" | "pie";
  points: SeriesPoint[];
  unit?: string;
}) {
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No points in this range.</p>
    );
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  if (kind === "pie") {
    const total =
      values.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
    let cursor = 0;
    const stops = points.map((point, index) => {
      const start = cursor;
      cursor += (Math.max(point.value, 0) / total) * 100;
      const color = `color-mix(in srgb, var(--send) ${30 + index * 18}%, var(--foreground))`;
      return `${color} ${start}% ${cursor}%`;
    });
    return (
      <div className="flex items-center gap-3">
        <div
          className="size-24 rounded-full"
          style={{ background: `conic-gradient(${stops.join(",")})` }}
        />
        <ul className="text-sm">
          {points.map((point) => (
            <li key={point.label}>
              {point.label}: {point.value}
              {unit ? ` ${unit}` : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <svg
      aria-label={kind}
      className="h-28 w-full"
      role="img"
      viewBox="0 0 240 100"
    >
      <title>{kind}</title>
      {points.map((point, index) => {
        const x = 16 + index * (208 / Math.max(points.length - 1, 1));
        const y = 88 - ((point.value - min) / span) * 72;
        const barWidth = Math.max(12, 180 / points.length);
        return kind === "bar" ? (
          <rect
            fill="var(--send)"
            height={88 - y}
            key={point.label}
            rx="4"
            width={barWidth}
            x={12 + index * (216 / points.length)}
            y={y}
          />
        ) : (
          <circle cx={x} cy={y} fill="var(--send)" key={point.label} r="3.5" />
        );
      })}
      {kind === "line" && points.length > 1 && (
        <polyline
          fill="none"
          points={points
            .map((point, index) => {
              const x = 16 + index * (208 / (points.length - 1));
              const y = 88 - ((point.value - min) / span) * 72;
              return `${x},${y}`;
            })
            .join(" ")}
          stroke="var(--send)"
          strokeWidth="2"
        />
      )}
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
    <div className="space-y-1" data-testid="openui-fixture">
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
            className="grid grid-cols-[6.75rem_minmax(0,1fr)] gap-x-2 text-[13px] leading-tight"
            key={label}
          >
            <div className="text-muted-foreground">{label}</div>
            <div className="min-w-0 truncate" title={value}>
              <CellValue value={value} />
            </div>
          </div>
        );
      })}
    </div>
  );
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
  return (
    <div className="space-y-1.5">
      <h3 className="font-medium text-[15px] leading-tight">{props.title}</h3>
      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <table className="w-full table-fixed border-separate border-spacing-0 text-left text-[13px] leading-tight">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th
                  className="truncate border-b border-border px-1.5 py-1 font-medium"
                  key={column}
                  scope="col"
                  title={column}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join("|")}>
                {table.columns.map((column, index) => {
                  const cell = row[index] ?? "";
                  return (
                    <td
                      className="truncate border-b border-border px-1.5 py-1 align-middle"
                      key={`${column}-${cell}`}
                      title={cell}
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
  return (
    <div className="rounded-2xl bg-background px-3 py-2">
      <p className="text-[13px] text-muted-foreground">{props.label}</p>
      <p className="font-semibold text-[22px] leading-tight">{stat.value}</p>
      {stat.hint && (
        <p className="text-[13px] text-muted-foreground">{stat.hint}</p>
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
      <span>{props.label}</span>
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
      <div className="flex gap-2" role="tablist">
        {props.labels.map((label, tabIndex) => (
          <button
            aria-selected={tabIndex === index}
            className="min-h-11 rounded-full border border-[color:var(--hairline)] px-3 text-sm"
            key={label}
            onClick={() => setActive(tabIndex)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {table && (
        <TableView props={{ title: props.labels[index] ?? "", dataset: id }} />
      )}
      {series && (
        <ChartGraphic
          kind={series.kind}
          points={series.points}
          unit={series.unit}
        />
      )}
    </div>
  );
}

function MapGraphic({ props }: { props: { title: string; place: string } }) {
  const place = useSnapshot().places[props.place];
  if (!place) {
    return null;
  }
  const x = ((place.longitude + 180) / 360) * 240;
  const y = ((90 - place.latitude) / 180) * 120;
  return (
    <figure className="space-y-1">
      <figcaption className="font-medium text-[15px]">{props.title}</figcaption>
      <svg
        aria-label={place.label}
        className="h-32 w-full rounded-xl bg-background"
        role="img"
        viewBox="0 0 240 120"
      >
        <title>{place.label}</title>
        <circle cx={x} cy={y} fill="var(--send)" r="5" />
      </svg>
      <p className="text-[13px] text-muted-foreground">
        {place.label} · {place.latitude.toFixed(2)},{" "}
        {place.longitude.toFixed(2)}
      </p>
    </figure>
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
  description: "Static marker for a place id.",
  props: mapProps,
  component: MapGraphic,
});
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
      ])
    ),
  }),
  component: ({ props, renderNode }) => (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-[17px]">{props.title}</h2>
        <p className="text-[13px] text-muted-foreground">{props.summary}</p>
      </div>
      {props.children.map((child) => {
        const statementId =
          child && typeof child === "object" && "statementId" in child
            ? String(child.statementId)
            : props.title;
        return <div key={statementId}>{renderNode(child)}</div>;
      })}
    </div>
  ),
});

export const openUiViewLibrary = createLibrary({
  root: "Card",
  components: [Card, Chart, Table, Stat, Slider, Tabs, MapView],
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
