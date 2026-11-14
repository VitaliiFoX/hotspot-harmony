import type { MultiPolygon, Polygon, Position } from 'geojson';

/** The only geometries the API accepts for an area of interest. */
export type AreaGeometry = Polygon | MultiPolygon;

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

/** Coordinates are kept to 5 decimals (about 1 m), far finer than the 0.25 degree grid. */
export const COORD_DECIMALS = 5;

export function roundCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS;
  // "+ 0" turns -0 into 0 so encoded text never contains "-0".
  return Math.round(value * f) / f + 0;
}

function finite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Rectangle polygon (counter-clockwise, closed) from west, south, east, north. */
export function bboxToPolygon(bbox: readonly number[]): Result<Polygon> {
  const [w, s, e, n] = bbox;
  if (
    bbox.length !== 4 ||
    w === undefined ||
    s === undefined ||
    e === undefined ||
    n === undefined ||
    !finite(w, s, e, n)
  ) {
    return { ok: false, error: 'Enter four numbers: west, south, east, north.' };
  }
  if (w < -180 || e > 180) {
    return { ok: false, error: 'Longitude must be between -180 and 180.' };
  }
  if (s < -90 || n > 90) {
    return { ok: false, error: 'Latitude must be between -90 and 90.' };
  }
  if (w >= e) return { ok: false, error: 'West must be smaller than east.' };
  if (s >= n) return { ok: false, error: 'South must be smaller than north.' };
  const [rw, rs, re, rn] = [w, s, e, n].map(roundCoord) as BBox;
  return {
    ok: true,
    value: {
      type: 'Polygon',
      coordinates: [
        [
          [rw, rs],
          [re, rs],
          [re, rn],
          [rw, rn],
          [rw, rs],
        ],
      ],
    },
  };
}

/** Point reached from (lat, lon) after `distanceKm` along `bearing` (radians) on a sphere. */
export function destinationPoint(
  lat: number,
  lon: number,
  distanceKm: number,
  bearing: number,
): Position {
  const d = distanceKm / EARTH_RADIUS_KM;
  const lat1 = lat * DEG;
  const lon1 = lon * DEG;
  const sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * sinLat2,
    );
  return [lon2 / DEG, lat2 / DEG];
}

/** Maximum radius accepted by the centre + radius form. */
export const MAX_RADIUS_KM = 2000;

/** Circle approximated by a closed, counter-clockwise polygon of `steps` vertices. */
export function circleToPolygon(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 64,
): Result<Polygon> {
  if (!finite(lat, lon, radiusKm)) {
    return { ok: false, error: 'Enter latitude, longitude and radius as numbers.' };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: 'Latitude must be between -90 and 90.' };
  }
  if (lon < -180 || lon > 180) {
    return { ok: false, error: 'Longitude must be between -180 and 180.' };
  }
  if (radiusKm <= 0) return { ok: false, error: 'Radius must be greater than 0 km.' };
  if (radiusKm > MAX_RADIUS_KM) {
    return { ok: false, error: `Radius must be at most ${MAX_RADIUS_KM} km.` };
  }
  const n = Math.max(8, Math.floor(steps));
  const ring: Position[] = [];
  for (let i = 0; i < n; i += 1) {
    // Bearings run clockwise from north, so step backwards for a counter-clockwise ring.
    const bearing = -(2 * Math.PI * i) / n;
    const [x, y] = destinationPoint(lat, lon, radiusKm, bearing) as [number, number];
    ring.push([roundCoord(x), roundCoord(y)]);
  }
  ring.push([...(ring[0] as Position)]);
  return { ok: true, value: { type: 'Polygon', coordinates: [ring] } };
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isRing(value: unknown): value is Position[] {
  return Array.isArray(value) && value.length >= 4 && value.every(isPosition);
}

function isPolygonCoords(value: unknown): value is Position[][] {
  return Array.isArray(value) && value.length >= 1 && value.every(isRing);
}

/** Structural check for a GeoJSON Polygon or MultiPolygon. */
export function isAreaGeometry(value: unknown): value is AreaGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  if (g.type === 'Polygon') return isPolygonCoords(g.coordinates);
  if (g.type === 'MultiPolygon') {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length >= 1 &&
      g.coordinates.every(isPolygonCoords)
    );
  }
  return false;
}

/** All polygons of a geometry as arrays of rings. */
export function polygonsOf(geometry: AreaGeometry): Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

export function geometryBBox(geometry: AreaGeometry): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const polygon of polygonsOf(geometry)) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x === undefined || y === undefined) continue;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    inner[0] >= outer[0] && inner[2] <= outer[2] && inner[1] >= outer[1] && inner[3] <= outer[3]
  );
}

export type Coverage = 'inside' | 'partial' | 'outside';

/**
 * Rough client-side check of an area against the bounding boxes that have data.
 * Based on bounding boxes only, so it is a hint for the user, not the final word:
 * the API decides which grid cells are actually used.
 */
export function coverageOf(geometry: AreaGeometry, dataBoxes: readonly BBox[]): Coverage {
  const box = geometryBBox(geometry);
  if (dataBoxes.some((d) => bboxContains(d, box))) return 'inside';
  if (dataBoxes.some((d) => bboxIntersects(d, box))) return 'partial';
  return 'outside';
}

function ringAreaKm2(ring: Position[]): number {
  // Spherical excess approximation (Chamberlain & Duquette), signed.
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i] as [number, number];
    const [x2, y2] = ring[i + 1] as [number, number];
    total += (x2 - x1) * DEG * (2 + Math.sin(y1 * DEG) + Math.sin(y2 * DEG));
  }
  return (total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2;
}

/** Approximate area in square kilometres (outer rings minus holes). */
export function geometryAreaKm2(geometry: AreaGeometry): number {
  let area = 0;
  for (const polygon of polygonsOf(geometry)) {
    polygon.forEach((ring, index) => {
      const a = Math.abs(ringAreaKm2(ring));
      area += index === 0 ? a : -a;
    });
  }
  return Math.max(0, area);
}

/** True for a polygon with a single ring: the only shape the map editor can hold. */
export function isSimplePolygon(geometry: AreaGeometry): geometry is Polygon {
  return geometry.type === 'Polygon' && geometry.coordinates.length === 1;
}

/** Copy of a geometry with every coordinate rounded to COORD_DECIMALS and rings closed. */
export function normalizeGeometry(geometry: AreaGeometry): AreaGeometry {
  const fixRing = (ring: Position[]): Position[] => {
    const out = ring.map(([x, y]) => [roundCoord(x as number), roundCoord(y as number)]);
    const first = out[0] as Position;
    const last = out[out.length - 1] as Position;
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([...first]);
    return out;
  };
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(fixRing) };
  }
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) => polygon.map(fixRing)),
  };
}
