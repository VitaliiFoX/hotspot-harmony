import { describe, expect, it } from "vitest";
import type { Calendar } from "./api";
import { calendarCsv, exportName } from "./exports";

const calendar = {
  series: "harmonized",
  unit: "MODIS-equivalent fire cell-days",
  cells_used: 2,
  warnings: [],
  months: [
    { year: 2024, month: 8, value: 64, sensor: "viirs_noaa20" },
    { year: 2024, month: 9, value: 0.5, sensor: "viirs_noaa20" },
    { year: 2024, month: 10, value: 3, sensor: null },
  ],
  climatology: [
    { month: 8, median: 31, p25: 19, p75: 46, years: 4 },
    { month: 9, median: 0, p25: 0, p75: 1, years: 4 },
  ],
  anomaly: { year: 2024, month: 10, value: 3, median: 0, ratio: null, percentile: 50 },
  yearly: [],
} as unknown as Calendar;

describe("calendarCsv", () => {
  const lines = calendarCsv(calendar, { region: "Ukraine", box: [22, 44, 40.3, 52.5] }).trimEnd().split("\n");

  it("has one header and one row per month", () => {
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "year,month,value,unit,record,sensor,month_median,month_p25,month_p75,ratio_to_median,region,west,south,east,north",
    );
  });
  it("gives each month its calendar month's median and the ratio to it", () => {
    expect(lines[1]).toBe("2024,8,64,MODIS-equivalent fire cell-days,harmonized,viirs_noaa20,31,19,46,2.06,Ukraine,22,44,40.3,52.5");
  });
  it("leaves the ratio empty against a zero median, and every climatology field empty where there is none", () => {
    expect(lines[2].split(",")[9]).toBe("");
    expect(lines[3]).toBe("2024,10,3,MODIS-equivalent fire cell-days,harmonized,,,,,,Ukraine,22,44,40.3,52.5");
  });
  it("quotes a field that holds a comma", () => {
    const quoted = calendarCsv(calendar, { region: "Korea, South", box: [1, 2, 3, 4] });
    expect(quoted.split("\n")[1]).toContain(',"Korea, South",');
  });
});

describe("exportName", () => {
  it("joins safe lower-case parts", () => {
    expect(exportName(["Burning activity calendar", "Ukraine", "2000-11", "2025-12", "harmonized"], "png")).toBe(
      "burning-activity-calendar_ukraine_2000-11_2025-12_harmonized.png",
    );
  });
});
