import { describe, expect, it } from "vitest";
import type { DayHotspot, Region } from "./api";
import {
  DEFAULT_TIME, DEFAULT_VIEW, MERCATOR_LIMIT, cellAreaKm2, cellSentence, cellSquares, cellStops, countHotspots, dayKey, latLonLabel, stopLabel, trendChange,
  trendSentence, defaultDate, dotStyle, hourFilters, hourInstant, isNight, longDate, monthGrid,
  moveToMonth, nightPolygon, terminatorLine, parseDateParam, parseTimeParam, parseViewParam, flatFillZoom, regionAt, regionsCenter, sensorLabel, shiftMonth, subsolarPoint,
} from "./globe";

describe("monthGrid", () => {
  it("starts on Monday with a blank for each weekday before the 1st", () => {
    const august = monthGrid("2025-08"); // 1 August 2025 is a Friday
    expect(august.slice(0, 5)).toEqual([null, null, null, null, "2025-08-01"]);
    expect(august).toHaveLength(4 + 31);
    expect(august.at(-1)).toBe("2025-08-31");
  });
  it("needs no blank when the month starts on Monday and six when it starts on Sunday", () => {
    expect(monthGrid("2025-09")[0]).toBe("2025-09-01");
    expect(monthGrid("2024-09").indexOf("2024-09-01")).toBe(6);
  });
  it("knows leap years", () => {
    expect(monthGrid("2024-02").at(-1)).toBe("2024-02-29");
    expect(monthGrid("2025-02").at(-1)).toBe("2025-02-28");
  });
});

describe("moving between months", () => {
  it("steps over the turn of the year", () => {
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
    expect(shiftMonth("2025-08", -12)).toBe("2024-08");
  });
  it("keeps the day number and shortens it to the new month", () => {
    expect(moveToMonth("2025-08-20", "2025-07", "2000-11-01", "2025-12-31")).toBe("2025-07-20");
    expect(moveToMonth("2025-03-31", "2025-02", "2000-11-01", "2025-12-31")).toBe("2025-02-28");
    expect(moveToMonth("2024-03-31", "2024-02", "2000-11-01", "2025-12-31")).toBe("2024-02-29");
  });
  it("stays inside the record", () => {
    expect(moveToMonth("2000-12-15", "2000-11", "2000-11-20", "2025-12-31")).toBe("2000-11-20");
    expect(moveToMonth("2025-11-30", "2025-12", "2000-11-01", "2025-12-10")).toBe("2025-12-10");
  });
});

describe("reading the address", () => {
  it("takes real dates written YYYY-MM-DD only", () => {
    expect(parseDateParam("2025-08-20")).toBe("2025-08-20");
    expect(parseDateParam("2024-02-29")).toBe("2024-02-29");
    expect(parseDateParam("2025-02-29")).toBeNull();
    expect(parseDateParam("2025-13-01")).toBeNull();
    expect(parseDateParam("2025-8-20")).toBeNull();
    expect(parseDateParam("yesterday")).toBeNull();
    expect(parseDateParam(null)).toBeNull();
  });
  it("reads HH:MM as minutes after midnight, and an old whole-hour link as the end of that hour", () => {
    expect(parseTimeParam("18:42")).toBe(18 * 60 + 42);
    expect(parseTimeParam("0:05")).toBe(5);
    expect(parseTimeParam("23:59")).toBe(1439);
    expect(parseTimeParam("24:00")).toBeNull();
    expect(parseTimeParam("12:60")).toBeNull();
    expect(parseTimeParam("1830")).toBeNull();
    expect(parseTimeParam(null, "18")).toBe(18 * 60 + 59);
    expect(parseTimeParam(null, "24")).toBeNull();
    expect(parseTimeParam(null, null)).toBeNull();
  });
  it("opens on 23:59 UTC, so a fresh page shows the whole day", () => {
    expect(DEFAULT_TIME).toBe(23 * 60 + 59);
  });
  it("opens on the preferred day when the record covers it, else on its last day", () => {
    expect(defaultDate("2000-11-01", "2025-12-31")).toBe("2025-08-20");
    expect(defaultDate("2000-11-01", "2025-06-30")).toBe("2025-06-30");
  });
});

