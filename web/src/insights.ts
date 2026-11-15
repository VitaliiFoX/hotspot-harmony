// What the page can say in words about the area on screen, from the numbers it has computed and nothing else.

import type { MonthValue, YearTotal } from "./api";
import { monthName, t, tn } from "./i18n";
import { formatValue, monthSpans } from "./scale";
import type { verdictKind } from "./trust";

/** A month that stands out from the same calendar month of the other years. */
export type Unusual = {
  year: number;
  month: number;
  value: number;
  median: number;
  /** Value over the median, two decimals; null when the median is zero. */
  ratio: number | null;
  /** Robust z: 0.6745 (value - median) / MAD of the other years. */
  z: number;
  direction: "above" | "below";
  sensor: string | null;
};

/** Robust z at or beyond which a month is unusual, as in robust outlier tests (Iglewicz and Hoaglin). */
export const UNUSUAL_Z = 3.5;
/** Fewer other years than this and a month's history is too short to call it unusual. */
const MIN_HISTORY = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

/**
 * The months of the period that stand out from the same calendar month of its other years: robust z at least
 * UNUSUAL_Z by median and MAD (by the interquartile range when the MAD is zero), and further from the median than the
 * error of the method that applies to the month (`errorFor(sensor)`, null for none). Largest departure from the median
 * first, in the record's unit: a quiet month with a tiny median can have a huge z and still matter little.
 */
export function unusualMonths(
  months: readonly MonthValue[],
  errorFor: (sensor: string | null) => number | null,
  limit = 8,
): Unusual[] {
  const byMonth = new Map<number, MonthValue[]>();
  for (const m of months) byMonth.set(m.month, [...(byMonth.get(m.month) ?? []), m]);
  const found: Unusual[] = [];
  for (const m of months) {
    const others = (byMonth.get(m.month) ?? []).filter((o) => o.year !== m.year).map((o) => o.value);
    if (others.length < MIN_HISTORY) continue;
    const mid = median(others);
    const mad = median(others.map((v) => Math.abs(v - mid)));
    const iqr = quantile(others, 0.75) - quantile(others, 0.25);
    const z = mad > 0 ? (0.6745 * (m.value - mid)) / mad : iqr > 0 ? (m.value - mid) / (iqr / 1.349) : null;
    if (z === null || Math.abs(z) < UNUSUAL_Z) continue;
    const ratio = mid > 0 ? Math.round((m.value / mid) * 100) / 100 : null;
    const error = errorFor(m.sensor);
    // 1e-9: 106 / 100 - 1 is 0.06000000000000005 in floating point, and +6% against a 6% error is within it.
    if (error !== null && ratio !== null && Math.abs(m.value / mid - 1) <= error + 1e-9) continue;
    found.push({
      year: m.year, month: m.month, value: m.value, median: mid, ratio, z: Math.round(z * 10) / 10,
      direction: z > 0 ? "above" : "below", sensor: m.sensor,
    });
  }
  return found
    .sort((a, b) => Math.abs(b.value - b.median) - Math.abs(a.value - a.median) || b.year - a.year)
    .slice(0, limit);
}

function years(span: readonly YearTotal[]): string {
  return span.length === 1 ? `${span[0].year}` : `${span[0].year}–${span[span.length - 1].year}`;
}

/**
 * A few sentences about the area, each from figures the page shows: its peak months, its busiest full year against
 * the median year, the change between the halves of its full years (within `yearError` it is said to be so), the
 * season's peak against its history, and how many months stand out. What cannot be said is left out.
 */
export function summaryLines(input: {
  peak: { months: number[]; held: number } | null;
  yearly: readonly YearTotal[];
  unit: string;
  headline: { year: number; month: number; ratio: number | null; kind: ReturnType<typeof verdictKind> } | null;
  unusual: readonly Unusual[];
  yearError: number | null;
}): string[] {
  const lines: string[] = [];
  const { peak, unit, headline, unusual, yearError } = input;
  if (peak && peak.months.length) {
    lines.push(
      tn(
        peak.months.length,
        "Burning peaks in {months}: this month holds {share}% of a typical year.",
        "Burning peaks in {months}: these {n} months hold {share}% of a typical year.",
        { months: monthSpans(peak.months), share: Math.round(peak.held * 100) },
      ),
    );
  }
  const full = input.yearly.filter((y) => y.complete);
  if (full.length) {
    const busiest = full.reduce((best, y) => (y.value > best.value ? y : best));
    const typical = median(full.map((y) => y.value));
    const values = { year: busiest.year, value: formatValue(busiest.value), unit };
    lines.push(
      typical > 0
        ? t("The busiest full year was {year}, with {value} {unit}, {ratio}× the median year.", {
            ...values, ratio: (busiest.value / typical).toFixed(2),
          })
        : t("The busiest full year was {year}, with {value} {unit}.", values),
    );
  }
  const half = Math.floor(full.length / 2);
  if (half >= 1) {
    const early = full.slice(0, half);
    const late = full.slice(full.length - half);
    const mean = (span: readonly YearTotal[]) => span.reduce((sum, y) => sum + y.value, 0) / span.length;
    if (mean(early) > 0) {
      const ratio = mean(late) / mean(early);
      const change = Math.round(Math.abs(ratio - 1) * 100);
      const within = yearError !== null && Math.abs(ratio - 1) <= yearError;
      const values = { late: years(late), early: years(early), change, error: Math.round((yearError ?? 0) * 100) };
      lines.push(
        change === 0
          ? t("Burning in {late} was about the same as in {early}.", values)
          : ratio >= 1
            ? within
              ? t("Burning in {late} was {change}% higher than in {early}, within the method's error of ±{error}%.", values)
              : t("Burning in {late} was {change}% higher than in {early}.", values)
            : within
              ? t("Burning in {late} was {change}% lower than in {early}, within the method's error of ±{error}%.", values)
              : t("Burning in {late} was {change}% lower than in {early}.", values),
      );
    }
  }
  if (headline) {
    const values = {
      month: monthName(headline.month), year: headline.year, ratio: headline.ratio === null ? "" : headline.ratio.toFixed(2),
    };
    lines.push(
      headline.kind === "none"
        ? t("{month} {year}, the busiest of the last 12 months, burned in a month that is usually quiet.", values)
        : headline.kind === "within"
          ? t("{month} {year}, the busiest of the last 12 months, is within the method's error of a typical {month} ({ratio}×).", values)
          : headline.kind === "same"
            ? t("{month} {year}, the busiest of the last 12 months, burned as much as a typical {month}.", values)
            : t("{month} {year}, the busiest of the last 12 months, burned {ratio}× a typical {month}.", values),
    );
  }
  if (unusual.length) {
    const top = unusual[0];
    const values = {
      first: `${monthName(top.month)} ${top.year}`,
      how: top.ratio === null ? t("in a month that usually has none") : t("{ratio}× its median", { ratio: top.ratio.toFixed(2) }),
    };
    lines.push(
      tn(
        unusual.length,
        "{n} month stands out from its own history: {first}, {how}.",
        "{n} months stand out from their own history; the largest departure was {first}, {how}.",
        values,
      ),
    );
  } else {
    lines.push(t("No month stands out from its own history by more than the method's error."));
  }
  return lines;
}
