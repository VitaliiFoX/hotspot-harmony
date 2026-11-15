import { afterEach, describe, expect, it } from "vitest";
import { dayInWords, formatCount, monthOfYear, monthShort, monthTitle, parseLang, setLanguage, t, tn } from "./i18n";
import { UK } from "./uk";

// The page's source as text, through Vite: every file that can ask for a text, the tests and uk.ts aside.
const SOURCES = import.meta.glob<string>(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./uk.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;

/** Every key the page asks for in its source: the text of each `t("...")` and the plural text of each `tn(...)`. */
function sourceKeys(): string[] {
  const keys = new Set<string>();
  for (const text of Object.values(SOURCES)) {
    for (const match of text.matchAll(new RegExp(String.raw`\bt\(\s*${STRING}`, "g"))) keys.add(JSON.parse(`"${match[1]}"`));
    for (const match of text.matchAll(new RegExp(String.raw`\btn\(\s*[^"]*?,\s*${STRING},\s*${STRING}`, "gs"))) {
      keys.add(JSON.parse(`"${match[2]}"`));
    }
  }
  return [...keys];
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
}

afterEach(() => setLanguage("en"));

describe("the Ukrainian texts", () => {
  it("cover every text the page asks for", () => {
    const keys = sourceKeys();
    expect(keys.length).toBeGreaterThan(200);
    expect(keys.filter((key) => !(key in UK))).toEqual([]);
  });
  it("cover what the API and the pipeline write: units, record parts, sensors, check scales", () => {
    const server = [
      "hotspots", "fire cell-days", "MODIS-equivalent fire cell-days",
      "MODIS Terra only, scaled", "MODIS Terra + Aqua (reference)", "VIIRS NOAA-20, harmonized", "MODIS Terra, scaled",
      "Country, per year", "Country, per month", "1° tile, per year", "1° tile, per month",
      "This method, on years it did not see", "Baseline: one scaling factor, fitted on all years",
      "Baseline: VIIRS as delivered, no correction", "Ukraine", "Argentina",
    ];
    expect(server.filter((key) => !(key in UK))).toEqual([]);
  });
  it("fill in only values the English text has", () => {
    const extra = Object.entries(UK).filter(([key, value]) =>
      value.split("|").some((form) => placeholders(form).some((name) => !placeholders(key).includes(name))),
    );
    expect(extra).toEqual([]);
  });
  it("give three plural forms wherever they give more than one", () => {
    expect(Object.entries(UK).filter(([, value]) => value.includes("|") && value.split("|").length !== 3)).toEqual([]);
  });
});

describe("the page language", () => {
  it("is English unless a link asks for Ukrainian", () => {
    expect(parseLang(null)).toBe("en");
    expect(parseLang("de")).toBe("en");
    expect(parseLang("uk")).toBe("uk");
  });
  it("leaves English texts as they are and fills in values", () => {
    expect(t("Year")).toBe("Year");
    expect(t("{n} of {years}", { n: 3, years: 25 })).toBe("3 of 25");
    expect(tn(1, "{n} month", "{n} months")).toBe("1 month");
    expect(tn(4, "{n} month", "{n} months")).toBe("4 months");
    expect(monthOfYear(2, 2012)).toBe("February 2012");
    expect(dayInWords("2025-08-20")).toBe("20 August 2025");
    expect(formatCount(1284)).toBe("1,284");
  });
  it("speaks Ukrainian when set, with the plural form the count asks for", () => {
    setLanguage("uk");
    expect(t("Year")).toBe(UK["Year"]);
    const [one, few, many] = UK["{unit}, over {n} years"].split("|");
    const form = (template: string, n: number) => template.replace("{unit}", "x").replace("{n}", String(n));
    const years = (n: number) => tn(n, "{unit}, over {n} year", "{unit}, over {n} years", { unit: "x" });
    expect(years(1)).toBe(form(one, 1).replace(/^x/, "X"));
    expect(years(3)).toBe(form(few, 3).replace(/^x/, "X"));
    expect(years(11)).toBe(form(many, 11).replace(/^x/, "X"));
    expect(years(21)).toBe(form(one, 21).replace(/^x/, "X"));
  });
  it("writes Ukrainian months lower case inside a sentence, in the genitive after a day or a preposition", () => {
    setLanguage("uk");
    expect(monthTitle(8)).toBe(UK["August"].charAt(0).toUpperCase() + UK["August"].slice(1));
    expect(monthShort(8)).toBe(UK["Aug.short"]);
    expect(monthOfYear(2, 2012)).toBe(`${UK["February.of"]} 2012`);
    expect(dayInWords("2025-08-20")).toBe(`20 ${UK["August.of"]} 2025`);
  });
  it("opens a Ukrainian sentence that starts with a value with a capital letter", () => {
    setLanguage("uk");
    const text = t("{month} {year} burned more than a typical {month}", { month: "x", year: 2025 });
    expect(text.startsWith("X 2025")).toBe(true);
  });
});