describe("countHotspots", () => {
  // Selected time 18:59 (minute 1139): the hour up to it is minutes 1080 to 1139.
  const hotspots: DayHotspot[] = [
    [0, 0, 0, 0],
    [0, 0, 1079, 1],
    [0, 0, 1080, 0],
    [0, 0, 1139, 0],
    [0, 0, 1140, 1],
    [0, 0, 1200, 5], // a region index the response does not list counts in the total only
  ];
  it("counts through the selected minute, in the hour up to it and over the day", () => {
    const counts = countHotspots(hotspots, 1139, 2);
    expect([counts.throughHour, counts.inHour, counts.day]).toEqual([4, 2, 6]);
  });
  it("counts each region apart", () => {
    expect(countHotspots(hotspots, 1139, 2).regions).toEqual([
      { throughHour: 3, inHour: 2, day: 3 },
      { throughHour: 1, inHour: 0, day: 2 },
    ]);
  });
  it("moves minute by minute", () => {
    expect(countHotspots(hotspots, 0, 2).throughHour).toBe(1);
    expect(countHotspots(hotspots, 1138, 2).throughHour).toBe(3);
    expect(countHotspots(hotspots, 1139, 2).throughHour).toBe(4);
    expect(countHotspots(hotspots, 1439, 2).throughHour).toBe(6);
    expect(countHotspots(hotspots, 1140, 2).inHour).toBe(2); // 1081..1140 holds 1139 and 1140, not 1080
  });
});

describe("dotStyle", () => {
  it("draws no dot for a day without hotspots", () => {
    expect(dotStyle(0, 100)).toBeNull();
    expect(dotStyle(5, 0)).toBeNull();
  });
  it("grows from 4 px at .35 to 8 px at full opacity by the square root of the share", () => {
    expect(dotStyle(100, 100)).toEqual({ size: 8, opacity: 1 });
    expect(dotStyle(25, 100)).toEqual({ size: 6, opacity: 0.675 });
  });
});

describe("hourFilters", () => {
  it("cuts at the selected minute and marks the hour up to it", () => {
    expect(hourFilters(1139)).toEqual({
      through: ["<=", ["get", "minute"], 1139],
      inHour: ["all", [">", ["get", "minute"], 1079], ["<=", ["get", "minute"], 1139]],
    });
  });
});

describe("regions", () => {
  const regions: Region[] = [
    { name: "A", bbox: [-10, -10, 10, 10] },
    { name: "B", bbox: [80, -10, 100, 10] },
  ];
  it("finds the box a point is in", () => {
    expect(regionAt(regions, 0, 0)?.name).toBe("A");
    expect(regionAt(regions, 90, 10)?.name).toBe("B");
    expect(regionAt(regions, 45, 0)).toBeNull();
  });
  it("centres between the boxes on the sphere", () => {
    const center = regionsCenter(regions);
    expect(center.lon).toBeCloseTo(45, 6);
    expect(center.lat).toBeCloseTo(0, 6);
    expect(regionsCenter([regions[1]]).lon).toBeCloseTo(90, 6);
  });
});

describe("subsolarPoint", () => {
  it("is near 0, 0 at noon UTC on the March equinox", () => {
    const sun = subsolarPoint(Date.UTC(2025, 2, 20, 12));
    expect(sun.lon).toBe(0);
    expect(Math.abs(sun.lat)).toBeLessThan(1.5);
  });
  it("is on the Tropic of Cancer at the June solstice and of Capricorn in December", () => {
    expect(subsolarPoint(Date.UTC(2025, 5, 21, 12)).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(Date.UTC(2025, 11, 21, 12)).lat).toBeCloseTo(-23.44, 1);
  });
  it("moves 15 degrees west per hour", () => {
    expect(subsolarPoint(Date.UTC(2025, 11, 21, 18)).lon).toBe(-90);
    expect(subsolarPoint(Date.UTC(2025, 11, 21, 6)).lon).toBe(90);
    expect(subsolarPoint(Date.UTC(2025, 11, 21, 0)).lon).toBe(180);
  });
  it("is taken at the selected minute", () => {
    expect(hourInstant("2025-08-20", 18 * 60 + 42)).toBe(Date.UTC(2025, 7, 20, 18, 42));
  });
});

