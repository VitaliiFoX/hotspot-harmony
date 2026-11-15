// The language of the page. English is the default and the key of every text; Ukrainian comes from uk.ts.

import { UK } from "./uk";

export type Lang = "en" | "uk";

export const LANGUAGES: readonly { lang: Lang; name: string }[] = [
  { lang: "en", name: "English" },
  { lang: "uk", name: UK["Ukrainian"] },
];

let current: Lang = "en";

/** The language the page renders in; set once before the first render, a switch reloads the page. */
export function language(): Lang {
  return current;
}

export function setLanguage(lang: Lang): void {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

/** The language a link asks for with `?lang=`; anything but "uk" is English. */
export function parseLang(text: string | null): Lang {
  return text === "uk" ? "uk" : "en";
}

function fill(template: string, values: Record<string, string | number>): string {
  const text = template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
  // A Ukrainian sentence that opens with a month or a unit opens with a capital letter; the words are lower case.
  return current === "uk" && template.startsWith("{") ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** A text in the page's language: the English text is the key, `{name}` in it takes `values[name]`. */
export function t(text: string, values: Record<string, string | number> = {}): string {
  return fill(current === "uk" ? (UK[text] ?? text) : text, values);
}

const ukPlural = new Intl.PluralRules("uk");

/**
 * A text that depends on a count: `one` and `other` in English. The Ukrainian entry of `other` holds three forms,
 * "one|few|many", picked by the count as Intl.PluralRules("uk") reads it: 1 and 21 take one, 2-4 few, 5-20 many.
 */
export function tn(count: number, one: string, other: string, values: Record<string, string | number> = {}): string {
  const all = { n: count, ...values };
  if (current !== "uk") return fill(count === 1 ? one : other, all);
  const forms = (UK[other] ?? other).split("|");
  const rule = ukPlural.select(count);
  const form = forms.length < 3 ? forms[0] : rule === "one" ? forms[0] : rule === "few" ? forms[1] : forms[2];
  return fill(form, all);
}

/** The locale numbers and dates are written in. */
export function numberLocale(): string {
  return current === "uk" ? "uk-UA" : "en-US";
}

/** A count with the separators of the page's language: 1,284 or 1 284. */
export function formatCount(value: number): string {
  return value.toLocaleString(numberLocale());
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A month 1-12 by name: "August", or the Ukrainian name in lower case, as inside a sentence. */
export function monthName(month: number): string {
  return t(MONTHS_EN[month - 1]);
}

/** A month 1-12 shortened for axes: "Aug". */
export function monthShort(month: number): string {
  const short = MONTHS_SHORT_EN[month - 1];
  return current === "uk" ? (UK[`${short}.short`] ?? short) : short;
}

/** A month 1-12 to begin a label with, capitalised in either language. */
export function monthTitle(month: number): string {
  const name = monthName(month);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A month of a year as it follows "before", "from" or "to": "February 2012"; in Ukrainian the month is in the genitive. */
export function monthOfYear(month: number, year: string | number): string {
  return current === "uk" ? `${t(`${MONTHS_EN[month - 1]}.of`)} ${year}` : `${MONTHS_EN[month - 1]} ${year}`;
}

/** A day "YYYY-MM-DD" in words: "20 August 2025"; in Ukrainian the month is in the genitive. */
export function dayInWords(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  const name = current === "uk" ? t(`${MONTHS_EN[month - 1]}.of`) : MONTHS_EN[month - 1];
  return `${day} ${name} ${date.slice(0, 4)}`;
}
