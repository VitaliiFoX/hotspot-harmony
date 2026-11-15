import { describe, expect, it } from "vitest";
import type { TrustCountry } from "./api";
import {
  change, expectedError, monthError, percent, reportTime, sameMonthRatio, scalesWhereFactorWins, signedPercent, validateCommand,
  verdictKind,
} from "./trust";

// Made up in the shape of Argentina in docs/VALIDATION.md, where one scaling factor wins per country and year.
const argentina: TrustCountry = {
  method: "bins+context",
  method_name: "the mean of the table by fire power and the context model",
  method_chosen_per_held_out_year: true,
  held_out_months: 119,
  checks: {
    harmonized: { bias: 0.0076, country_year: 0.0484, country_month: 0.0662, tile_year: 0.1393, tile_month: 0.2283 },
    single_factor: { bias: 0, country_year: 0.0345, country_month: 0.0966, tile_year: 0.213, tile_month: 0.3068 },
    raw_viirs: { bias: 1.0669, country_year: 1.0669, country_month: 1.0669, tile_year: 1.0732, tile_month: 1.1036 },
  },
};

describe("percent", () => {
  it("writes a share with one decimal", () => {
    expect(percent(0.0662)).toBe("6.6%");
    expect(percent(1.0669)).toBe("106.7%");
    expect(percent(0)).toBe("0.0%");
  });
  it("gives a bias its sign", () => {
    expect(signedPercent(0.0076)).toBe("+0.8%");
    expect(signedPercent(-0.012)).toBe("−1.2%");
    expect(signedPercent(0)).toBe("0.0%");
  });
});

describe("scalesWhereFactorWins", () => {
  it("names the scales where one scaling factor beats the method, so the page can say so", () => {
    // 3.45% < 4.84% per country and year; the method wins every other scale.
    expect(scalesWhereFactorWins(argentina)).toEqual(["country_year"]);
  });
  it("is empty when the method wins everywhere", () => {
    const harmonized = { ...argentina.checks.harmonized, country_year: 0.0303 };
    expect(scalesWhereFactorWins({ ...argentina, checks: { ...argentina.checks, harmonized } })).toEqual([]);
  });
});

describe("expectedError", () => {
  it("reads the country figure for the whole region and the 1-degree tile figure for anything smaller", () => {
    expect(expectedError(argentina, true)).toEqual({ scale: "country_month", share: 0.0662 });
    expect(expectedError(argentina, false)).toEqual({ scale: "tile_month", share: 0.2283 });
  });
});

describe("validateCommand", () => {
  it("names the run the figures come from", () => {
    expect(validateCommand(argentina)).toBe("make validate NESTED=1");
    expect(validateCommand({ ...argentina, method_chosen_per_held_out_year: false })).toBe("make validate");
  });
});

describe("reportTime", () => {
  it("writes the UTC time of the report in words", () => {
    expect(reportTime("2026-11-14T21:50:59Z")).toBe("14 November 2026, 21:50 UTC");
    expect(reportTime(null)).toBe("an unknown time");
  });
});

describe("change", () => {
  it("reads a ratio as the change it means, as the sensor jump check gives them", () => {
    expect(change(1.998)).toBe("+100%"); // Ukraine, raw record
    expect(change(0.902)).toBe("−10%"); // Ukraine, harmonized
    expect(change(1.323)).toBe("+32%");
    expect(change(1.004)).toBe("no change");
  });
});

describe("monthError", () => {
  const withNoaa20 = {
    ...argentina,
    checks: {
      ...argentina.checks,
      noaa20: { bias: 0.035, country_year: 0.043, country_month: 0.05, tile_year: 0.137, tile_month: 0.25 },
      terra_only: { bias: 0, country_year: 0.032, country_month: 0.073, tile_year: 0.18, tile_month: 0.29 },
    },
  };
  it("gives a VIIRS month the larger of the held-out and the NOAA-20 error, at the scale of the area", () => {
    expect(monthError(withNoaa20, "viirs_noaa20", true)).toBe(0.0662); // 6.62% held out > 5.0% NOAA-20
    expect(monthError(withNoaa20, "viirs_noaa20", false)).toBe(0.25); // tile: 25% NOAA-20 > 22.83% held out
    expect(monthError(argentina, "viirs_noaa20", true)).toBe(0.0662); // no NOAA-20 check in the report
  });
  it("gives a Terra-only month the Terra-only error, and a MODIS month none: it is MODIS as reported", () => {
    expect(monthError(withNoaa20, "modis_terra", true)).toBe(0.073);
    expect(monthError(argentina, "modis_terra", true)).toBeNull();
    expect(monthError(withNoaa20, "modis", true)).toBeNull();
    expect(monthError(withNoaa20, null, true)).toBeNull();
  });
});

describe("verdictKind", () => {
  it("calls a month unusual only when it is further from its median than the method's error", () => {
    expect(verdictKind(1.13, 0.06)).toBe("above"); // 13% > 6%
    expect(verdictKind(1.13, 0.19)).toBe("within"); // 13% < 19%: a 1-degree tile
    expect(verdictKind(0.58, 0.066)).toBe("below");
    expect(verdictKind(0.95, 0.066)).toBe("within");
  });
  it("has no threshold without an error, and nothing to say without a ratio", () => {
    expect(verdictKind(1.01, null)).toBe("above");
    expect(verdictKind(0.99, null)).toBe("below");
    expect(verdictKind(1, null)).toBe("same"); // a MODIS month right on its median is not "more"
    expect(verdictKind(1, 0.06)).toBe("within");
    expect(verdictKind(null, 0.06)).toBe("none");
  });
});

describe("sameMonthRatio", () => {
  const calendar = {
    months: [
      { year: 2024, month: 7, value: 30, sensor: "viirs_snpp" },
      { year: 2025, month: 7, value: 84, sensor: "viirs_snpp" },
    ],
    climatology: [{ month: 7, median: 50 }],
  };
  it("is a month's value over the median of its calendar month in the same record", () => {
    expect(sameMonthRatio(calendar, 2025, 7)).toEqual({ ratio: 1.68, sensor: "viirs_snpp" });
  });
  it("is null when the month is not on screen or its median is zero", () => {
    expect(sameMonthRatio(calendar, 2023, 7)).toBeNull();
    expect(sameMonthRatio({ ...calendar, climatology: [{ month: 7, median: 0 }] }, 2025, 7)).toBeNull();
  });
});