describe("night side", () => {
  const juneNoon = Date.UTC(2025, 5, 21, 12);
  it("knows day from night", () => {
    expect(isNight(juneNoon, 0, 0)).toBe(false);
    expect(isNight(juneNoon, 180, 0)).toBe(true);
    expect(isNight(juneNoon, 0, 89)).toBe(false); // polar day
    expect(isNight(juneNoon, 0, -89)).toBe(true); // polar night
  });
  it("traces the terminator and closes over the dark pole at the edge of Web Mercator", () => {
    // Declination 23.44: the terminator reaches 90 - 23.44 = 66.56 degrees under and opposite the Sun.
    const ring = nightPolygon(juneNoon, 4).coordinates[0];
    expect(ring.map(([lon]) => lon)).toEqual([-180, -90, 0, 90, 180, 180, -180, -180]);
    const lats = ring.map(([, lat]) => lat);
    expect(lats[0]).toBeCloseTo(66.56, 1);
    expect(lats[1]).toBeCloseTo(0, 6);
    expect(lats[2]).toBeCloseTo(-66.56, 1);
    expect(lats.slice(5, 7)).toEqual([-MERCATOR_LIMIT, -MERCATOR_LIMIT]);
    expect(ring.at(-1)).toEqual(ring[0]);
  });
  it("keeps every vertex inside Web Mercator, even at an equinox when the terminator runs pole to pole", () => {
    const ring = nightPolygon(Date.UTC(2025, 2, 20, 12), 36).coordinates[0];
    expect(Math.max(...ring.map(([, lat]) => Math.abs(lat)))).toBe(MERCATOR_LIMIT);
  });
  it("gives the terminator as a line that leaves out the edge over the pole", () => {
    const line = terminatorLine(juneNoon, 4).coordinates;
    expect(line.map(([lon]) => lon)).toEqual([-180, -90, 0, 90, 180]);
    expect(line[2][1]).toBeCloseTo(-66.56, 1);
  });
  it("closes over the north pole in December", () => {
    const ring = nightPolygon(Date.UTC(2025, 11, 21, 12), 4).coordinates[0];
    expect(ring[5]).toEqual([180, MERCATOR_LIMIT]);
  });
});

describe("dayKey", () => {
  it("turns a day of the month into a date and keeps a date as it is", () => {
    expect(dayKey("2025-08", 1)).toBe("2025-08-01");
    expect(dayKey("2025-08", 20)).toBe("2025-08-20");
    expect(dayKey("2025-08", "2025-08-20")).toBe("2025-08-20");
  });
});

describe("labels", () => {
  it("writes dates and sensors the way people read them", () => {
    expect(longDate("2025-08-20")).toBe("20 August 2025");
    expect(longDate("2001-01-05")).toBe("5 January 2001");
    expect(sensorLabel("viirs_snpp")).toBe("VIIRS S-NPP");
    expect(sensorLabel("modis")).toBe("MODIS");
  });
});

describe("cellSquares", () => {
  it("draws each cell as a square of the grid around its centre, with what the map colours and the hover reads", () => {
    const squares = cellSquares(
      [{ lat: 48.125, lon: 37.625, per_year: 62, years_burning: 25, peak_month: 8, early: 40, late: 80, trend: 2 }], 0.25, 0.14,
    );
    expect(squares.features).toHaveLength(1);
    expect(squares.features[0].geometry.coordinates[0]).toEqual([
      [37.5, 48], [37.75, 48], [37.75, 48.25], [37.5, 48.25], [37.5, 48],
    ]);
    // 0.25 degree at 48.125 N: 27.83 km north-south by 27.83 * cos(48.125) = 18.57 km, 516.8 km2; 62 / 5.168 = 12.0.
    expect(squares.features[0].properties).toEqual({
      lat: 48.125, lon: 37.625, per_year: 62, years_burning: 25, peak_month: 8, density: 12, early: 40, late: 80, trend: 2, change: 1,
    });
  });
});

describe("cellStops", () => {
  it("puts the colour steps at the median, the upper quartile, the 90th and the 98th percentile of the cells", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1 .. 100
    expect(cellStops(values)).toEqual([50.5, 75.25, 90.1, 98.02]);
  });
  it("keeps the steps strictly rising, so the map's interpolation accepts them", () => {
    expect(cellStops([5, 5, 5, 5])).toEqual([5, 5.001, 5.002, 5.003]);
    expect(cellStops([])).toEqual([1, 1.001, 1.002, 1.003]);
  });
});

describe("cellAreaKm2", () => {
  it("shrinks with the cosine of the latitude, so a cell in Ukraine is smaller than one in northern Argentina", () => {
    expect(Math.round(cellAreaKm2(48.125, 0.25))).toBe(517);
    expect(Math.round(cellAreaKm2(-25.125, 0.25))).toBe(701);
    expect(Math.round(cellAreaKm2(0, 1))).toBe(12392);
  });
});

describe("stopLabel", () => {
  it("rounds a colour step for the legend", () => {
    expect(stopLabel(7.634)).toBe("7.6");
    expect(stopLabel(45.83)).toBe("46");
    expect(stopLabel(0.04)).toBe("0.04");
  });
});

