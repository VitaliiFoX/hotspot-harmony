// Pure helpers behind the charts: colour scale, axis ticks, number and month formatting.

import { monthOfYear, monthShort, numberLocale, t } from "./i18n";

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

const formats = new Map<string, Intl.NumberFormat>();

/** A number format of the page's language, made once per language and style. */
function format(style: "full" | "oneDecimal" | "compact"): Intl.NumberFormat {
  const key = `${numberLocale()} ${style}`;
  let made = formats.get(key);
  if (!made) {
    made = new Intl.NumberFormat(
      numberLocale(),
      style === "compact" ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: style === "full" ? 0 : 1 },
    );
    formats.set(key, made);
  }
  return made;
}

/** A value as people read it: 7.5, 1,284, 12.9K. */
export function formatValue(value: number): string {
  if (Math.abs(value) >= 10_000) return format("compact").format(value);
  if (Math.abs(value) < 100 && !Number.isInteger(value)) return format("oneDecimal").format(value);
  return format("full").format(value);
}

/** Axis labels: one style per axis, compact only when the axis reaches 10,000. */
export function formatTick(value: number, axisMax: number): string {
  return axisMax >= 10_000 ? format("compact").format(value) : format("full").format(value);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2012-02" -> "February 2012". */
export function monthLabel(yyyyMm: string): string {
  return monthOfYear(Number(yyyyMm.slice(5, 7)), yyyyMm.slice(0, 4));
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

/**
 * Where one month stands among the same calendar month of every year given: its place is 1 + the number of years
 * with a larger value, so years that tie share the better place (two equal busiest years are both 1st). `of` counts
 * the years of that calendar month, the month itself included. Null when the month is not among them.
 */
export function monthRank(
  months: readonly { year: number; month: number; value: number }[],
  year: number,
  month: number,
): { rank: number; of: number } | null {
  const same = months.filter((m) => m.month === month);
  const own = same.find((m) => m.year === year);
  if (!own) return null;
  return { rank: 1 + same.filter((m) => m.value > own.value).length, of: same.length };
}

/**
 * Lanes for the dots of a strip plot, so dots closer than `gap` on the axis do not cover each other: in order of
 * position each dot takes the first free lane of 0, 1, -1, 2, -2, ... where the last dot is at least `gap` behind.
 * Returns one lane per position, in the order given.
 */
export function stripLanes(positions: readonly number[], gap: number): number[] {
  const order = positions.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lastInLane = new Map<number, number>();
  const lanes = new Array<number>(positions.length);
  for (const [x, i] of order) {
    for (let step = 0; ; step++) {
      const lane = step % 2 === 1 ? (step + 1) / 2 : step === 0 ? 0 : -step / 2;
      const last = lastInLane.get(lane);
      if (last === undefined || x - last >= gap) {
        lastInLane.set(lane, x);
        lanes[i] = lane;
        break;
      }
    }
  }
  return lanes;
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
  if (inSet.size === 12) return t("all year");
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
    .map(([first, last]) => (first === last ? monthShort(first) : `${monthShort(first)}–${monthShort(last)}`));
  return names.length === 1 ? names[0] : t("{list} and {last}", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] });
}

export type RecordPartLike = { sensor: string; label: string; from: string; to: string | null };

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

function monthOf(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "2000-11", "2002-06" -> "Nov 2000 – Jun 2002": the dates of a part of the record on the timeline. */
export function monthRange(from: string, to: string): string {
  const short = (yyyyMm: string) => `${monthShort(Number(yyyyMm.slice(5, 7)))} ${yyyyMm.slice(0, 4)}`;
  return `${short(from)} – ${short(to)}`;
}

/**
 * The parts of the raw record the page knows: MODIS up to the month before `sensorSwitch`, VIIRS S-NPP from it on.
 * A part with no month in the record is left out.
 */
export function rawRecordParts(firstMonth: string, sensorSwitch: string, lastMonth: string): RecordPartLike[] {
  const first = monthIndex(firstMonth);
  const switchAt = monthIndex(sensorSwitch);
  const last = monthIndex(lastMonth);
  const parts: RecordPartLike[] = [];
  if (first < switchAt) parts.push({ sensor: "modis", label: "MODIS", from: firstMonth, to: monthOf(Math.min(last, switchAt - 1)) });
  if (switchAt <= last) parts.push({ sensor: "viirs_snpp", label: "VIIRS S-NPP", from: monthOf(Math.max(first, switchAt)), to: lastMonth });
  return parts;
}

export type TimelinePart = {
  sensor: string;
  label: string;
  from: string;
  /** Last month of the part: an open part runs to the last month of the record. */
  to: string;
  /** Months in the part, both ends included, and their share of all the parts' months. */
  months: number;
  share: number;
};

/** The parts of a record laid end to end, each as long as its months: the segments of the timeline over the calendar. */
export function recordTimeline(parts: readonly RecordPartLike[], lastMonth: string): TimelinePart[] {
  const sized = parts
    .map((part) => {
      const to = part.to ?? lastMonth;
      return { sensor: part.sensor, label: part.label, from: part.from, to, months: monthIndex(to) - monthIndex(part.from) + 1 };
    })
    .filter((part) => part.months > 0);
  const total = sized.reduce((sum, part) => sum + part.months, 0);
  return sized.map((part) => ({ ...part, share: part.months / total }));
}

