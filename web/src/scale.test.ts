import { describe, expect, it } from "vitest";
import {
  PEAK_SHARE, SEQUENTIAL, ZERO_FILL, brokenLinePath, cellColor, columnPath, formatTick, formatValue, lastDay, monthLabel,
  monthSpans, niceTicks, partsOfYear, peakMonths, position, rampColor, rampGradient, recordSpans, valuesByYear,
} from "./scale";

describe("position", () => {
  it("is the share of the maximum on a linear scale", () => {
    expect(position(25, 1, 100, "linear")).toBe(0.25);
    expect(position(100, 1, 100, "linear")).toBe(1);
  });
  it("runs from the smallest value above zero to the maximum on a log scale", () => {
    expect(position(10, 10, 1000, "log")).toBe(0);
    expect(position(100, 10, 1000, "log")).toBeCloseTo(0.5, 10);
    expect(position(1000, 10, 1000, "log")).toBe(1);
  });
  it("is zero for nothing, and never above one", () => {
    expect(position(0, 1, 100, "linear")).toBe(0);
    expect(position(5, 0, 0, "linear")).toBe(0);
    expect(position(150, 1, 100, "linear")).toBe(1);
    expect(position(7, 7, 7, "log")).toBe(1); // a single value has nothing to be compared with
  });
});

describe("cellColor", () => {
  it("gives zero its own neutral fill", () => {
    expect(cellColor(0, 1, 100, "linear", false)).toBe(ZERO_FILL.light);
    expect(cellColor(0, 1, 100, "linear", true)).toBe(ZERO_FILL.dark);
  });
  it("runs from the lightest stop to the darkest on a light surface", () => {
    expect(cellColor(1, 1, 1000, "log", false)).toBe(SEQUENTIAL[0]);
    expect(cellColor(1000, 1, 1000, "linear", false)).toBe(SEQUENTIAL[12]);
  });
  it("runs the other way on a dark surface", () => {
    expect(cellColor(1, 1, 1000, "log", true)).toBe(SEQUENTIAL[12]);
    expect(cellColor(1000, 1, 1000, "linear", true)).toBe(SEQUENTIAL[0]);
  });
  it("gives two values that differ a little two colours that differ a little", () => {
    // 300 and 310 of 1200 fell into one step of thirteen; now 300 is a stop itself (3 of 12) and 310 is a tenth
    // of the way to the next: 134 - 2.5 = 132, 182 - 1.5 = 181, 239 - 0.3 = 239.
    expect(cellColor(300, 1, 1200, "linear", false)).toBe(SEQUENTIAL[3]);
    expect(cellColor(310, 1, 1200, "linear", false)).toBe("#84b5ef");
  });
  it("puts the middle of the range in the middle of the ramp", () => {
    expect(cellColor(500, 1, 1000, "linear", false)).toBe(SEQUENTIAL[6]);
    expect(cellColor(100, 10, 1000, "log", false)).toBe(SEQUENTIAL[6]);
  });
  it("starts the log scale at the lightest step even when every month burned a lot", () => {
    expect(cellColor(3000, 3000, 105000, "log", false)).toBe(SEQUENTIAL[0]);
  });
});

describe("rampColor", () => {
  it("is a stop at each twelfth of the ramp", () => {
    expect(rampColor(0, false)).toBe("#cde2fb");
    expect(rampColor(3 / 12, false)).toBe("#86b6ef");
    expect(rampColor(1, false)).toBe("#0d366b");
  });
  it("mixes the two stops around a place between them", () => {
    // 0.4 of the way from #cde2fb to #b7d3f6: 205 - 8.8 = 196, 226 - 6 = 220, 251 - 2 = 249.
    expect(rampColor(0.4 / 12, false)).toBe("#c4dcf9");
    // The same place from the other end on a dark surface: 0.4 of the way from #0d366b to #104281.
    // 13 + 1.2 = 14, 54 + 4.8 = 59, 107 + 8.8 = 116.
    expect(rampColor(0.4 / 12, true)).toBe("#0e3b74");
  });
  it("stays on the ramp for a place outside it", () => {
    expect(rampColor(-1, false)).toBe("#cde2fb");
    expect(rampColor(2, false)).toBe("#0d366b");
  });
});

describe("rampGradient", () => {
  it("runs through every stop, light to dark, and the other way on a dark surface", () => {
    expect(rampGradient(false)).toBe(`linear-gradient(90deg, ${SEQUENTIAL.join(", ")})`);
    expect(rampGradient(true)).toBe(`linear-gradient(90deg, ${[...SEQUENTIAL].reverse().join(", ")})`);
  });
});