describe("cellSentence", () => {
  it("says how often, how much and when a cell burns, and the same per 100 km2", () => {
    const cell = { lat: 48.375, lon: 38.875, per_year: 54.2, years_burning: 24, peak_month: 8 };
    expect(cellSentence(cell, 25, "MODIS-equivalent fire cell-days", 0.25)).toBe(
      // 54.2 over 514.5 km2 at 48.375 N is 10.53 per 100 km2, printed whole from 10.
      "Burns in 24 of 25 years, about 54 MODIS-equivalent fire cell-days a year (11 per 100 km²), most in August.",
    );
  });
  it("keeps one decimal for a small cell and says when it burned in one year only", () => {
    const cell = { lat: 0.5, lon: 1.5, per_year: 1.04, years_burning: 1, peak_month: 3 };
    expect(cellSentence(cell, 4, "fire cell-days", 1)).toBe(
      "Burned in 1 of 4 years, about 1.0 fire cell-days a year (0.01 per 100 km²), most in March.",
    );
  });
});

describe("latLonLabel", () => {
  it("names a cell centre with hemispheres, two decimals", () => {
    expect(latLonLabel(48.125, 37.625)).toBe("48.13° N, 37.63° E");
    expect(latLonLabel(-27.125, -65.375)).toBe("27.13° S, 65.38° W");
  });
});

describe("trendChange", () => {
  it("is the change in doublings, zero inside the error of the method, and capped at four times either way", () => {
    expect(trendChange(2, 0.14)).toBe(1); // doubled
    expect(trendChange(0.5, 0.14)).toBe(-1); // halved
    expect(trendChange(1.1, 0.14)).toBe(0); // +10% is within 14%
    expect(trendChange(0.9, 0.14)).toBe(0);
    expect(trendChange(16, 0.14)).toBe(2); // 4x and more look the same
    expect(trendChange(1.5, 0)).toBeCloseTo(0.585, 3); // without an error any change counts
  });
  it("is null where the first half did not burn, so there is no ratio", () => {
    expect(trendChange(null, 0.14)).toBeNull();
  });
});

describe("trendSentence", () => {
  const halves = { early: "2001-2012", late: "2014-2025" };
  it("says how the second half compares with the first", () => {
    expect(trendSentence({ early: 10, late: 14, trend: 1.4 }, halves, 0.14)).toBe(
      "2014–2025 against 2001–2012: +40% (1.40×).",
    );
    expect(trendSentence({ early: 10, late: 5, trend: 0.5 }, halves, 0.14)).toBe("2014–2025 against 2001–2012: −50% (0.50×).");
  });
  it("says when a change is inside the error, and when there is nothing to compare with", () => {
    expect(trendSentence({ early: 10, late: 11, trend: 1.1 }, halves, 0.14)).toBe(
      "2014–2025 against 2001–2012: +10%, within the method's error of ±14%.",
    );
    expect(trendSentence({ early: 0, late: 2.5, trend: null }, halves, 0.14)).toBe(
      "No burning in 2001–2012, so no change can be given; about 2.5 a year in 2014–2025.",
    );
  });
});

describe("parseViewParam", () => {
  it("reads the flat map and the globe by name", () => {
    expect(parseViewParam("flat")).toBe("flat");
    expect(parseViewParam("globe")).toBe("globe");
  });
  it("opens the globe when the address says nothing or something unknown", () => {
    expect(DEFAULT_VIEW).toBe("globe");
    expect(parseViewParam(null)).toBe("globe");
    expect(parseViewParam("")).toBe("globe");
    expect(parseViewParam("Flat")).toBe("globe");
    expect(parseViewParam("mercator")).toBe("globe");
  });
});

describe("flatFillZoom", () => {
  it("is the zoom at which the 512 px world is as wide as the map", () => {
    expect(flatFillZoom(512, 512)).toBe(0);
    expect(flatFillZoom(1024, 600)).toBe(1); // 1024 / 512 = 2, one doubling; the height needs less
  });
  it("follows the height when the map is taller than wide, so no sky shows above or below", () => {
    expect(flatFillZoom(600, 2048)).toBe(2); // 2048 / 512 = 4, two doublings
  });
  it("never shrinks the world below its zoom 0 size on a map smaller than it", () => {
    expect(flatFillZoom(256, 128)).toBe(-1); // 256 / 512 = 1/2: the world still fills the wider side
  });
  it("falls back to zoom 0 for a map with no size yet", () => {
    expect(flatFillZoom(0, 0)).toBe(0);
  });
});
