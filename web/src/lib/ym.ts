/** Year-month helpers. Months are 1-based everywhere (1 = January). */

export interface YM {
  year: number;
  month: number;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? `Month ${month}`;
}

export function monthShort(month: number): string {
  return MONTH_SHORT[month - 1] ?? `M${month}`;
}

/** Parse "YYYY-MM". Returns null for anything else. */
export function parseYM(text: string | null | undefined): YM | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatYM(ym: YM): string {
  return `${String(ym.year).padStart(4, '0')}-${String(ym.month).padStart(2, '0')}`;
}

/** Number of months since year 0; handy for comparisons and arithmetic. */
export function ymIndex(ym: YM): number {
  return ym.year * 12 + (ym.month - 1);
}

export function fromIndex(index: number): YM {
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

export function addMonths(ym: YM, delta: number): YM {
  return fromIndex(ymIndex(ym) + delta);
}

export function compareYM(a: YM, b: YM): number {
  return ymIndex(a) - ymIndex(b);
}

/** "August 2024" */
export function labelYM(ym: YM): string {
  return `${monthName(ym.month)} ${ym.year}`;
}

/** "Aug 2024" */
export function shortLabelYM(ym: YM): string {
  return `${monthShort(ym.month)} ${ym.year}`;
}

export function daysInMonth(ym: YM): number {
  return new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
}

/** First day of the month as "YYYY-MM-DD". */
export function firstDay(ym: YM): string {
  return `${formatYM(ym)}-01`;
}

/** Last day of the month as "YYYY-MM-DD". */
export function lastDay(ym: YM): string {
  return `${formatYM(ym)}-${String(daysInMonth(ym)).padStart(2, '0')}`;
}

/**
 * Default CSV export window: the last 12 months of the series,
 * e.g. series end 2025-12 gives 2025-01-01 .. 2025-12-31.
 */
export function lastTwelveMonths(seriesEnd: YM): { start: string; end: string } {
  return { start: firstDay(addMonths(seriesEnd, -11)), end: lastDay(seriesEnd) };
}
