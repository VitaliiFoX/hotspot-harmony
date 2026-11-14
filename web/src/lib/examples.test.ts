import { describe, expect, it } from 'vitest';
import type { CountryMeta } from '../api/types';
import { buildExamples, defaultArea, defaultCountry } from './examples';
import { geometryBBox } from './geometry';

const ARGENTINA: CountryMeta = {
  name: 'Argentina',
  bbox: [-73.6, -55.1, -53.6, -21.7],
  start: '2024-01',
  end: '2024-12',
};
const UKRAINE: CountryMeta = {
  name: 'Ukraine',
  bbox: [22.0, 44.0, 40.3, 52.5],
  start: '2000-11',
  end: '2025-12',
};

describe('examples', () => {
  it('prefers Ukraine as the default country, wherever it is in the list', () => {
    expect(defaultCountry({ countries: [ARGENTINA, UKRAINE] })?.name).toBe('Ukraine');
    expect(defaultCountry({ countries: [ARGENTINA] })?.name).toBe('Argentina');
    expect(defaultCountry({ countries: [] })).toBeNull();
    expect(defaultCountry(null)).toBeNull();
  });

  it('lists the Ukraine examples first, then whole countries', () => {
    const labels = buildExamples({ countries: [ARGENTINA, UKRAINE] }).map((e) => e.label);
    expect(labels).toEqual([
      'Chornobyl Exclusion Zone',
      'Kherson region',
      'Whole Ukraine',
      'Whole Argentina',
    ]);
  });

  it('offers only whole countries when Ukraine is not available', () => {
    expect(buildExamples({ countries: [ARGENTINA] }).map((e) => e.label)).toEqual([
      'Whole Argentina',
    ]);
    expect(buildExamples(null)).toEqual([]);
  });

  it('uses the whole default country as the first area', () => {
    const area = defaultArea({ countries: [ARGENTINA, UKRAINE] });
    expect(area && geometryBBox(area)).toEqual([22, 44, 40.3, 52.5]);
    expect(defaultArea({ countries: [] })).toBeNull();
  });
});
