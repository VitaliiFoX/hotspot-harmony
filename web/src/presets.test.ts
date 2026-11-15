import { describe, expect, it } from "vitest";
import { areaProblem, cornersBounds } from "./area";
import { PRESETS, presetHref } from "./presets";

// config/regions.yaml: Ukraine's box, west, south, east, north.
const UKRAINE = [22.0, 44.0, 40.3, 52.5];

describe("PRESETS", () => {
  it("are valid areas inside the box of their region", () => {
    for (const preset of PRESETS) {
      expect(preset.region).toBe("Ukraine");
      expect(areaProblem(preset.area)).toBeNull();
      const [west, south, east, north] = cornersBounds(preset.area);
      expect(west >= UKRAINE[0] && south >= UKRAINE[1] && east <= UKRAINE[2] && north <= UKRAINE[3]).toBe(true);
    }
  });
});

describe("presetHref", () => {
  const chornobyl = PRESETS[0];
  it("is a link to the region, the drawn area, the end of the period and the day on the globe", () => {
    expect(presetHref(chornobyl, new URLSearchParams())).toBe(
      "?region=Ukraine&area=29.2,50.9;30.9,50.9;30.9,51.6;29.2,51.6&end=2020-12&date=2020-04-08&time=23:59",
    );
  });
  it("keeps the theme the page is in, and nothing else of the current view", () => {
    const current = new URLSearchParams("theme=dark&region=Argentina&box=1,2,3,4&date=2025-08-20");
    expect(presetHref(chornobyl, current)).toBe(
      "?theme=dark&region=Ukraine&area=29.2,50.9;30.9,50.9;30.9,51.6;29.2,51.6&end=2020-12&date=2020-04-08&time=23:59",
    );
  });
});
