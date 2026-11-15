import { describe, expect, it } from "vitest";
import type { MonthValue, YearTotal } from "./api";
import { summaryLines, unusualMonths } from "./insights";

/** Ten years, 2001-2010, of one calendar month; every other month of the year is zero. */
function july(values: number[], sensor = "modis"): MonthValue[] {
  return values.map((value, i) => ({ year: 2001 + i, month: 7, value, sensor }));
}

describe("unusualMonths", () => {
  it("flags a month far from its own history by the robust z of its median and MAD", () => {
    // 2009 = 60 against the other Julys 10, 12, 11, 9, 10, 13, 10, 11, 10: median 10, MAD 1, z = 0.6745 * 50 = 33.7.
    // 2006 = 13 against its others: median 10, MAD 1, z = 2.0, not unusual.
    const found = unusualMonths(july([10, 12, 11, 9, 10, 13, 10, 11, 60, 10]), () => 0.06);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ year: 2009, month: 7, value: 60, median: 10, ratio: 6, direction: "above" });
    expect(found[0].z).toBeCloseTo(33.7, 1);
  });
  it("flags an unusually quiet month too", () => {
    // 2010 = 5 against 50, 52, 48, 51, 49, 50, 53, 47, 50: median 50, MAD 1, z = -30.4.
    const found = unusualMonths(july([50, 52, 48, 51, 49, 50, 53, 47, 50, 5]), () => null);
    expect(found.map((m) => [m.year, m.direction])).toEqual([[2010, "below"]]);
  });
  it("leaves out a month inside the method's error, however steady its history", () => {
    // 2010 = 106 against 100, 101, 99, 100, 102, 98, 100, 101, 99: median 100, MAD 1, z = 4.0, but only +6%.
    const steady = [100, 101, 99, 100, 102, 98, 100, 101, 99, 106];
    expect(unusualMonths(july(steady, "viirs_noaa20"), () => 0.06)).toEqual([]);
    expect(unusualMonths(july(steady), () => null).map((m) => m.year)).toEqual([2010]); // MODIS: no error
  });
  it("cannot measure a month whose history has no spread, nor one with fewer than five other years", () => {
    expect(unusualMonths(july([0, 0, 0, 0, 0, 0, 0, 0, 5, 0]), () => null)).toEqual([]);
    expect(unusualMonths(july([10, 10, 11, 60]), () => null)).toEqual([]);
  });
});

const yearly = (values: number[], first = 2001): YearTotal[] =>
  values.map((value, i) => ({ year: first + i, value, complete: true }));