describe("niceTicks", () => {
  it("uses round steps that cover the maximum", () => {
    expect(niceTicks(87)).toEqual([0, 50, 100]);
    expect(niceTicks(1930)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceTicks(400)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(11218)).toEqual([0, 5000, 10000, 15000]);
  });
  it("still gives an axis when there is nothing to show", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("formatting", () => {
  it("writes values in full below 10,000 and compact from there", () => {
    expect(formatValue(1284)).toBe("1,284");
    expect(formatValue(12940)).toBe("12.9K");
    expect(formatValue(30.5)).toBe("30.5");
    expect(formatValue(2100.5)).toBe("2,101");
  });
  it("keeps one style along an axis", () => {
    expect(formatTick(5000, 15000)).toBe("5K");
    expect(formatTick(500, 2000)).toBe("500");
  });
  it("names months and finds their last day", () => {
    expect(monthLabel("2012-02")).toBe("February 2012");
    expect(lastDay("2024-02")).toBe("2024-02-29");
    expect(lastDay("2025-12")).toBe("2025-12-31");
  });
});

describe("columnPath", () => {
  it("rounds the top and keeps the foot square", () => {
    expect(columnPath(10, 100, 20, 40)).toBe("M10,100 L10,64 Q10,60 14,60 L26,60 Q30,60 30,64 L30,100 Z");
  });
  it("shrinks the radius for a column shorter than it", () => {
    expect(columnPath(0, 100, 20, 2)).toBe("M0,100 L0,100 Q0,98 2,98 L18,98 Q20,98 20,100 L20,100 Z");
  });
});

describe("valuesByYear", () => {
  const bars = [
    { year: 2011, value: 10, complete: true },
    { year: 2012, value: 12, complete: true },
    { year: 2013, value: 11, complete: false },
  ];
  it("puts the line's value under each column's year", () => {
    const raw = [
      { year: 2011, value: 10, complete: true },
      { year: 2012, value: 25, complete: true },
      { year: 2013, value: 22, complete: false },
    ];
    expect(valuesByYear(bars, raw)).toEqual([10, 25, 22]);
  });
  it("leaves a gap where the line has no such year, and ignores years with no column", () => {
    const raw = [
      { year: 2010, value: 9, complete: true },
      { year: 2011, value: 10, complete: true },
      { year: 2013, value: 22, complete: true },
    ];
    expect(valuesByYear(bars, raw)).toEqual([10, null, 22]);
  });
});

describe("brokenLinePath", () => {
  it("joins the points in order", () => {
    expect(brokenLinePath([[0, 10], [20, 5], [40, 8]])).toBe("M0,10 L20,5 L40,8");
  });
  it("starts again after a gap, so a missing year is not bridged", () => {
    expect(brokenLinePath([[0, 10], null, [40, 8], [60, 2]])).toBe("M0,10 M40,8 L60,2");
  });
  it("is empty without points", () => {
    expect(brokenLinePath([null, null])).toBe("");
  });
});

// Monthly medians that add up to 100, so every share is the median itself in percent.
const MEDIANS = [0, 0, 30, 20, 5, 5, 10, 15, 10, 5, 0, 0];
const climatology = MEDIANS.map((median, i) => ({ month: i + 1, median, p25: 0, p75: median, years: 25 }));

describe("peakMonths", () => {
  it("takes the fewest months that hold 60% of a typical year, largest first, and lists them in calendar order", () => {
    // Mar 30 + Apr 20 = 50 < 60; adding Aug 15 gives 65.
    expect(PEAK_SHARE).toBe(0.6);
    expect(peakMonths(climatology)).toEqual({ months: [3, 4, 8], held: 0.65, total: 100 });
  });
  it("breaks a tie by the earlier month", () => {
    // Mar 30 + Apr 20 + Aug 15 = 65 < 70; Jul and Sep tie at 10, and Jul comes first: 75.
    expect(peakMonths(climatology, 0.7).months).toEqual([3, 4, 7, 8]);
  });
  it("is empty when every month's median is zero", () => {
    const quiet = climatology.map((c) => ({ ...c, median: 0 }));
    expect(peakMonths(quiet)).toEqual({ months: [], held: 0, total: 0 });
  });
});

describe("monthSpans", () => {
  it("joins neighbouring months into spans", () => {
    expect(monthSpans([3, 4, 8])).toBe("Mar–Apr and Aug");
    expect(monthSpans([7, 8, 9])).toBe("Jul–Sep");
  });
  it("runs a span across the new year", () => {
    expect(monthSpans([1, 2, 12])).toBe("Dec–Feb");
    expect(monthSpans([1, 6, 11, 12])).toBe("Jun and Nov–Jan");
  });
  it("names a single month, three spans with commas, and nothing", () => {
    expect(monthSpans([5])).toBe("May");
    expect(monthSpans([1, 4, 8])).toBe("Jan, Apr and Aug");
    expect(monthSpans([])).toBe("");
  });
});

// The harmonized record of pipeline.harmonize.RECORD, as /api/meta serves it.
const RECORD = [
  { sensor: "modis_terra", label: "MODIS Terra only, scaled", from: "2000-11", to: "2002-06" },
  { sensor: "modis", label: "MODIS Terra + Aqua (reference)", from: "2002-07", to: "2021-12" },
  { sensor: "viirs_noaa20", label: "VIIRS NOAA-20, harmonized", from: "2022-01", to: null },
];

describe("recordSpans", () => {
  it("places each part of the record on the year axis, in columns from the first year, to the month", () => {
    // 2000-11 starts 10/12 into the first column; 2002-06 ends half way through the third; open ends run to the last.
    const spans = recordSpans(RECORD, 2000, 2025);
    expect(spans.map((s) => s.sensor)).toEqual(["modis_terra", "modis", "viirs_noaa20"]);
    expect(spans.map((s) => [s.start, s.end])).toEqual([[10 / 12, 2.5], [2.5, 22], [22, 26]]);
  });
  it("cuts the parts to the years on screen and drops the ones outside", () => {
    expect(recordSpans(RECORD, 2010, 2015)).toEqual([
      { sensor: "modis", label: "MODIS Terra + Aqua (reference)", start: 0, end: 6 },
    ]);
  });
});

describe("partsOfYear", () => {
  it("names the parts of the record a year draws on", () => {
    expect(partsOfYear(RECORD, 2002)).toEqual(["MODIS Terra only, scaled", "MODIS Terra + Aqua (reference)"]);
    expect(partsOfYear(RECORD, 2012)).toEqual(["MODIS Terra + Aqua (reference)"]);
    expect(partsOfYear(RECORD, 2025)).toEqual(["VIIRS NOAA-20, harmonized"]);
    expect(partsOfYear(RECORD, 1999)).toEqual([]);
  });
});
