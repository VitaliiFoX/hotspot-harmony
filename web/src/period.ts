// What the globe shows: one day, one calendar month, or a period from one day to another. Pure, so it is tested.

import { dayInWords, monthTitle, tn } from "./i18n";

export type View = "day" | "month" | "period";
/** First and last UTC day, "YYYY-MM-DD", both included. */
export type Span = { start: string; end: string };

/** The longest period the API serves at once (api/store.py MAX_PERIOD_DAYS). */
export const MAX_PERIOD_DAYS = 366;
/** A period opened from a day ends on that day and starts a week before it. */
export const DEFAULT_PERIOD_DAYS = 7;

export function parseView(text: string | null): View {
  return text === "month" || text === "period" ? text : "day";
}

function utc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/** A day moved by a number of days. */
export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from `start` to `end`, both included: 1 for one day. */
export function spanDays({ start, end }: Span): number {
  return Math.round((utc(end) - utc(start)) / 86_400_000) + 1;
}

/** The calendar month a day falls in, cut to the record. */
export function monthSpan(date: string, first: string, last: string): Span {
  const month = date.slice(0, 7);
  const end = addDays(`${nextMonth(month)}-01`, -1);
  return { start: maxDay(`${month}-01`, first), end: minDay(end, last) };
}

function nextMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

/** A period in order, cut to the record and to MAX_PERIOD_DAYS from its start. */
export function makeSpan(a: string, b: string, first: string, last: string): Span {
  const start = maxDay(minDay(a, b), first);
  const end = minDay(minDay(maxDay(a, b), last), addDays(start, MAX_PERIOD_DAYS - 1));
  return { start, end: maxDay(end, start) };
}

/** The period a day opens into: the week up to it, cut to the record. */
export function periodAround(date: string, first: string, last: string): Span {
  return makeSpan(addDays(date, -(DEFAULT_PERIOD_DAYS - 1)), date, first, last);
}

/** Whether a day lies inside a span. */
export function inSpan(date: string, span: Span | null): boolean {
  return span !== null && date >= span.start && date <= span.end;
}

/**
 * A span in words, sharing what both ends share: "3–17 June 2025", "28 May – 4 June 2025",
 * "28 December 2024 – 4 January 2025", or one day as "10 June 2025".
 */
export function spanLabel({ start, end }: Span): string {
  if (start === end) return dayInWords(start);
  const [first, last] = [dayInWords(start), dayInWords(end)];
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${first} – ${last}`;
  const startWords = first.split(" ");
  if (start.slice(0, 7) !== end.slice(0, 7)) return `${startWords[0]} ${startWords[1]} – ${last}`;
  return `${Number(start.slice(8, 10))}–${last}`;
}

/** A calendar month as its heading: "June 2025". */
export function monthLabel(date: string): string {
  return `${monthTitle(Number(date.slice(5, 7)))} ${date.slice(0, 4)}`;
}

/** A day of the period as the slider reads it: "10 June", or "10 June 2025" when the period spans years. */
export function cursorLabel(span: Span, index: number): string {
  const date = addDays(span.start, index);
  const words = dayInWords(date);
  return span.start.slice(0, 4) === span.end.slice(0, 4) ? words.split(" ").slice(0, 2).join(" ") : words;
}

/** What the heading under the date says for a month or a period. */
export function spanNote(view: View, span: Span): string {
  const days = spanDays(span);
  return view === "month"
    ? tn(days, "Hotspots of the whole month, {n} day", "Hotspots of the whole month, {n} days")
    : tn(days, "Hotspots from the first day through the last, {n} day", "Hotspots from the first day through the last, {n} days");
}
