import { z } from "zod/v4";

/** Positional props. Key order is the OpenUI Lang argument order. */
export const chartProps = z.object({
  title: z.string().max(120),
  kind: z.enum(["line", "bar", "pie"]),
  series: z.string().max(64),
});

export const tableProps = z.object({
  title: z.string().max(120),
  dataset: z.string().max(64),
});

export const statProps = z.object({
  label: z.string().max(80),
  dataset: z.string().max(64),
});

export const sliderProps = z.object({
  label: z.string().max(80),
  series: z.string().max(64),
});

export const tabsProps = z.object({
  labels: z.array(z.string().max(40)).min(1).max(4),
  datasets: z.array(z.string().max(64)).min(1).max(4),
});

export const mapProps = z.object({
  title: z.string().max(120),
  place: z.string().max(64),
});
