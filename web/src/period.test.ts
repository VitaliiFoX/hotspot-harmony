import { describe, expect, it } from "vitest";
import { countHotspots, hourFilters } from "./globe";
import {
  MAX_PERIOD_DAYS, addDays, cursorLabel, inSpan, makeSpan, monthSpan, parseView, periodAround, spanDays, spanLabel,
} from "./period";

const FIRST = "2000-11-01";
const LAST = "2025-12-31";

describe("days and spans", () => {
  it("reads the view a link asks for, one day by default", () => {
    expect(parseView("month")).toBe("month");
    expect(parseView("period")).toBe("period");
    expect(parseView(null)).toBe("day");
    expect(parseView("week")).toBe("day");
  });
  it("moves a day across months, years and a leap day", () => {
    expect(addDays("2025-06-30", 1)).toBe("2025-07-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("counts the days of a span, both ends included", () => {
    expect(spanDays({ start: "2025-06-10", end: "2025-06-10" })).toBe(1);
    expect(spanDays({ start: "2025-06-03", end: "2025-06-17" })).toBe(15);
    expect(spanDays({ start: "2024-01-01", end: "2024-12-31" })).toBe(366);
  });
  it("takes the calendar month of a day, cut to the record", () => {
    expect(monthSpan("2024-02-10", FIRST, LAST)).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthSpan("2025-12-05", FIRST, "2025-12-20")).toEqual({ start: "2025-12-01", end: "2025-12-20" });
    expect(monthSpan("2000-11-30", FIRST, LAST)).toEqual({ start: "2000-11-01", end: "2000-11-30" });
  });
  it("puts the two clicked days of a period in order, inside the record and at most a year apart", () => {
    expect(makeSpan("2025-06-17", "2025-06-03", FIRST, LAST)).toEqual({ start: "2025-06-03", end: "2025-06-17" });
    expect(makeSpan("2000-10-01", "2000-11-05", FIRST, LAST)).toEqual({ start: FIRST, end: "2000-11-05" });
    const long = makeSpan("2020-01-01", "2023-01-01", FIRST, LAST);
    expect(spanDays(long)).toBe(MAX_PERIOD_DAYS);
  });
  it("opens a period as the week up to the day on screen", () => {
    expect(periodAround("2025-06-10", FIRST, LAST)).toEqual({ start: "2025-06-04", end: "2025-06-10" });
    expect(periodAround("2000-11-03", FIRST, LAST)).toEqual({ start: FIRST, end: "2000-11-03" });
  });
  it("tells whether a day is inside a span", () => {
    const span = { start: "2025-06-03", end: "2025-06-17" };
    expect([inSpan("2025-06-03", span), inSpan("2025-06-17", span), inSpan("2025-06-18", span)]).toEqual([true, true, false]);
    expect(inSpan("2025-06-03", null)).toBe(false);
  });
});

describe("a span in words", () => {
  it("writes once what both ends share", () => {
    expect(spanLabel({ start: "2025-06-10", end: "2025-06-10" })).toBe("10 June 2025");
    expect(spanLabel({ start: "2025-06-03", end: "2025-06-17" })).toBe("3–17 June 2025");
    expect(spanLabel({ start: "2025-05-28", end: "2025-06-04" })).toBe("28 May – 4 June 2025");
    expect(spanLabel({ start: "2024-12-28", end: "2025-01-04" })).toBe("28 December 2024 – 4 January 2025");
  });
  it("names the day of the slider, with the year only when the span crosses one", () => {
    expect(cursorLabel({ start: "2025-06-03", end: "2025-06-17" }, 2)).toBe("5 June");
    expect(cursorLabel({ start: "2024-12-28", end: "2025-01-04" }, 5)).toBe("2 January 2025");
  });
});

describe("hotspots over a span", () => {
  // The third field is the day of the span: day 0, 1, 1 and 2.
  const hotspots: [number, number, number, number][] = [[0, 0, 0, 0], [0, 0, 1, 1], [0, 0, 1, 0], [0, 0, 2, 0]];
  it("counts through a day and on that day when the window is one day", () => {
    const counts = countHotspots(hotspots, 1, 2, 1);
    expect([counts.throughHour, counts.inHour, counts.day]).toEqual([3, 2, 4]);
    expect(counts.regions.map((r) => r.throughHour)).toEqual([2, 1]);
  });
  it("filters the map the same way", () => {
    expect(hourFilters(1, 1).inHour).toEqual(["all", [">", ["get", "minute"], 0], ["<=", ["get", "minute"], 1]]);
  });
});
