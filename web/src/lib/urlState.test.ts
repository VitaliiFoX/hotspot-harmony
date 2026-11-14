import { describe, expect, it } from 'vitest';
import type { AreaGeometry } from './geometry';
import { decodeGeometry, decodeHash, encodeGeometry, encodeHash } from './urlState';

const CHORNOBYL: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [29.2, 51.1],
      [30.6, 51.1],
      [30.6, 51.6],
      [29.2, 51.6],
      [29.2, 51.1],
    ],
  ],
};

const MULTI: AreaGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    CHORNOBYL.coordinates as number[][][],
    [
      [
        [-73.6, -55.1],
        [-53.6, -55.1],
        [-53.6, -21.7],
        [-73.6, -55.1],
      ],
    ],
  ],
};

describe('geometry encoding', () => {
  it('encodes a polygon compactly, without the closing point', () => {
    expect(encodeGeometry(CHORNOBYL)).toBe('29.2,51.1;30.6,51.1;30.6,51.6;29.2,51.6');
  });

  it('round-trips polygons, holes and multipolygons', () => {
    expect(decodeGeometry(encodeGeometry(CHORNOBYL))).toEqual(CHORNOBYL);
    expect(decodeGeometry(encodeGeometry(MULTI))).toEqual(MULTI);
    const withHole: AreaGeometry = {
      type: 'Polygon',
      coordinates: [
        ...(CHORNOBYL.coordinates as number[][][]),
        [
          [29.5, 51.2],
          [30, 51.2],
          [30, 51.4],
          [29.5, 51.2],
        ],
      ],
    };
    expect(decodeGeometry(encodeGeometry(withHole))).toEqual(withHole);
  });

  it('rounds to 5 decimals', () => {
    const fine: AreaGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [30.123456789, 50.1],
          [31, 50.1],
          [31, 51],
          [30.123456789, 50.1],
        ],
      ],
    };
    expect(encodeGeometry(fine)).toBe('30.12346,50.1;31,50.1;31,51');
  });

  it('returns null for malformed text', () => {
    expect(decodeGeometry('')).toBeNull();
    expect(decodeGeometry('abc')).toBeNull();
    expect(decodeGeometry('1,2;3,4')).toBeNull();
    expect(decodeGeometry('1,2;3,4;x,6')).toBeNull();
    expect(decodeGeometry('1,2;3,4;5')).toBeNull();
    expect(decodeGeometry('1,2;3,4;500,6')).toBeNull();
    expect(decodeGeometry('1,2;3,4;5,')).toBeNull();
  });
});

describe('hash state', () => {
  it('encodes and decodes the full state', () => {
    const hash = encodeHash({ geometry: CHORNOBYL, start: '2010-01', end: '2020-12', raw: true });
    expect(hash).toBe('g=29.2,51.1;30.6,51.1;30.6,51.6;29.2,51.6&from=2010-01&to=2020-12&view=raw');
    expect(decodeHash(`#${hash}`)).toEqual({
      geometry: CHORNOBYL,
      start: '2010-01',
      end: '2020-12',
      raw: true,
    });
  });

  it('leaves out defaults', () => {
    expect(encodeHash({ geometry: null, start: null, end: null, raw: false })).toBe('');
    expect(encodeHash({ geometry: CHORNOBYL, start: null, end: null, raw: false })).toBe(
      'g=29.2,51.1;30.6,51.1;30.6,51.6;29.2,51.6',
    );
  });

  it('accepts percent-encoded hashes', () => {
    const encoded = 'g=29.2%2C51.1%3B30.6%2C51.1%3B30.6%2C51.6%3B29.2%2C51.6&from=2010-01';
    expect(decodeHash(encoded)).toEqual({
      geometry: CHORNOBYL,
      start: '2010-01',
      end: null,
      raw: false,
    });
  });

  it('ignores junk without throwing', () => {
    const empty = { geometry: null, start: null, end: null, raw: false };
    expect(decodeHash('')).toEqual(empty);
    expect(decodeHash('#')).toEqual(empty);
    expect(decodeHash('#g=nonsense&from=2025-13&to=later&view=other&x')).toEqual(empty);
    expect(decodeHash('#g=%E0%A4%A')).toEqual(empty);
  });
});
