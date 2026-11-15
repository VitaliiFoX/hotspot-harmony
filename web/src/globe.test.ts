import { describe, expect, it } from "vitest";
import type { DayHotspot, Region } from "./api";
import {
  type Rgba, DEFAULT_TIME, DEFAULT_VIEW, MERCATOR_LIMIT, busiestCells, cellAreaKm2, cellGroups, cellImage, cellSurface, rampRgba, changeLabel, cellSentence, cellSquares, cellStops, countHotspots, dayKey, latLonLabel, stopLabel, trendChange,
  trendSentence, zeroNote, defaultDate, dotStyle, hourFilters, hourInstant, isNight, longDate, monthGrid,
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

describe("the globe's table of cells", () => {
  const cell = (lat: number, lon: number, per_year: number) => ({ lat, lon, per_year });
  it("lists the cells that burn most a year first, as many as asked for", () => {
    const cells = [cell(1, 1, 5), cell(2, 2, 50), cell(3, 3, 20), cell(4, 4, 50)];
    expect(busiestCells(cells, 3).map((c) => c.lat)).toEqual([4, 2, 3]);
    expect(busiestCells(cells)).toHaveLength(4);
  });
  it("writes a change as a signed share, within the error as such, and a dash where nothing burned before", () => {
    expect(changeLabel(1.4, 0.14)).toBe("+40%");
    expect(changeLabel(0.5, 0.14)).toBe("−50%");
    expect(changeLabel(1.1, 0.14)).toBe("within the error");
    expect(changeLabel(null, 0.14)).toBe("–");
    expect(changeLabel(1.004, 0)).toBe("no change");
  });
});

describe("rampRgba", () => {
  const stops = [0, 10, 20];
  const colors = ["#000000", "#646464", "#ff0000"];

  it("is a stop's own colour at the stop", () => {
    expect(rampRgba(0, stops, colors)).toEqual([0, 0, 0, 1]);
    expect(rampRgba(10, stops, colors)).toEqual([100, 100, 100, 1]);
    expect(rampRgba(20, stops, colors)).toEqual([255, 0, 0, 1]);
  });
  it("mixes the two stops around a value", () => {
    // A quarter of the way from #000000 to #646464 (100), then halfway from #646464 to #ff0000.
    expect(rampRgba(2.5, stops, colors)).toEqual([25, 25, 25, 1]);
    expect(rampRgba(15, stops, colors)).toEqual([177.5, 50, 50, 1]);
  });
  it("keeps the first and the last colour outside the stops", () => {
    expect(rampRgba(-5, stops, colors)).toEqual([0, 0, 0, 1]);
    expect(rampRgba(99, stops, colors)).toEqual([255, 0, 0, 1]);
  });
});

describe("cellSurface", () => {
  // Two 1-degree cells side by side on the equator: red centred on (0, 0), blue on (1, 0).
  const red: Rgba = [200, 0, 0, 1];
  const blue: Rgba = [0, 0, 100, 1];
  const surface = cellSurface([{ lon: 0, lat: 0, color: red }, { lon: 1, lat: 0, color: blue }], 1);

  it("reaches one cell past the outermost centres", () => {
    expect(surface.bounds).toEqual([-1, -1, 2, 1]);
    expect([surface.columns, surface.rows]).toEqual([4, 3]);
  });
  it("has a cell's own colour at its centre", () => {
    expect(surface.at(0, 0)).toEqual(red);
    expect(surface.at(1, 0)).toEqual(blue);
  });
  it("mixes two neighbours by distance between their centres", () => {
    expect(surface.at(0.5, 0)).toEqual([100, 0, 50, 1]);
    expect(surface.at(0.25, 0)).toEqual([150, 0, 25, 1]);
  });
  it("fades out past the last cell without changing its colour: a quarter left at the cell's edge, gone one cell out", () => {
    // Half of the cell's opacity is mixed in at its edge, and the fade is the square of that.
    expect(surface.at(-0.5, 0)).toEqual([200, 0, 0, 0.25]);
    expect(surface.at(0, 0.5)).toEqual([200, 0, 0, 0.25]);
    expect(surface.at(-1, 0)).toEqual([0, 0, 0, 0]);
    expect(surface.at(0, 1)).toEqual([0, 0, 0, 0]);
  });
  it("is transparent outside its bounds", () => {
    expect(surface.at(-1.5, 0)).toEqual([0, 0, 0, 0]);
    expect(surface.at(0, 3)).toEqual([0, 0, 0, 0]);
  });
  it("weighs a faint colour less than a solid one beside it", () => {
    // Solid red next to grey at 0.5 opacity: halfway, the mixed opacity is 0.75 (shown as its square, 0.5625)
    // and red weighs twice the grey.
    const mixed = cellSurface([{ lon: 0, lat: 0, color: red }, { lon: 1, lat: 0, color: [150, 150, 150, 0.5] }], 1).at(0.5, 0);
    expect(mixed[3]).toBeCloseTo(0.5625, 6);
    expect(mixed[0]).toBeCloseTo((200 * 1 + 150 * 0.5) / 1.5, 4);
    expect(mixed[1]).toBeCloseTo((150 * 0.5) / 1.5, 4);
  });
});

describe("cellGroups", () => {
  const cell = (lon: number, lat: number) => ({ lon, lat });

  it("keeps cells that lie together in one group", () => {
    expect(cellGroups([cell(0, 0), cell(1, 0), cell(1, 1)])).toHaveLength(1);
  });
  it("splits where more than ten degrees of longitude hold no cell", () => {
    const groups = cellGroups([cell(30, 50), cell(-60, -30), cell(31, 49), cell(-61, -31)]);
    // West to east, and each group from south to north.
    expect(groups).toEqual([[cell(-61, -31), cell(-60, -30)], [cell(31, 49), cell(30, 50)]]);
  });
  it("splits a band of longitudes where more than ten degrees of latitude hold no cell", () => {
    // Two places on the same longitudes, 40 degrees of latitude apart.
    expect(cellGroups([cell(10, 50), cell(11, 10), cell(10, 11)])).toEqual([[cell(11, 10), cell(10, 11)], [cell(10, 50)]]);
  });
  it("does not split at a gap of exactly ten degrees", () => {
    expect(cellGroups([cell(0, 0), cell(10, 0)])).toHaveLength(1);
    expect(cellGroups([cell(0, 0), cell(10.25, 0)])).toHaveLength(2);
  });
  it("has no group without cells", () => {
    expect(cellGroups([])).toEqual([]);
  });
});

describe("cellSurface with the cells of every country", () => {
  it("takes more cells than a function call takes arguments", () => {
    // 200,000 cells in a row of 0.25 degrees: the world record at 0.25 degrees has 186,604.
    const many = Array.from({ length: 200_000 }, (_, i) => ({ lon: i * 0.25, lat: 0, color: [255, 0, 0, 1] as Rgba }));
    const surface = cellSurface(many, 0.25);
    expect(surface.columns).toBe(200_002); // one empty cell on each side
    expect(surface.bounds).toEqual([-0.25, -0.25, 50_000, 0.25]);
    expect(surface.at(49_999.75, 0)).toEqual([255, 0, 0, 1]);
  });
});

describe("cellImage", () => {
  const red: Rgba = [200, 0, 0, 1];
  const image = cellImage([{ lon: 0, lat: 0, color: red }, { lon: 1, lat: 0, color: [0, 0, 100, 1] }], 1, 4)!;

  it("has no image without cells", () => {
    expect(cellImage([], 1)).toBeNull();
  });
  it("covers the bounds of the surface with four pixels a cell across, and as many down as the Mercator shape asks", () => {
    expect(image.bounds).toEqual([-1, -1, 2, 1]);
    expect(image.width).toBe(12);
    // Three degrees wide, two degrees tall at the equator: two thirds as tall as wide.
    expect(image.height).toBe(8);
    expect(image.data).toHaveLength(12 * 8 * 4);
  });
  it("is transparent in its corners and coloured over the cells", () => {
    expect(image.data[3]).toBeLessThan(40);
    // Row 4 is centred an eighth of a degree south of the equator, column 4 on longitude 0.125. Across, red and
    // blue mix 7 to 1: 200 * 0.875 = 175. Down, an eighth of the way to the empty row: opacity 0.875, shown as
    // its square, 0.766 of 255 = 195.
    const at = (4 * 12 + 4) * 4;
    expect(image.data[at]).toBe(175);
    expect(image.data[at + 3]).toBe(195);
  });
  it("shrinks to fit the largest side it may have", () => {
    const small = cellImage([{ lon: 0, lat: 0, color: red }, { lon: 99, lat: 0, color: red }], 1, 4, 64)!;
    expect(small.width).toBe(64);
  });
  it("spaces its rows evenly in Mercator, so a tall image is taller than its degrees say", () => {
    // Cells at latitudes 0 and 60, one column: 2 degrees wide, 62 degrees tall. In Mercator the span from
    // -1 to 61 degrees is ln(tan(75.5 deg)) + 0.0175 = 1.3524 + 0.0175 = 1.370, over a width of 2 degrees,
    // 0.0349: 39.25 times as tall as wide, not 31. Eight pixels wide, so 314 tall.
    const tall = cellImage([{ lon: 0, lat: 0, color: red }, { lon: 0, lat: 60, color: red }], 1, 4)!;
    expect(tall.width).toBe(8);
    expect(tall.height).toBe(314);
  });
});

describe("why a figure reads zero", () => {
  const counts = (through: number[], inHour: number) => ({
    throughHour: through.reduce((a, b) => a + b, 0), inHour, day: 0,
    regions: through.map((n) => ({ throughHour: n, inHour: 0, day: n })),
  });
  it("names the regions with no hotspot yet and says a zero is no proof", () => {
    expect(zeroNote(["Argentina", "Ukraine"], counts([527, 0], 3), false)).toMatch(/^Ukraine: no hotspot seen yet\. .*not proof/);
  });
  it("explains an empty hour, or an empty day of a span", () => {
    expect(zeroNote(["Argentina"], counts([12], 0), false)).toMatch(/^None in the last hour/);
    expect(zeroNote(["Argentina"], counts([12], 0), true)).toMatch(/^None on that day/);
  });
  it("says nothing when no figure is zero, or when the whole day is (the panel says that itself)", () => {
    expect(zeroNote(["Argentina"], counts([12], 2), false)).toBeNull();
    expect(zeroNote(["Argentina"], counts([0], 0), false)).toBeNull();
  });
});
