import { describe, expect, it } from "vitest";
import type { TrustCountry } from "./api";
import { expectedError, percent, reportTime, scalesWhereFactorWins, signedPercent, validateCommand } from "./trust";

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
