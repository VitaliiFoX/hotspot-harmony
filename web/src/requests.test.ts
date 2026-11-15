import { describe, expect, it } from "vitest";
import type { Calendar } from "./api";
import { CalendarCache, type CalendarBody, type View, delayFor, otherSeries, requestKey, TYPING_PAUSE_MS } from "./requests";

const view: View = { region: "Ukraine", box: ["22", "44", "40.3", "52.5"], start: "2000-11", end: "2025-12", series: "harmonized" };
const body = (series: "raw" | "harmonized", west = 22): CalendarBody => ({
  geometry: { type: "Polygon", coordinates: [[[west, 44], [40.3, 44], [40.3, 52.5], [west, 52.5], [west, 44]]] },
  start: "2000-11",
  end: "2025-12",
  series,
});
const answer = (tag: number) => ({ cells_used: tag }) as unknown as Calendar;

describe("delayFor", () => {
  it("does not wait on the first load", () => {
    expect(delayFor(null, view)).toBe(0);
  });

  it("waits while the box is typed", () => {
    expect(delayFor(view, { ...view, box: ["22", "44", "40.3", "5"] })).toBe(TYPING_PAUSE_MS);
  });

  it("does not wait for a region, a date or a record switch", () => {
    expect(delayFor(view, { ...view, region: "Argentina", box: ["-73.6", "-55.1", "-53.6", "-21.7"] })).toBe(0);
    expect(delayFor(view, { ...view, start: "2010-01" })).toBe(0);
    expect(delayFor(view, { ...view, end: "2020-12" })).toBe(0);
    expect(delayFor(view, { ...view, series: "raw" })).toBe(0);
  });

  it("does not wait for an area drawn on the globe, whose bounds replace the box", () => {
    const drawn = { ...view, box: ["30", "50", "32", "51.5"], area: [[30, 50], [32, 50], [31, 51.5]] };
    expect(delayFor(view, drawn)).toBe(0);
    expect(delayFor(drawn, { ...drawn, box: ["30", "50", "33", "51.5"], area: [[30, 50], [33, 50], [31, 51.5]] })).toBe(0);
  });

  it("does not wait when the drawn area is removed and the box goes back to the region's", () => {
    // The box fields are read-only while an area is drawn, so it goes away by a button, never by typing.
    const drawn = { ...view, box: ["30", "50", "32", "51.5"], area: [[30, 50], [32, 50], [31, 51.5]] };
    expect(delayFor(drawn, { ...view, area: null })).toBe(0);
  });

  it("does not wait for a country picked on the globe, or for the box that comes back when it is let go", () => {
    // The box fields are read-only while a country is picked, as with a drawn area.
    const picked = { ...view, box: ["22.13", "44.38", "40.16", "52.37"], country: "Ukraine" };
    expect(delayFor(view, picked)).toBe(0);
    expect(delayFor(picked, { ...picked, region: "Argentina", box: ["-73.57", "-55.05", "-53.66", "-21.79"], country: "Argentina" })).toBe(0);
    expect(delayFor(picked, { ...view, country: null })).toBe(0);
  });

  it("waits again for the box typed once the drawn area is gone", () => {
    const removed = { ...view, area: null };
    expect(delayFor(removed, { ...removed, box: ["22", "44", "40.3", "5"] })).toBe(TYPING_PAUSE_MS);
  });

  it("does not wait when nothing changed", () => {
    expect(delayFor(view, { ...view })).toBe(0);
  });
});

describe("requestKey", () => {
  it("tells apart the record, the dates and the area", () => {
    const keys = [body("harmonized"), body("raw"), body("harmonized", 23), { ...body("harmonized"), start: "2010-01" }].map((b) =>
      requestKey(b),
    );
    expect(new Set(keys).size).toBe(4);
    expect(requestKey(body("raw"))).toBe(requestKey(body("raw")));
  });

  it("uses a cheap area key when given instead of stringifying a large border", () => {
    const withBrokenCoords = {
      ...body("harmonized"),
      geometry: {
        type: "Polygon" as const,
        get coordinates(): number[][][] {
          throw new Error("should not stringify coordinates when areaKey is given");
        },
      },
    };
    expect(requestKey(withBrokenCoords, "country:Ukraine")).toBe("harmonized|2000-11|2025-12|country:Ukraine");
    const cache = new CalendarCache();
    cache.set(withBrokenCoords, answer(7), "country:Ukraine");
    expect(cache.get(withBrokenCoords, "country:Ukraine")).toEqual(answer(7));
    expect(cache.get(withBrokenCoords, "country:Argentina")).toBeUndefined();
  });
});

describe("otherSeries", () => {
  it("names the record that is not shown", () => {
    expect(otherSeries("harmonized", ["raw", "harmonized"])).toBe("raw");
    expect(otherSeries("raw", ["raw", "harmonized"])).toBe("harmonized");
  });

  it("is null when the API serves one record only", () => {
    expect(otherSeries("raw", ["raw"])).toBeNull();
  });
});

describe("CalendarCache", () => {
  it("returns what was stored for the same request and nothing for another", () => {
    const cache = new CalendarCache();
    cache.set(body("harmonized"), answer(1));
    expect(cache.get(body("harmonized"))).toEqual(answer(1));
    expect(cache.get(body("raw"))).toBeUndefined();
  });

  it("drops the oldest answer past its limit and keeps a refreshed one", () => {
    const cache = new CalendarCache(2);
    cache.set(body("harmonized", 1), answer(1));
    cache.set(body("harmonized", 2), answer(2));
    cache.set(body("harmonized", 1), answer(11)); // refreshed: now the newest
    cache.set(body("harmonized", 3), answer(3));
    expect(cache.get(body("harmonized", 2))).toBeUndefined();
    expect(cache.get(body("harmonized", 1))).toEqual(answer(11));
    expect(cache.get(body("harmonized", 3))).toEqual(answer(3));
  });
});
