// Pure helpers behind the charts: colour scale, axis ticks, number and month formatting.

/** One blue hue, light to dark: the sequential ramp for "how much burning". */
export const SEQUENTIAL = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
  "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
];
// "No burning" recedes towards the surface in both modes, further than the lowest step of the ramp.
export const ZERO_FILL = { light: "#f0efec", dark: "#2c2c2a" };

export type ScaleMode = "linear" | "log";

/**
 * Where a value sits on the colour scale, from 0 to 1.
 * Linear runs from zero to `max`. Log has no zero, so it runs from `min`, the smallest value above zero, to `max`.
 */
export function position(value: number, min: number, max: number, mode: ScaleMode): number {
  if (max <= 0 || value <= 0) return 0;
  if (mode === "linear") return Math.min(1, value / max);
  if (min <= 0 || max <= min) return 1;
  return Math.max(0, Math.min(1, Math.log(value / min) / Math.log(max / min)));
}

/**
 * Fill for a calendar cell. Exactly zero gets a neutral grey so "no burning" never
 * looks like "a little burning". On a dark surface the ramp runs the other way,
 * so that more is always further from the surface.
 */
export function cellColor(value: number, min: number, max: number, mode: ScaleMode, dark: boolean): string {
  if (value <= 0) return dark ? ZERO_FILL.dark : ZERO_FILL.light;
  const steps = dark ? [...SEQUENTIAL].reverse() : SEQUENTIAL;
  const index = Math.ceil(position(value, min, max, mode) * steps.length) - 1;
  return steps[Math.max(0, Math.min(steps.length - 1, index))];
}

/** Round axis ticks from zero up to at least `max`: steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** A value as people read it: 7.5, 1,284, 12.9K. */
export function formatValue(value: number): string {
  if (Math.abs(value) >= 10_000) return compact.format(value);
  if (Math.abs(value) < 100 && !Number.isInteger(value)) return oneDecimal.format(value);
  return full.format(value);
}

/** Axis labels: one style per axis, compact only when the axis reaches 10,000. */
export function formatTick(value: number, axisMax: number): string {
  return axisMax >= 10_000 ? compact.format(value) : full.format(value);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2012-02" -> "February 2012". */
export function monthLabel(yyyyMm: string): string {
  return `${MONTHS_LONG[Number(yyyyMm.slice(5, 7)) - 1]} ${yyyyMm.slice(0, 4)}`;
}

/** Last day of a month as YYYY-MM-DD, for date ranges that end with a month. */
export function lastDay(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yyyyMm}-${String(day).padStart(2, "0")}`;
}

/** Path of a column with a rounded top and a square foot on the baseline. */
export function columnPath(x: number, baseline: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, height, width / 2));
  const top = baseline - height;
  return [
    `M${x},${baseline}`,
    `L${x},${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `L${x + width - r},${top}`,
    `Q${x + width},${top} ${x + width},${top + r}`,
    `L${x + width},${baseline}`,
    "Z",
  ].join(" ");
}

/** The value a second record has in each column's year, or null where it has none: a line drawn over columns. */
export function valuesByYear(
  columns: readonly { year: number }[],
  line: readonly { year: number; value: number }[],
): (number | null)[] {
  const byYear = new Map(line.map((item) => [item.year, item.value]));
  return columns.map((column) => byYear.get(column.year) ?? null);
}

/** SVG path through the points in order; a null starts a new piece, so a gap is never bridged. */
export function brokenLinePath(points: readonly ([x: number, y: number] | null)[]): string {
  const parts: string[] = [];
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    parts.push(`${drawing ? "L" : "M"}${point[0]},${point[1]}`);
    drawing = true;
  }
  return parts.join(" ");
}

/** The share of a typical year that the peak burning months hold together. */
export const PEAK_SHARE = 0.6;

type MonthMedian = { month: number; median: number };

/**
 * Peak burning months: the fewest calendar months that together hold `share` of a typical year, where a typical
 * year is the sum of the twelve monthly medians over the record. Largest medians first, a tie to the earlier
 * month; the result lists the months in calendar order, with the share they hold and the typical year's total.
 */
export function peakMonths(
  climatology: readonly MonthMedian[],
  share = PEAK_SHARE,
): { months: number[]; held: number; total: number } {
  const total = climatology.reduce((sum, c) => sum + c.median, 0);
  if (total <= 0) return { months: [], held: 0, total: 0 };
  const ranked = [...climatology].filter((c) => c.median > 0).sort((a, b) => b.median - a.median || a.month - b.month);
  const months: number[] = [];
  let held = 0;
  for (const c of ranked) {
    if (held >= share * total) break;
    months.push(c.month);
    held += c.median;
  }
  return { months: months.sort((a, b) => a - b), held: Math.round((held / total) * 1e6) / 1e6, total };
}

/** Months (1-12) as spans read aloud: [3, 4, 8] is "Mar–Apr and Aug"; a span can run across the new year. */
export function monthSpans(months: readonly number[]): string {
  const inSet = new Set(months);
  if (inSet.size === 0) return "";
  if (inSet.size === 12) return "all year";
  // Start scanning right after a month that is not in the set, so no span is cut at December.
  let start = 1;
  while (inSet.has(start)) start += 1;
  const spans: [number, number][] = [];
  for (let step = 1; step <= 12; step++) {
    const month = ((start - 1 + step) % 12) + 1;
    if (!inSet.has(month)) continue;
    const last = spans[spans.length - 1];
    const previous = ((month + 10) % 12) + 1;
    if (last && last[1] === previous) last[1] = month;
    else spans.push([month, month]);
  }
  const names = spans
    .sort((a, b) => a[0] - b[0])
    .map(([first, last]) => (first === last ? MONTHS[first - 1] : `${MONTHS[first - 1]}–${MONTHS[last - 1]}`));
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type RecordPartLike = { sensor: string; label: string; from: string; to: string | null };

function monthIndex(yyyyMm: string): number {
  return Number(yyyyMm.slice(0, 4)) * 12 + Number(yyyyMm.slice(5, 7)) - 1;
}

/**
 * Where each part of the harmonized record lies on a yearly axis whose columns run from `firstYear` to `lastYear`:
 * `start` and `end` in columns from the first, to the month. Parts are cut to the axis; parts off it are dropped.
 */
export function recordSpans(
  parts: readonly RecordPartLike[],
  firstYear: number,
  lastYear: number,
): { sensor: string; label: string; start: number; end: number }[] {
  const origin = firstYear * 12;
  const limit = (lastYear + 1) * 12;
  return parts
    .map((part) => {
      const from = Math.max(origin, monthIndex(part.from));
      const to = Math.min(limit, part.to ? monthIndex(part.to) + 1 : limit);
      return { sensor: part.sensor, label: part.label, start: (from - origin) / 12, end: (to - origin) / 12 };
    })
    .filter((span) => span.end > span.start);
}

/** The labels of the record parts that a calendar year draws on, in order. */
export function partsOfYear(parts: readonly RecordPartLike[], year: number): string[] {
  return parts
    .filter((part) => monthIndex(part.from) <= year * 12 + 11 && (part.to === null || monthIndex(part.to) >= year * 12))
    .map((part) => part.label);
}
