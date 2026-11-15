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
    headline: { year: 2010, month: 8, ratio: 1.13, kind: "above" as const },
    unusual: [{ year: 2009, month: 7, value: 60, median: 10, ratio: 6, z: 33.7, direction: "above" as const, sensor: "modis" }],
    yearError: 0.1,
  };
  it("says the season, the busiest year, the change, the latest season and what stands out, from the numbers given", () => {
    // Busiest full year 2005, 140; the ten years sorted put 80 and 80 in the middle, so the median year is 80: 1.75x.
    // Halves 2001-2005 (mean 108) and 2006-2010 (mean 64): -41%.
    expect(summaryLines(base)).toEqual([
      "Burning peaks in Jul–Aug: these 2 months hold 65% of a typical year.",
      "The busiest full year was 2005, with 140 fire cell-days, 1.75× the median year.",
      "Burning in 2006–2010 was 41% lower than in 2001–2005.",
      "August 2010, the busiest of the last 12 months, burned 1.13× a typical August.",
      "1 month stands out from its own history: July 2009, 6.00× its median.",
    ]);
  });
  it("calls a change or a month inside the method's error what it is, and says when nothing stands out", () => {
    const lines = summaryLines({
      ...base,
      yearly: yearly([100, 100, 100, 100, 105, 105]), // halves 2001-2003 (100) and 2004-2006 (103.3): +3%
      headline: { year: 2006, month: 8, ratio: 1.04, kind: "within" },
      unusual: [],
    });
    expect(lines.slice(2)).toEqual([
      "Burning in 2004–2006 was 3% higher than in 2001–2003, within the method's error of ±10%.",
      "August 2006, the busiest of the last 12 months, is within the method's error of a typical August (1.04×).",
      "No month stands out from its own history by more than the method's error.",
    ]);
  });
  it("leaves out what it cannot say", () => {
    const lines = summaryLines({ ...base, peak: null, yearly: yearly([100]), headline: null, unusual: [] });
    expect(lines).toEqual([
      "The busiest full year was 2001, with 100 fire cell-days, 1.00× the median year.",
      "No month stands out from its own history by more than the method's error.",
    ]);
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
