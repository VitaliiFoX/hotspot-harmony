import { describe, expect, it } from 'vitest';
import {
  bboxToPolygon,
  circleToPolygon,
  coverageOf,
  geometryAreaKm2,
  geometryBBox,
  isAreaGeometry,
  isSimplePolygon,
  normalizeGeometry,
  type AreaGeometry,
  type BBox,
} from './geometry';

const UKRAINE: BBox = [22.0, 44.0, 40.3, 52.5];

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('bboxToPolygon', () => {
  it('builds a closed counter-clockwise rectangle', () => {
    const polygon = unwrap(bboxToPolygon([29.2, 51.1, 30.6, 51.6]));
    expect(polygon.coordinates).toEqual([
      [
        [29.2, 51.1],
        [30.6, 51.1],
        [30.6, 51.6],
        [29.2, 51.6],
        [29.2, 51.1],
      ],
    ]);
    expect(geometryBBox(polygon)).toEqual([29.2, 51.1, 30.6, 51.6]);
  });

  it('rejects swapped, out-of-range and missing values', () => {
    expect(bboxToPolygon([30.6, 51.1, 29.2, 51.6]).ok).toBe(false);
    expect(bboxToPolygon([29.2, 51.6, 30.6, 51.1]).ok).toBe(false);
    expect(bboxToPolygon([-190, 0, 10, 10]).ok).toBe(false);
    expect(bboxToPolygon([0, 0, 10, 95]).ok).toBe(false);
    expect(bboxToPolygon([0, 0, 10]).ok).toBe(false);
    expect(bboxToPolygon([0, 0, 10, Number.NaN]).ok).toBe(false);
  });
});

describe('circleToPolygon', () => {
  it('makes a closed ring around the centre with the right radius', () => {
    const polygon = unwrap(circleToPolygon(50, 30, 100, 32));
    const ring = polygon.coordinates[0] ?? [];
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    const [w, s, e, n] = geometryBBox(polygon);
    // 100 km is about 0.899 degrees of latitude.
    expect(n - 50).toBeCloseTo(0.899, 2);
    expect(50 - s).toBeCloseTo(0.899, 2);
    // Degrees of longitude are wider apart at 50 N: 100 km is about 1.4 degrees.
    expect(e - 30).toBeCloseTo(1.4, 1);
    expect(30 - w).toBeCloseTo(1.4, 1);
  });

  it('has roughly the area of a circle', () => {
    const polygon = unwrap(circleToPolygon(48, 33, 50));
    const expected = Math.PI * 50 * 50;
    expect(Math.abs(geometryAreaKm2(polygon) - expected) / expected).toBeLessThan(0.01);
  });

  it('rejects bad input', () => {
    expect(circleToPolygon(95, 30, 10).ok).toBe(false);
    expect(circleToPolygon(50, 190, 10).ok).toBe(false);
    expect(circleToPolygon(50, 30, 0).ok).toBe(false);
    expect(circleToPolygon(50, 30, -5).ok).toBe(false);
    expect(circleToPolygon(50, 30, 99999).ok).toBe(false);
    expect(circleToPolygon(Number.NaN, 30, 10).ok).toBe(false);
  });
});

describe('isAreaGeometry', () => {
  it('accepts polygons and multipolygons only', () => {
    const polygon = unwrap(bboxToPolygon([0, 0, 1, 1]));
    expect(isAreaGeometry(polygon)).toBe(true);
    expect(isAreaGeometry({ type: 'MultiPolygon', coordinates: [polygon.coordinates] })).toBe(true);
    expect(isAreaGeometry({ type: 'Point', coordinates: [0, 0] })).toBe(false);
    expect(isAreaGeometry({ type: 'Polygon', coordinates: [[[0, 0]]] })).toBe(false);
    expect(isAreaGeometry(null)).toBe(false);
    expect(isAreaGeometry('Polygon')).toBe(false);
  });
});

describe('coverageOf', () => {
  it('tells inside, partial and outside apart', () => {
    const inside = unwrap(bboxToPolygon([29.2, 51.1, 30.6, 51.6]));
    const partial = unwrap(bboxToPolygon([39, 50, 43, 51]));
    const outside = unwrap(bboxToPolygon([0, 0, 1, 1]));
    expect(coverageOf(inside, [UKRAINE])).toBe('inside');
    expect(coverageOf(partial, [UKRAINE])).toBe('partial');
    expect(coverageOf(outside, [UKRAINE])).toBe('outside');
    expect(coverageOf(inside, [])).toBe('outside');
  });
});

describe('geometryAreaKm2', () => {
  it('is close to the known size of a one-degree cell at the equator', () => {
    const polygon = unwrap(bboxToPolygon([0, 0, 1, 1]));
    expect(geometryAreaKm2(polygon)).toBeGreaterThan(12000);
    expect(geometryAreaKm2(polygon)).toBeLessThan(12500);
  });
});

describe('normalizeGeometry', () => {
  it('rounds coordinates and closes open rings', () => {
    const open: AreaGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [30.1234567, 50.0000004],
          [31, 50],
          [31, 51],
          [30.1234567, 51],
        ],
      ],
    };
    const fixed = normalizeGeometry(open);
    expect(fixed.coordinates[0]).toEqual([
      [30.12346, 50],
      [31, 50],
      [31, 51],
      [30.12346, 51],
      [30.12346, 50],
    ]);
    expect(isSimplePolygon(fixed)).toBe(true);
  });
});
