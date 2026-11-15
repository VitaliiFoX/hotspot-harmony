// Pure logic of picking a country on the globe: which country is under a point, whether the record has it,
// and when two taps are one double tap. The borders are web/public/countries.geojson, written by
// scripts/build_countries.py from Natural Earth.

import type { Bbox, MultiPolygon, Region } from "./api";

/** One closed ring of a border: [longitude, latitude] pairs, degrees. */
type Ring = number[][];

/** Default border edition when a GeoJSON fixture omits top-level `source`. */
export const BORDER_SOURCE = "Natural Earth 10m _ukr v5.1.2";

export type Country = {
  /** The Natural Earth name, e.g. "United States of America". It is what the address carries as `&country=`. */
  name: string;
  /** Its other Natural Earth names, e.g. "United States". */
  aliases: string[];
  /** Three-letter Natural Earth code (ADM0_A3). */
  iso: string;
  /** Border edition name carried by the GeoJSON collection. */
  source: string;
  /** West, south, east, north of the whole border, overseas parts included. */
  bbox: Bbox;
  /** West, south, east, north worth flying to: the mainland, without far and small parts. */
  view: Bbox;
  geometry: MultiPolygon;
  /** The bounds of each polygon of `geometry`, in the same order: a quick test before the exact one. */
  partBounds: Bbox[];
};

type CountryFeature = {
  properties: { name: string; aliases?: string[]; iso: string; view: number[] };
  geometry: MultiPolygon;
};

function ringBounds(ring: Ring): Bbox {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

/** The countries of a GeoJSON collection written by scripts/build_countries.py. */
export function readCountries(collection: { source?: string; features: CountryFeature[] }): Country[] {
  const source = collection.source ?? BORDER_SOURCE;
  return collection.features.map(({ properties, geometry }) => {
    // The first ring of a polygon is its outside; the bounds of the outside are the bounds of the polygon.
    const partBounds = geometry.coordinates.map((polygon) => ringBounds(polygon[0]));
    const bbox: Bbox = [
      Math.min(...partBounds.map((b) => b[0])),
      Math.min(...partBounds.map((b) => b[1])),
      Math.max(...partBounds.map((b) => b[2])),
      Math.max(...partBounds.map((b) => b[3])),
    ];
    return {
      name: properties.name,
      aliases: properties.aliases ?? [],
      iso: properties.iso,
      source,
      bbox,
      view: properties.view.length === 4 ? (properties.view as Bbox) : bbox,
      geometry,
      partBounds,
    };
  });
}

/** Whether a ray from the point to the east crosses the ring an odd number of times. */
function crossesOdd(ring: Ring, lon: number, lat: number): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if (y1 > lat !== y2 > lat && lon < x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)) odd = !odd;
  }
  return odd;
}

/** Whether the point is inside the country: inside the outside ring of one of its polygons and in none of its holes. */
export function insideCountry(country: Country, lon: number, lat: number): boolean {
  return country.geometry.coordinates.some((polygon, index) => {
    const [west, south, east, north] = country.partBounds[index];
    if (lon < west || lon > east || lat < south || lat > north) return false;
    // Even-odd over all rings: a point in a hole crosses the outside ring and the hole, an even count.
    return polygon.reduce((odd, ring) => (crossesOdd(ring, lon, lat) ? !odd : odd), false);
  });
}

/** The country under a point, or null over the sea. Where two simplified borders overlap, the first in the list. */
export function countryAt(countries: readonly Country[], lon: number, lat: number): Country | null {
  return countries.find((country) => insideCountry(country, lon, lat)) ?? null;
}

