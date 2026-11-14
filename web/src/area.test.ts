import { describe, expect, it } from "vitest";
import type { Region } from "./api";
import {
  type Corner, areaProblem, boundsText, boxCorners, cornersBounds, cornersPolygon, cornersWkt, crossesItself, densifyRing, formatAreaParam,
  parseAreaParam, regionOfArea, roundCorner,
} from "./area";

const triangle: Corner[] = [[30, 50], [32, 50], [31, 51.5]];
const square: Corner[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
// The same four corners visited in an order that makes a bow tie: sides 0-1 and 2-3 cross at (2, 2).
const bowTie: Corner[] = [[0, 0], [4, 4], [4, 0], [0, 4]];

describe("roundCorner", () => {
  it("keeps four decimals of a degree", () => {
    expect(roundCorner([30.123456, -50.987654])).toEqual([30.1235, -50.9877]);
  });
});

describe("cornersPolygon", () => {
  it("closes the ring on its first corner, longitude first", () => {
    expect(cornersPolygon(triangle)).toEqual({
      type: "Polygon",
      coordinates: [[[30, 50], [32, 50], [31, 51.5], [30, 50]]],
    });
  });
});

describe("cornersBounds", () => {
  it("is west, south, east, north", () => {
    expect(cornersBounds(triangle)).toEqual([30, 50, 32, 51.5]);
  });
  it("is shown in the box fields with two decimals", () => {
    expect(boundsText([[26.5206, 46.2077], [33.9651, 50.5296], [30, 47]])).toEqual(["26.52", "46.21", "33.97", "50.53"]);
  });
});

describe("crossesItself", () => {
  it("is false for a triangle, a square and a dented outline", () => {
    expect(crossesItself(triangle)).toBe(false);
    expect(crossesItself(square)).toBe(false);
    expect(crossesItself([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]])).toBe(false);
  });
  it("is true for a bow tie", () => {
    expect(crossesItself(bowTie)).toBe(true);
  });
  it("is true when a corner lands on a side that is not its neighbour", () => {
    expect(crossesItself([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]])).toBe(true);
  });
});

describe("areaProblem", () => {
  it("accepts a triangle", () => {
    expect(areaProblem(triangle)).toBeNull();
  });
  it("asks for three corners", () => {
    expect(areaProblem([[30, 50], [32, 50]])).toBe("An area needs at least three corners.");
  });
  it("rejects corners on one line", () => {
    expect(areaProblem([[0, 0], [1, 1], [2, 2]])).toBe("The corners lie on one line, so the area is empty.");
  });
  it("rejects an outline that crosses itself", () => {
    expect(areaProblem(bowTie)).toMatch(/crosses itself/);
  });
  it("rejects a corner off the map", () => {
    expect(areaProblem([[30, 50], [181, 50], [31, 51]])).toBe("The area is off the map.");
    expect(areaProblem([[30, 50], [32, Number.NaN], [31, 51]])).toBe("The area is off the map.");
  });
});

describe("the area in the address", () => {
  it("is written as lon,lat pairs and read back the same", () => {
    expect(formatAreaParam(triangle)).toBe("30,50;32,50;31,51.5");
    expect(parseAreaParam("30,50;32,50;31,51.5")).toEqual(triangle);
    expect(parseAreaParam("-64.5,-31.25;-63,-31.25;-63.75,-30")).toEqual([[-64.5, -31.25], [-63, -31.25], [-63.75, -30]]);
  });
  it("is null when missing, malformed or not a usable area", () => {
    expect(parseAreaParam(null)).toBeNull();
    expect(parseAreaParam("")).toBeNull();
    expect(parseAreaParam("30,50;32,50")).toBeNull();
    expect(parseAreaParam("30,50;32;31,51.5")).toBeNull();
    expect(parseAreaParam("30,50;32,;31,51.5")).toBeNull();
    expect(parseAreaParam("30,50;x,50;31,51.5")).toBeNull();
    expect(parseAreaParam("0,0;4,4;4,0;0,4")).toBeNull();
  });
});

describe("densifyRing", () => {
  it("closes the ring and leaves short sides alone", () => {
    expect(densifyRing([[0, 0], [0.5, 0], [0, 0.5]], 0.5)).toEqual([[0, 0], [0.5, 0], [0, 0.5], [0, 0]]);
  });
  it("splits a long side into equal steps on the straight line between its ends", () => {
    // The side from (0, 0) to (2, 1) is cut in 4 by its longer extent, 2 degrees at 0.5 a step.
    const ring = densifyRing([[0, 0], [2, 1], [0, 1]], 0.5);
    expect(ring.slice(0, 5)).toEqual([[0, 0], [0.5, 0.25], [1, 0.5], [1.5, 0.75], [2, 1]]);
    expect(ring.at(-1)).toEqual([0, 0]);
    // 4 pieces + 4 pieces (2 degrees back along the top) + 2 pieces (1 degree down) + the closing point
    expect(ring).toHaveLength(4 + 4 + 2 + 1);
  });
});

describe("regionOfArea", () => {
  const regions: Region[] = [
    { name: "Argentina", bbox: [-73.6, -55.1, -53.6, -21.7] },
    { name: "Ukraine", bbox: [22, 44, 40.3, 52.5] },
  ];
  it("is the region whose box holds the middle of the area", () => {
    expect(regionOfArea(regions, triangle)?.name).toBe("Ukraine");
    expect(regionOfArea(regions, [[-64.5, -31.25], [-63, -31.25], [-63.75, -30]])?.name).toBe("Argentina");
  });
  it("falls back to a corner inside a box when the middle is outside every box", () => {
    // Bounds 10..24 by 46..50: the middle (17, 48) is west of Ukraine, the corner (24, 48) is inside it.
    expect(regionOfArea(regions, [[10, 46], [24, 48], [10, 50]])?.name).toBe("Ukraine");
  });
  it("is null when the area touches no region", () => {
    expect(regionOfArea(regions, [[0, 0], [1, 0], [0, 1]])).toBeNull();
  });
});

describe("cornersWkt", () => {
  it("writes a closed ring, longitude first", () => {
    expect(cornersWkt(triangle)).toBe("POLYGON ((30 50, 32 50, 31 51.5, 30 50))");
  });
  it("writes a box from its four corners", () => {
    expect(cornersWkt(boxCorners([22, 44, 40.3, 52.5]))).toBe("POLYGON ((22 44, 40.3 44, 40.3 52.5, 22 52.5, 22 44))");
  });
});
