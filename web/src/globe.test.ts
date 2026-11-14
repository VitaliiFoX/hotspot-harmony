import { describe, expect, it } from "vitest";
import type { DayHotspot, Region } from "./api";
import {
  MERCATOR_LIMIT, countHotspots, dayKey, defaultDate, dotStyle, hourFilters, hourInstant, isNight, longDate, monthGrid,
  moveToMonth, nightPolygon, terminatorLine, parseDateParam, parseHourParam, regionAt, regionsCenter, sensorLabel, shiftMonth, subsolarPoint,
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
  it("takes whole hours 0 to 23 only", () => {
    expect(parseHourParam("18")).toBe(18);
    expect(parseHourParam("0")).toBe(0);
    expect(parseHourParam("07")).toBe(7);
    expect(parseHourParam("24")).toBeNull();
    expect(parseHourParam("-1")).toBeNull();
    expect(parseHourParam("1.5")).toBeNull();
    expect(parseHourParam("")).toBeNull();
    expect(parseHourParam(null)).toBeNull();
  });
  it("opens on the preferred day when the record covers it, else on its last day", () => {
    expect(defaultDate("2000-11-01", "2025-12-31")).toBe("2025-08-20");
    expect(defaultDate("2000-11-01", "2025-06-30")).toBe("2025-06-30");
  });
});

describe("countHotspots", () => {
  // Selected hour 18 runs from minute 1080 to 1139.
  const hotspots: DayHotspot[] = [
    [0, 0, 0, 0],
    [0, 0, 1079, 1],
    [0, 0, 1080, 0],
    [0, 0, 1139, 0],
    [0, 0, 1140, 1],
    [0, 0, 1200, 5], // a region index the response does not list counts in the total only
  ];
  it("counts through the hour, in the hour and over the day", () => {
    const counts = countHotspots(hotspots, 18, 2);
    expect([counts.throughHour, counts.inHour, counts.day]).toEqual([4, 2, 6]);
  });
  it("counts each region apart", () => {
    expect(countHotspots(hotspots, 18, 2).regions).toEqual([
      { throughHour: 3, inHour: 2, day: 3 },
      { throughHour: 1, inHour: 0, day: 2 },
    ]);
  });
  it("sees only the first hour at hour 0 and everything at hour 23", () => {
    expect(countHotspots(hotspots, 0, 2).throughHour).toBe(1);
    expect(countHotspots(hotspots, 23, 2).throughHour).toBe(6);
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
  it("cuts at the end of the hour and marks the hour itself", () => {
    expect(hourFilters(18)).toEqual({
      through: ["<", ["get", "minute"], 1140],
      inHour: ["all", [">=", ["get", "minute"], 1080], ["<", ["get", "minute"], 1140]],
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
  it("is taken at the middle of the selected hour", () => {
    expect(hourInstant("2025-08-20", 18)).toBe(Date.UTC(2025, 7, 20, 18, 30));
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
