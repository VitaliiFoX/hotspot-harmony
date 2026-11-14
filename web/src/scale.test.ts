import { describe, expect, it } from "vitest";
import {
  SEQUENTIAL, ZERO_FILL, cellColor, columnPath, formatTick, formatValue, lastDay, monthLabel, niceTicks, position,
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
  it("runs from the lightest step to the darkest on a light surface", () => {
    expect(cellColor(1, 1, 1000, "linear", false)).toBe(SEQUENTIAL[0]);
    expect(cellColor(1000, 1, 1000, "linear", false)).toBe(SEQUENTIAL[12]);
  });
  it("runs the other way on a dark surface", () => {
    expect(cellColor(1, 1, 1000, "linear", true)).toBe(SEQUENTIAL[12]);
    expect(cellColor(1000, 1, 1000, "linear", true)).toBe(SEQUENTIAL[0]);
  });
  it("puts the middle of the range in the middle of the ramp", () => {
    expect(cellColor(500, 1, 1000, "linear", false)).toBe(SEQUENTIAL[6]);
    expect(cellColor(100, 10, 1000, "log", false)).toBe(SEQUENTIAL[6]);
  });
  it("starts the log scale at the lightest step even when every month burned a lot", () => {
    expect(cellColor(3000, 3000, 105000, "log", false)).toBe(SEQUENTIAL[0]);
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
