// Pure logic of an area of interest drawn on the globe: its corners, its checks and its place in the address.

import type { Bbox, Polygon, Region } from "./api";
import { regionAt } from "./globe";

/** One corner of a drawn area: longitude, latitude, degrees. */
export type Corner = [lon: number, lat: number];

/** A link can carry a drawn area; past this many corners it is not read. */
export const MAX_CORNERS = 200;

/** Four decimals of a degree are about 11 m: finer than a 1 km cell, short enough for a link. */
export function roundCorner([lon, lat]: Corner): Corner {
  return [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4];
}

/** The four corners of a box, anticlockwise from the south-west. */
export function boxCorners([west, south, east, north]: Bbox): Corner[] {
  return [[west, south], [east, south], [east, north], [west, north]];
}

/** The corners as a GeoJSON polygon, longitude first, with the ring closed. */
export function cornersPolygon(corners: readonly Corner[]): Polygon {
  const ring = corners.map((corner) => [...corner]);
  return { type: "Polygon", coordinates: [[...ring, [...corners[0]]]] };
}

/** West, south, east, north of the corners. */
export function cornersBounds(corners: readonly Corner[]): Bbox {
  const lons = corners.map(([lon]) => lon);
  const lats = corners.map(([, lat]) => lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** The bounds as the box fields show them: two decimals, enough to read where the area is. */
export function boundsText(corners: readonly Corner[]): [string, string, string, string] {
  return cornersBounds(corners).map((value) => String(Math.round(value * 100) / 100)) as [string, string, string, string];
}

/** Twice the signed area of the corners on the longitude-latitude plane (the shoelace sum). */
function shoelace(corners: readonly Corner[]): number {
  let sum = 0;
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

function turn(a: Corner, b: Corner, c: Corner): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

function within(a: Corner, b: Corner, p: Corner): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  );
}

/** Whether two segments share a point, an end touching the other segment included. */
function segmentsMeet(a: Corner, b: Corner, c: Corner, d: Corner): boolean {
  const [t1, t2, t3, t4] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)];
  if (t1 !== t2 && t3 !== t4) return true;
  return (
    (t1 === 0 && within(a, b, c)) || (t2 === 0 && within(a, b, d)) || (t3 === 0 && within(c, d, a)) || (t4 === 0 && within(c, d, b))
  );
}

/** Whether two sides that are not neighbours cross or touch, which makes the area ambiguous. */
export function crossesItself(corners: readonly Corner[]): boolean {
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the last side closes onto the first: they are neighbours
      if (segmentsMeet(corners[i], corners[(i + 1) % n], corners[j], corners[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Why the corners cannot be used as an area of interest, or null when they can. */
export function areaProblem(corners: readonly Corner[]): string | null {
  if (corners.length < 3) return "An area needs at least three corners.";
  if (corners.length > MAX_CORNERS) return `An area can have at most ${MAX_CORNERS} corners.`;
  if (corners.some(([lon, lat]) => !(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90))) return "The area is off the map.";
  // Crossing first: the two halves of a symmetric bow tie cancel to a zero sum, and it is not a line.
  if (crossesItself(corners)) return "The outline crosses itself. Remove the last corner or start again.";
  if (shoelace(corners) === 0) return "The corners lie on one line, so the area is empty.";
  return null;
}

/** The corners as they are written in the address: "lon,lat;lon,lat;...". */
export function formatAreaParam(corners: readonly Corner[]): string {
  return corners.map(([lon, lat]) => `${lon},${lat}`).join(";");
}

/** The corners from the address, or null when the text is not a usable area. */
export function parseAreaParam(text: string | null): Corner[] | null {
  if (!text) return null;
  const corners: Corner[] = [];
  for (const pair of text.split(";")) {
    const parts = pair.split(",");
    if (parts.length !== 2 || parts.some((part) => part.trim() === "")) return null;
    const [lon, lat] = parts.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    corners.push([lon, lat]);
  }
  return areaProblem(corners) === null ? corners : null;
}

/**
 * The closed outline with extra points along each side, so that no step is longer than `step` degrees.
 * The API reads a side as a straight line in longitude and latitude; the map draws a straight line in
 * Web Mercator between the points it is given. With the points this close the two cannot be told apart,
 * so what is drawn is what is counted.
 */
export function densifyRing(corners: readonly Corner[], step = 0.5): Corner[] {
  return densifyPath([...corners, corners[0]], step);
}

/** The same for an open path: the outline while it is being drawn. */
export function densifyPath(points: readonly Corner[], step = 0.5): Corner[] {
  const path: Corner[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const pieces = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / step));
    for (let k = 0; k < pieces; k++) path.push([x1 + ((x2 - x1) * k) / pieces, y1 + ((y2 - y1) * k) / pieces]);
  }
  if (points.length) path.push([...points[points.length - 1]]);
  return path;
}

/** The region a drawn area belongs to: the one whose box holds the middle of the area's bounds, else its first corner inside a box. */
export function regionOfArea(regions: Region[], corners: readonly Corner[]): Region | null {
  if (corners.length === 0) return null;
  const [west, south, east, north] = cornersBounds(corners);
  const middle = regionAt(regions, (west + east) / 2, (south + north) / 2);
  if (middle) return middle;
  for (const [lon, lat] of corners) {
    const region = regionAt(regions, lon, lat);
    if (region) return region;
  }
  return null;
}

/** The area as well-known text, for the CSV export: POLYGON ((lon lat, ...)) with the ring closed. */
export function cornersWkt(corners: readonly Corner[]): string {
  const ring = [...corners, corners[0]].map(([lon, lat]) => `${lon} ${lat}`).join(", ");
  return `POLYGON ((${ring}))`;
}
