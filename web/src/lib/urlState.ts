import type { Position } from 'geojson';
import { isAreaGeometry, polygonsOf, roundCoord, type AreaGeometry } from './geometry';
import { parseYM } from './ym';

/**
 * Shareable state kept in the URL hash:
 *   #g=<geometry>&from=YYYY-MM&to=YYYY-MM&view=raw
 *
 * Geometry text: polygons joined by "~", rings by "_", points by ";", lon and lat by ",".
 * The closing point of each ring is dropped and restored on decode.
 */
export interface UrlState {
  geometry: AreaGeometry | null;
  /** "YYYY-MM" or null for "start of the series". */
  start: string | null;
  /** "YYYY-MM" or null for "end of the series". */
  end: string | null;
  /** True when the raw (uncorrected) record is shown. */
  raw: boolean;
}

export const EMPTY_URL_STATE: UrlState = { geometry: null, start: null, end: null, raw: false };

function encodeRing(ring: Position[]): string {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    ring.length > 1 && first !== undefined && last !== undefined
      ? first[0] === last[0] && first[1] === last[1]
      : false;
  const open = closed ? ring.slice(0, -1) : ring;
  return open.map(([x, y]) => `${roundCoord(x as number)},${roundCoord(y as number)}`).join(';');
}

export function encodeGeometry(geometry: AreaGeometry): string {
  return polygonsOf(geometry)
    .map((polygon) => polygon.map(encodeRing).join('_'))
    .join('~');
}

function decodeRing(text: string): Position[] | null {
  const points: Position[] = [];
  for (const pair of text.split(';')) {
    const parts = pair.split(',');
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (parts[0] === '' || parts[1] === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    if (x < -180 || x > 180 || y < -90 || y > 90) return null;
    points.push([x, y]);
  }
  if (points.length < 3) return null;
  points.push([...(points[0] as Position)]);
  return points;
}

export function decodeGeometry(text: string): AreaGeometry | null {
  if (!text) return null;
  const polygons: Position[][][] = [];
  for (const polygonText of text.split('~')) {
    const rings: Position[][] = [];
    for (const ringText of polygonText.split('_')) {
      const ring = decodeRing(ringText);
      if (!ring) return null;
      rings.push(ring);
    }
    polygons.push(rings);
  }
  const first = polygons[0];
  if (!first) return null;
  const geometry: AreaGeometry =
    polygons.length === 1
      ? { type: 'Polygon', coordinates: first }
      : { type: 'MultiPolygon', coordinates: polygons };
  return isAreaGeometry(geometry) ? geometry : null;
}

/** Build the hash text (without the leading "#"). Empty state gives an empty string. */
export function encodeHash(state: UrlState): string {
  const parts: string[] = [];
  if (state.geometry) parts.push(`g=${encodeGeometry(state.geometry)}`);
  if (state.start) parts.push(`from=${state.start}`);
  if (state.end) parts.push(`to=${state.end}`);
  if (state.raw) parts.push('view=raw');
  return parts.join('&');
}

/** Parse a hash (with or without "#"). Unknown or malformed parts are ignored. */
export function decodeHash(hash: string): UrlState {
  const state: UrlState = { ...EMPTY_URL_STATE };
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return state;
  for (const part of text.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      continue;
    }
    if (key === 'g') state.geometry = decodeGeometry(value);
    else if (key === 'from') state.start = parseYM(value) ? value : null;
    else if (key === 'to') state.end = parseYM(value) ? value : null;
    else if (key === 'view') state.raw = value === 'raw';
  }
  return state;
}
