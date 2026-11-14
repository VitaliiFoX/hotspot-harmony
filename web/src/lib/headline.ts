import type { Anomaly, ClimatologyMonth, MonthValue, TopMonth } from '../api/types';
import { formatCount, formatRatio, formatRatioBare } from './format';
import { monthName } from './ym';

export interface HeadlineInput {
  anomaly: Anomaly | null;
  climatology: readonly ClimatologyMonth[];
  months: readonly MonthValue[];
  topMonths?: readonly TopMonth[];
  /** Short unit label, e.g. "fire cell-days". */
  unit?: string;
}

export interface Headline {
  /** The main sentence(s), shown large. */
  text: string;
  /** A calmer second line, e.g. about a quiet latest month. Null when not needed. */
  note: string | null;
}

/** A latest month with no hotspots is "normal" when the usual level is below this. */
const QUIET_MEDIAN = 1;

/** A month counts as unusual from this ratio to the usual level upwards. */
const UNUSUAL_RATIO = 1.5;

/** True for a latest month with no hotspots in a season that usually has (almost) none. */
export function isQuietMonth(anomaly: Pick<Anomaly, 'value' | 'median'>): boolean {
  return anomaly.value === 0 && anomaly.median < QUIET_MEDIAN;
}

/**
 * The API's "top months" that really stand out: some hotspots, and either no
 * usual level to compare with or clearly above it. With a single year of data
 * every month equals its own median, and nothing qualifies.
 */
export function unusualMonths(topMonths: readonly TopMonth[]): TopMonth[] {
  return topMonths.filter(
    (t) => t.value > 0 && (t.ratio === null || !(t.median > 0) || t.ratio >= UNUSUAL_RATIO),
  );
}

/** "Decembers", "Marches". */
export function pluralMonth(month: number): string {
  const name = monthName(month);
  return name.endsWith('ch') ? `${name}es` : `${name}s`;
}

/** Calendar month with the highest median, or null when every median is zero. */
export function peakMonth(climatology: readonly ClimatologyMonth[]): number | null {
  let best: ClimatologyMonth | null = null;
  for (const c of climatology) {
    if (c.median > 0 && (best === null || c.median > best.median)) best = c;
  }
  return best ? best.month : null;
}

function peakSentence(climatology: readonly ClimatologyMonth[]): string {
  const peak = peakMonth(climatology);
  return peak === null ? '' : ` The usual peak month is ${monthName(peak)}.`;
}

function firstYear(months: readonly MonthValue[]): number | null {
  let min: number | null = null;
  for (const m of months) if (min === null || m.year < min) min = m.year;
  return min;
}

function percentilePhrase(anomaly: Anomaly, sinceYear: number | null): string {
  const p = Math.round(anomaly.percentile);
  if (!Number.isFinite(p)) return '';
  const since = sinceYear === null ? '' : ` since ${sinceYear}`;
  const plural = pluralMonth(anomaly.month);
  if (p >= 50) return `higher than ${Math.min(p, 100)}% of ${plural}${since}`;
  return `lower than ${Math.min(100 - p, 100)}% of ${plural}${since}`;
}

function ratioRangePhrase(anomaly: Anomaly): string {
  if (anomaly.lo === anomaly.hi || !(anomaly.median > 0)) return '';
  const lo = formatRatioBare(anomaly.lo / anomaly.median);
  const hi = formatRatio(anomaly.hi / anomaly.median);
  return ` (90% range ${lo}-${hi})`;
}

function topMonthSentence(top: TopMonth, unit: string): string {
  const when = `${monthName(top.month)} ${top.year}`;
  const value = `${formatCount(top.value)} ${unit}`;
  if (top.ratio === null || !(top.median > 0)) {
    return `The most unusual month here was ${when}: ${value}, in a month that usually has none.`;
  }
  return `The most unusual month here was ${when}: ${value}, ${formatRatio(top.ratio)} the usual ${monthName(top.month)} level.`;
}

/**
 * Plain-language summary of the result. The latest month leads, unless it is
 * a quiet month in a quiet season (no hotspots, and fewer than one is usual): then the most unusual
 * month of the range leads and the latest month becomes a short note.
 */
export function buildHeadline(input: HeadlineInput): Headline {
  const { anomaly, climatology, months } = input;
  const unit = input.unit ?? 'fire cell-days';
  const top = unusualMonths(input.topMonths ?? [])[0] ?? null;
  const peak = peakSentence(climatology);

  const anyHotspots = months.some((m) => m.n_harmonized > 0 || m.n_raw > 0);
  if (months.length > 0 && !anyHotspots) {
    return {
      text: 'No hotspots were recorded in this area in the selected period.',
      note: null,
    };
  }

  if (!anomaly) {
    if (top) return { text: `${topMonthSentence(top, unit)}${peak}`, note: null };
    const trimmed = peak.trim();
    return {
      text: trimmed || 'There is no recent month to compare with the usual level here.',
      note: trimmed ? 'There is no recent month to compare with the usual level here.' : null,
    };
  }

  const month = monthName(anomaly.month);
  const when = `${month} ${anomaly.year}`;
  const since = firstYear(months);

  // Quiet latest month in a quiet season: say so calmly and lead with the top month.
  if (isQuietMonth(anomaly)) {
    const calm = `${when}: no hotspots, which is normal for ${month} here.`;
    if (top) return { text: `${topMonthSentence(top, unit)}${peak}`, note: calm };
    return { text: `${calm}${peak}`, note: null };
  }

  const rank = percentilePhrase(anomaly, since);

  if (anomaly.value === 0) {
    return {
      text: `${when} here: no hotspots, where ${formatCount(anomaly.median)} ${unit} are usual for ${month}.${peak}`,
      note: null,
    };
  }

  if (anomaly.ratio === null || !(anomaly.median > 0)) {
    const tail = rank ? `; ${rank}` : '';
    return {
      text: `${when} here: ${formatCount(anomaly.value)} ${unit} in a month that usually has none${tail}.${peak}`,
      note: null,
    };
  }

  const tail = rank ? `, ${rank}` : '';
  return {
    text: `${when} here: ${formatRatio(anomaly.ratio)} the usual level${ratioRangePhrase(anomaly)}${tail}.${peak}`,
    note: null,
  };
}
