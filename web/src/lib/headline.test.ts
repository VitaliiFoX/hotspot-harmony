import { describe, expect, it } from 'vitest';
import type { Anomaly, ClimatologyMonth, MonthValue, TopMonth } from '../api/types';
import { buildHeadline, isQuietMonth, peakMonth, pluralMonth, unusualMonths } from './headline';

function clim(medians: number[]): ClimatologyMonth[] {
  return medians.map((median, i) => ({
    month: i + 1,
    median,
    p25: median / 2,
    p75: median * 2,
    years: 25,
  }));
}

function month(year: number, m: number, value: number): MonthValue {
  return {
    year,
    month: m,
    n_harmonized: value,
    n_raw: value,
    sensor_used: 'modis',
    lo: value,
    hi: value,
  };
}

const CLIM = clim([10, 20, 400, 600, 200, 150, 500, 1210, 700, 300, 60, 1210 / 2.31]);
const MONTHS = [month(2000, 11, 5), month(2012, 8, 900), month(2025, 12, 2790)];

const ANOMALY: Anomaly = {
  year: 2025,
  month: 12,
  value: 2790,
  median: 1210,
  ratio: 2.31,
  percentile: 96,
  lo: 2500,
  hi: 3100,
};

describe('helpers', () => {
  it('pluralises month names', () => {
    expect(pluralMonth(12)).toBe('Decembers');
    expect(pluralMonth(3)).toBe('Marches');
  });

  it('finds the usual peak month', () => {
    expect(peakMonth(CLIM)).toBe(8);
    expect(peakMonth(clim(new Array<number>(12).fill(0)))).toBeNull();
    expect(peakMonth([])).toBeNull();
  });
});

describe('buildHeadline', () => {
  it('builds the standard sentence with range, rank and peak month', () => {
    const h = buildHeadline({ anomaly: ANOMALY, climatology: CLIM, months: MONTHS });
    expect(h.text).toBe(
      'December 2025 here: 2.3x the usual level (90% range 2.1-2.6x), higher than 96% of Decembers since 2000. The usual peak month is August.',
    );
    expect(h.note).toBeNull();
  });

  it('omits the range when lo equals hi', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, lo: 2790, hi: 2790 },
      climatology: CLIM,
      months: MONTHS,
    });
    expect(h.text).toBe(
      'December 2025 here: 2.3x the usual level, higher than 96% of Decembers since 2000. The usual peak month is August.',
    );
  });

  it('says "lower than" for a low percentile', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 484, ratio: 0.4, percentile: 12, lo: 484, hi: 484 },
      climatology: CLIM,
      months: MONTHS,
    });
    expect(h.text).toContain('0.4x the usual level, lower than 88% of Decembers since 2000.');
  });

  it('handles a null ratio (median 0) without inventing a number', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 12, median: 0, ratio: null, lo: 12, hi: 12 },
      climatology: CLIM,
      months: MONTHS,
    });
    expect(h.text).toBe(
      'December 2025 here: 12 fire cell-days in a month that usually has none; higher than 96% of Decembers since 2000. The usual peak month is August.',
    );
  });

  it('handles a month with no hotspots where some are usual', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 0, ratio: 0, percentile: 0, lo: 0, hi: 0 },
      climatology: CLIM,
      months: MONTHS,
    });
    expect(h.text).toBe(
      'December 2025 here: no hotspots, where 1,210 fire cell-days are usual for December. The usual peak month is August.',
    );
  });

  it('leads with the most unusual month when the latest month is quiet as usual', () => {
    const top: TopMonth[] = [{ year: 2020, month: 4, value: 556, median: 26, ratio: 21.38 }];
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 0, median: 0, ratio: null, percentile: 50, lo: 0, hi: 0 },
      climatology: CLIM,
      months: MONTHS,
      topMonths: top,
    });
    expect(h.text).toBe(
      'The most unusual month here was April 2020: 556 fire cell-days, 21x the usual April level. The usual peak month is August.',
    );
    expect(h.note).toBe('December 2025: no hotspots, which is normal for December here.');
  });

  it('treats a usual level below one cell-day as a quiet season too', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 0, median: 0.3, ratio: 0, percentile: 30, lo: 0, hi: 0 },
      climatology: CLIM,
      months: MONTHS,
      topMonths: [{ year: 2020, month: 4, value: 556, median: 26, ratio: 21.38 }],
    });
    expect(h.text).toContain('The most unusual month here was April 2020');
    expect(h.note).toBe('December 2025: no hotspots, which is normal for December here.');
  });

  it('stays calm when the latest month is quiet and there is no top month', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 0, median: 0, ratio: null, percentile: 50, lo: 0, hi: 0 },
      climatology: CLIM,
      months: MONTHS,
    });
    expect(h.text).toBe(
      'December 2025: no hotspots, which is normal for December here. The usual peak month is August.',
    );
    expect(h.note).toBeNull();
  });

  it('does not call a month unusual when it is at its usual level', () => {
    // One year of data: every month equals its own median.
    const flat: TopMonth[] = [{ year: 2024, month: 1, value: 573, median: 573, ratio: 1 }];
    expect(unusualMonths(flat)).toEqual([]);
    const h = buildHeadline({ anomaly: null, climatology: CLIM, months: MONTHS, topMonths: flat });
    expect(h.text).toBe('The usual peak month is August.');
    expect(
      unusualMonths([
        { year: 2020, month: 4, value: 556, median: 26, ratio: 21.38 },
        { year: 2021, month: 4, value: 0, median: 26, ratio: 0 },
        { year: 2024, month: 1, value: 14.5, median: 0, ratio: null },
      ]).map((t) => t.year),
    ).toEqual([2020, 2024]);
  });

  it('knows a quiet month', () => {
    expect(isQuietMonth({ value: 0, median: 0 })).toBe(true);
    expect(isQuietMonth({ value: 0, median: 0.3 })).toBe(true);
    expect(isQuietMonth({ value: 0, median: 12 })).toBe(false);
    expect(isQuietMonth({ value: 2, median: 0 })).toBe(false);
  });

  it('describes a top month whose usual level is zero', () => {
    const h = buildHeadline({
      anomaly: null,
      climatology: CLIM,
      months: MONTHS,
      topMonths: [{ year: 2024, month: 1, value: 14.5, median: 0, ratio: null }],
    });
    expect(h.text).toBe(
      'The most unusual month here was January 2024: 14.5 fire cell-days, in a month that usually has none. The usual peak month is August.',
    );
  });

  it('reports an empty result as a valid answer', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 0, median: 0, ratio: null, lo: 0, hi: 0 },
      climatology: clim(new Array<number>(12).fill(0)),
      months: [month(2024, 1, 0), month(2024, 2, 0)],
    });
    expect(h.text).toBe('No hotspots were recorded in this area in the selected period.');
  });

  it('copes with no anomaly and no climatology', () => {
    const h = buildHeadline({ anomaly: null, climatology: [], months: [month(2024, 1, 3)] });
    expect(h.text).toBe('There is no recent month to compare with the usual level here.');
    const withPeak = buildHeadline({ anomaly: null, climatology: CLIM, months: MONTHS });
    expect(withPeak.text).toBe('The usual peak month is August.');
    expect(withPeak.note).toBe('There is no recent month to compare with the usual level here.');
  });

  it('uses the unit label it is given', () => {
    const h = buildHeadline({
      anomaly: { ...ANOMALY, value: 12, median: 0, ratio: null },
      climatology: [],
      months: MONTHS,
      unit: 'cell-days',
    });
    expect(h.text).toContain('12 cell-days in a month');
  });
});
