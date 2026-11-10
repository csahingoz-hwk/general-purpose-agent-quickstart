import {
  createLibrary,
  createParser,
  defineComponent,
} from "@openuidev/lang-core";
import { z } from "zod/v4";
import {
  chartProps,
  mapProps,
  sliderProps,
  statProps,
  tableProps,
  tabsProps,
} from "./schemas";
import type { VisualSnapshot } from "./snapshot";

const blank = { kind: "schema-only" } as const;

const Chart = defineComponent({
  name: "Chart",
  description: "Chart whose numbers come from a series id.",
  props: chartProps,
  component: blank,
});
const Table = defineComponent({
  name: "Table",
  description: "Table whose rows come from a dataset id.",
  props: tableProps,
  component: blank,
});
const Stat = defineComponent({
  name: "Stat",
  description: "One figure from a stat id.",
  props: statProps,
  component: blank,
});
const Slider = defineComponent({
  name: "Slider",
  description: "Client-only minimum filter for a series id.",
  props: sliderProps,
  component: blank,
});
const Tabs = defineComponent({
  name: "Tabs",
  description: "Client-only switch between dataset ids.",
  props: tabsProps,
  component: blank,
});
const MapView = defineComponent({
  name: "Map",
  description: "Static place marker from a place id. No remote tiles.",
  props: mapProps,
  component: blank,
});
const Card = defineComponent({
  name: "Card",
  description: "Required root frame. Children are the six visual components.",
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
  component: blank,
});

export const openUiLibrary = createLibrary({
  root: "Card",
  components: [Card, Chart, Table, Stat, Slider, Tabs, MapView],
});

const parser = createParser(openUiLibrary.toJSONSchema(), openUiLibrary.root);

const forbidden =
  /HtmlView|iframe|<script|javascript:|Query\s*\(|Mutation\s*\(|@\w/i;

type ElementNode = {
  type?: string;
  typeName?: string;
  props?: Record<string, unknown>;
};

function walk(node: unknown, visit: (element: ElementNode) => void) {
  if (!node || typeof node !== "object") {
    return;
  }
  const element = node as ElementNode;
  if (element.type === "element") {
    visit(element);
  }
  const props = element.props ?? {};
  for (const value of Object.values(props)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        walk(child, visit);
      }
    }
  }
}

export function validateOpenUiSpec(
  spec: string,
  data: VisualSnapshot
): { ok: true } | { ok: false; reason: string } {
  if (!spec.trim() || spec.length > 4000) {
    return { ok: false, reason: "The visual spec was empty or too large." };
  }
  if (forbidden.test(spec) || /\d/.test(spec)) {
    return {
      ok: false,
      reason: "The visual spec used a forbidden construct or a raw number.",
    };
  }
  const parsed = parser.parse(spec) as {
    root?: unknown;
    meta?: { errors?: { message?: string }[] };
    queryStatements?: unknown[];
    mutationStatements?: unknown[];
  };
  const errors = parsed.meta?.errors ?? [];
  if (errors.length > 0) {
    return {
      ok: false,
      reason: errors[0]?.message || "The visual spec was invalid.",
    };
  }
  if ((parsed.queryStatements?.length ?? 0) > 0) {
    return { ok: false, reason: "Visual specs cannot fetch data." };
  }
  if ((parsed.mutationStatements?.length ?? 0) > 0) {
    return { ok: false, reason: "Visual specs cannot change data." };
  }
  let missing = "";
  walk(parsed.root, (element) => {
    const props = element.props ?? {};
    const series = typeof props.series === "string" ? props.series : "";
    const dataset = typeof props.dataset === "string" ? props.dataset : "";
    const place = typeof props.place === "string" ? props.place : "";
    if (
      (element.typeName === "Chart" || element.typeName === "Slider") &&
      series &&
      !data.series[series]
    ) {
      missing = series;
    }
    if (element.typeName === "Table" && dataset && !data.tables[dataset]) {
      missing = dataset;
    }
    if (element.typeName === "Stat" && dataset && !data.stats[dataset]) {
      missing = dataset;
    }
    if (element.typeName === "Map" && place && !data.places[place]) {
      missing = place;
    }
    if (element.typeName === "Tabs" && Array.isArray(props.datasets)) {
      for (const id of props.datasets) {
        if (typeof id === "string" && !data.tables[id] && !data.series[id]) {
          missing = id;
        }
      }
    }
  });
  if (missing) {
    return { ok: false, reason: `Unknown dataset "${missing}".` };
  }
  return { ok: true };
}
