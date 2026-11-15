import { describe, expect, it } from "vitest";
import type { Region } from "./api";
import {
  DOUBLE_TAP_MS, DOUBLE_TAP_PX, countryAt, countryBoxText, findCountry, insideCountry, isDoubleTap, namesCountry, readCountries,
  regionOfCountry,
} from "./countries";

// Two made-up countries on a small map:
//   Ringland  a 10 x 10 square from (0, 0) with a 2 x 2 hole at (4, 4), and an island, the square (20, 0)-(22, 2)
//   Holia     the 2 x 2 square that fills Ringland's hole
const square = (west: number, south: number, east: number, north: number) => [
  [west, south], [east, south], [east, north], [west, north], [west, south],
];
const countries = readCountries({
  features: [
    {
      properties: { name: "Ringland", aliases: ["Ring Land", "Rep. of Ringland"], iso: "RNG", view: [0, 0, 10, 10] },
      geometry: { type: "MultiPolygon", coordinates: [[square(0, 0, 10, 10), square(4, 4, 6, 6)], [square(20, 0, 22, 2)]] },
    },
    {
      properties: { name: "Holia", iso: "HOL", view: [4, 4, 6, 6] },
      geometry: { type: "MultiPolygon", coordinates: [[square(4, 4, 6, 6)]] },
    },
  ],
});
const [ringland, holia] = countries;

describe("readCountries", () => {
  it("keeps the names and works out the bounds of the whole border and of each part", () => {
    expect(ringland.name).toBe("Ringland");
    expect(ringland.aliases).toEqual(["Ring Land", "Rep. of Ringland"]);
    expect(ringland.bbox).toEqual([0, 0, 22, 10]);
    expect(ringland.partBounds).toEqual([[0, 0, 10, 10], [20, 0, 22, 2]]);
    expect(ringland.view).toEqual([0, 0, 10, 10]);
    expect(holia.aliases).toEqual([]);
  });
});

describe("countryAt", () => {
  it("finds the country under a point", () => {
    expect(countryAt(countries, 1, 1)?.name).toBe("Ringland");
    expect(countryAt(countries, 9.5, 9.5)?.name).toBe("Ringland");
  });

  it("finds a country on its island", () => {
    expect(countryAt(countries, 21, 1)?.name).toBe("Ringland");
  });

  it("gives a hole to the country that fills it", () => {
    expect(insideCountry(ringland, 5, 5)).toBe(false);
    expect(countryAt(countries, 5, 5)?.name).toBe("Holia");
  });

  it("finds nothing over the sea, between the mainland and the island included", () => {
    expect(countryAt(countries, 15, 1)).toBeNull();
    expect(countryAt(countries, -1, 5)).toBeNull();
    expect(countryAt(countries, 21, 5)).toBeNull();
  });
});

describe("namesCountry and findCountry", () => {
  it("matches the name, an alias or the code, whatever the case, the spaces and the underscores", () => {
    expect(namesCountry("ringland", ringland)).toBe(true);
    expect(namesCountry("Ring_Land", ringland)).toBe(true);
    expect(namesCountry("rep of ringland", ringland)).toBe(true);
    expect(namesCountry("RNG", ringland)).toBe(true);
    expect(namesCountry("Holia", ringland)).toBe(false);
    expect(namesCountry("", ringland)).toBe(false);
  });

  it("finds a country by what the address carries", () => {
    expect(findCountry(countries, "Holia")).toBe(holia);
    expect(findCountry(countries, "Atlantis")).toBeNull();
    expect(findCountry(countries, null)).toBeNull();
  });
});

describe("regionOfCountry", () => {
  const ringRegion: Region = { name: "Ring_Land", bbox: [0, 0, 22, 10] };
  const world: Region = { name: "World", bbox: [-180, -90, 180, 90] };

  it("is the region named after the country", () => {
    expect(regionOfCountry([ringRegion], ringland)).toBe(ringRegion);
  });

  it("is null for a country that only lies inside another region's box", () => {
    // Holia is wholly inside the box of the Ringland region, and the record has none of its hotspots.
    expect(regionOfCountry([ringRegion], holia)).toBeNull();
  });

  it("is the region that spans the globe when the whole world is loaded", () => {
    expect(regionOfCountry([world], holia)).toBe(world);
    expect(regionOfCountry([world, ringRegion], ringland)).toBe(ringRegion);
  });
});

describe("countryBoxText", () => {
  it("writes the bounds as the box fields show them", () => {
    expect(countryBoxText(ringland)).toEqual(["0", "0", "22", "10"]);
    expect(countryBoxText({ ...ringland, bbox: [22.134, 44.379, 40.16, 52.368] })).toEqual(["22.13", "44.38", "40.16", "52.37"]);
  });
});

describe("isDoubleTap", () => {
  const first = { time: 1000, x: 100, y: 100 };

  it("is not one without a first tap", () => {
    expect(isDoubleTap(null, first)).toBe(false);
  });

  it("takes a second tap soon after and close by", () => {
    expect(isDoubleTap(first, { time: 1200, x: 104, y: 97 })).toBe(true);
    expect(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS, x: 100 + DOUBLE_TAP_PX, y: 100 })).toBe(true);
  });

  it("refuses a second tap that comes too late", () => {
    expect(isDoubleTap(first, { time: 1001 + DOUBLE_TAP_MS, x: 100, y: 100 })).toBe(false);
  });

  it("refuses a second tap somewhere else", () => {
    // 3-4-5 triangle scaled by 7: 21 across and 28 down are 35 px away.
    expect(isDoubleTap(first, { time: 1100, x: 121, y: 128 })).toBe(false);
  });
});