/** A name without case, spaces, underscores or punctuation: "United_States" and "United States" are the same. */
function plain(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Whether `name` names the country: by its name, one of its aliases or its three-letter code. */
export function namesCountry(name: string, country: Country): boolean {
  const wanted = plain(name);
  return wanted !== "" && [country.name, ...country.aliases, country.iso].some((known) => plain(known) === wanted);
}

export function findCountry(countries: readonly Country[], name: string | null): Country | null {
  if (!name) return null;
  return countries.find((country) => namesCountry(name, country)) ?? null;
}

function coversWorld([west, south, east, north]: Bbox): boolean {
  return west <= -180 && south <= -90 && east >= 180 && north >= 90;
}

/**
 * The region whose record holds the country, or null when no data is loaded for it: the region named after
 * the country, else a region that spans the whole globe (config/world.yaml). A region's box alone is no
 * proof: the box of Ukraine holds all of Moldova, and the record has none of Moldova's hotspots.
 */
export function regionOfCountry(regions: readonly Region[], country: Country): Region | null {
  return regions.find((region) => namesCountry(region.name, country)) ?? regions.find((region) => coversWorld(region.bbox)) ?? null;
}

/** The bounds as the box fields show them: two decimals, enough to read where the country is. */
export function countryBoxText(country: Country): [string, string, string, string] {
  return country.bbox.map((value) => String(Math.round(value * 100) / 100)) as [string, string, string, string];
}

/** A click or a tap on the map: when, in milliseconds, and where, in pixels. */
export type Tap = { time: number; x: number; y: number; fromCell?: boolean; hadArea?: boolean };

/** Longer than the gap between the two clicks of a double-click on every common system setting. */
export const DOUBLE_TAP_MS = 500;
/** A finger does not land twice on the same pixel; a second tap further away than this is another place. */
export const DOUBLE_TAP_PX = 30;

/** Whether `next` is the second tap of a double tap that `previous` began. */
export function isDoubleTap(previous: Tap | null, next: Tap): boolean {
  if (!previous) return false;
  const gap = next.time - previous.time;
  return gap >= 0 && gap <= DOUBLE_TAP_MS && Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_PX;
}

export type TapDecision = { kind: "pick-country" | "pick-cell" | "wait"; nextTap: Tap | null };

/**
 * Decide what a click on the globe does:
 * - A double tap picks the country under it, taking priority over a "Where it burns" cell click.
 * - While a drawn area is already set (and was not just created by the first tap's cell click), a double tap is
 *   ignored so zooming/clicking inside a drawn polygon does not silently replace it with the whole country.
 */
export function resolveTap(
  previous: Tap | null,
  next: { time: number; x: number; y: number; hasCell: boolean; hasArea: boolean },
): TapDecision {
  const double = isDoubleTap(previous, next);
  if (double && (!previous?.hadArea || previous?.fromCell)) {
    return { kind: "pick-country", nextTap: null };
  }
  const nextTap: Tap | null = double
    ? null
    : { time: next.time, x: next.x, y: next.y, fromCell: next.hasCell, hadArea: next.hasArea };
  return { kind: next.hasCell ? "pick-cell" : "wait", nextTap };
}

/** Download the borders. They are a static file of the web app, not an answer of the API. */
export async function fetchCountries(signal?: AbortSignal): Promise<Country[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}countries.geojson`, { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return readCountries(await response.json());
}

/** One line of the region search: a region of the record, or a country picked by its border. */
export type Place = {
  name: string;
  /** A region is taken by its box, as the region list always did; a country by its border. */
  kind: "region" | "country";
  /** False for a country no record is loaded for: picking it shows the "No record yet" card. */
  hasData: boolean;
};

/**
 * What the region search lists for the typed text: the regions first, in the order of the config, then the
 * countries that are not a region, those whose name starts with the text before those that only hold it,
 * each group by name. A country matches by its name, an alias or its code. With no text everything is listed.
 * `shown` gives the name the page writes for a place in its language, so that it is found by that name too.
 */
export function searchPlaces(
  regions: readonly Region[],
  countries: readonly Country[],
  query: string,
  shown: (name: string) => string = (name) => name,
): Place[] {
  const wanted = plain(query);
  const rank = (names: string[]): number => {
    if (wanted === "") return 0;
    const plains = names.map(plain);
    if (plains.some((name) => name.startsWith(wanted))) return 0;
    return plains.some((name) => name.includes(wanted)) ? 1 : -1;
  };
  const places: Place[] = regions
    .filter((region) => rank([region.name, shown(region.name)]) >= 0)
    .map((region) => ({ name: region.name, kind: "region", hasData: true }));
  const others = countries
    .filter((country) => !regions.some((region) => namesCountry(region.name, country)))
    .map((country) => ({ country, rank: rank([country.name, shown(country.name), ...country.aliases, country.iso]) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name, "en"));
  for (const { country } of others) {
    places.push({ name: country.name, kind: "country", hasData: regionOfCountry(regions, country) !== null });
  }
  return places;
}