describe("summaryLines", () => {
  const base = {
    peak: { months: [7, 8], held: 0.65 },
    yearly: yearly([100, 120, 80, 100, 140, 60, 70, 80, 50, 60]),
    unit: "fire cell-days",
    unusual: [{ year: 2009, month: 7, value: 60, median: 10, ratio: 6, z: 33.7, direction: "above" as const, sensor: "modis" }],
    yearError: 0.1,
  };
  it("puts the figure first: the season, the busiest year, the change and what stands out, each with its card", () => {
    // Busiest full year 2005, 140; the ten years sorted put 80 and 80 in the middle, so the median year is 80: 1.75x.
    // Halves 2001-2005 (mean 108) and 2006-2010 (mean 64): 64 / 108 = 0.59, -41%, beyond the 10% error.
    expect(summaryLines(base)).toEqual([
      { figure: "Jul–Aug", text: "Peak months: these 2 hold 65% of a typical year.", target: "peak-months" },
      { figure: "2005", text: "Busiest full year: 140 fire cell-days, 1.75× the median year.", target: "burning-per-year" },
      { figure: "−41%", text: "Burning in 2006–2010 against 2001–2005.", target: "burning-per-year" },
      { figure: "1 month", text: "Stands out from its own history: July 2009, 6.00× its median.", target: "unusual-months" },
    ]);
  });
  it("calls a change inside the method's error what it is, and says when nothing stands out", () => {
    // Halves 2001-2003 (100) and 2004-2006 (103.3): +3%, inside the 10% error.
    const lines = summaryLines({ ...base, yearly: yearly([100, 100, 100, 100, 105, 105]), unusual: [] });
    expect(lines.slice(2)).toEqual([
      { figure: "+3%", text: "Burning in 2004–2006 against 2001–2003, within the method's error of ±10%.", target: "burning-per-year" },
      { figure: "0 months", text: "Stand out from their own history by more than the method's error.", target: "unusual-months" },
    ]);
  });
  it("gives a rise beyond the error, or with no error known, as a plain change, and no change as about the same", () => {
    // 150 / 100: +50%, beyond 10%. 103 / 100: +3% with no method error (the raw record). 100 / 100: 0%.
    const change = (values: number[], yearError: number | null) =>
      summaryLines({ ...base, yearly: yearly(values), yearError })[2];
    expect(change([100, 150], 0.1)).toMatchObject({ figure: "+50%", text: "Burning in 2002 against 2001." });
    expect(change([100, 103], null)).toMatchObject({ figure: "+3%", text: "Burning in 2002 against 2001." });
    expect(change([100, 100], 0.1)).toMatchObject({ figure: "About the same", text: "Burning in 2002 against 2001." });
  });
  it("names a single peak month, and several unusual months led by one whose median is zero", () => {
    const lines = summaryLines({
      ...base,
      peak: { months: [8], held: 0.62 },
      unusual: [
        { year: 2004, month: 1, value: 30, median: 0, ratio: null, z: 20, direction: "above", sensor: "modis" },
        ...base.unusual,
      ],
    });
    expect(lines[0]).toEqual({ figure: "Aug", text: "Peak month: it holds 62% of a typical year.", target: "peak-months" });
    expect(lines[3]).toEqual({
      figure: "2 months",
      text: "Stand out from their own history; the largest departure was January 2004, in a month that usually has none.",
      target: "unusual-months",
    });
  });
  it("leaves out what it cannot say", () => {
    // One full year: it is the median year, and there are no halves to compare.
    expect(summaryLines({ ...base, peak: null, yearly: yearly([100]), unusual: [] }).map((l) => l.figure)).toEqual([
      "2001",
      "0 months",
    ]);
    // A median year of zero gives no ratio; a first half of zero gives no change.
    expect(summaryLines({ ...base, peak: null, yearly: yearly([0, 0, 10]), unusual: [] })).toEqual([
      { figure: "2003", text: "Busiest full year: 10 fire cell-days.", target: "burning-per-year" },
      { figure: "0 months", text: "Stand out from their own history by more than the method's error.", target: "unusual-months" },
    ]);
    // No full year at all: neither the busiest year nor the change.
    const partial = yearly([100, 200]).map((y) => ({ ...y, complete: false }));
    expect(summaryLines({ ...base, yearly: partial }).map((l) => l.target)).toEqual(["peak-months", "unusual-months"]);
  });
});


describe("unusualMonths order", () => {
  it("puts the largest departure from the median first, not the largest z", () => {
    // Julys 10 .. 13 with 2010 = 60: excess 50, z 33.7. Januaries 0, 1, 0, 1, 0, 1, 0, 1, 0 with 2010 = 20: excess 20,
    // median 0.5 with MAD 0.5, z = 0.6745 * 19.5 / 0.5 = 26.3.
    const months = [
      ...[10, 12, 11, 9, 10, 13, 10, 11, 10, 60].map((value, i) => ({ year: 2001 + i, month: 7, value, sensor: "modis" })),
      ...[0, 1, 0, 1, 0, 1, 0, 1, 0, 20].map((value, i) => ({ year: 2001 + i, month: 1, value, sensor: "modis" })),
    ];
    expect(unusualMonths(months, () => null).map((m) => m.month)).toEqual([7, 1]);
  });
});
