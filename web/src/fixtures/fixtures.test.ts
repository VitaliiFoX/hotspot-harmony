import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { bboxToPolygon } from '../lib/geometry';
import { buildMonthGrid } from '../lib/monthGrid';
import { fixtureCalendar, fixtureMeta } from './index';

function polygon(bbox: number[]) {
  const result = bboxToPolygon(bbox);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('fixtures follow the API contract', () => {
  it('meta has the documented keys', async () => {
    const meta = await fixtureMeta();
    expect(meta.unit_short).toBe('fire cell-days');
    expect(meta.attribution).toBe('NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)');
    expect(meta.series).toEqual({ start: '2000-11', end: '2025-12' });
    expect(meta.countries.find((c) => c.name === 'Ukraine')?.bbox).toEqual([22, 44, 40.3, 52.5]);
    expect(meta.record).toHaveLength(3);
  });

  it('calendar contains every month of the range and consistent totals', async () => {
    const data = await fixtureCalendar({ geometry: polygon([29.2, 51.1, 30.6, 51.6]) });
    expect(data.countries).toEqual(['Ukraine']);
    // 2000-11 .. 2025-12
    expect(data.months).toHaveLength(302);
    expect(data.climatology).toHaveLength(12);
    expect(data.yearly).toHaveLength(26);
    expect(data.yearly[0]?.complete).toBe(false);
    const grid = buildMonthGrid(data.months, data.climatology);
    const yearlySum = data.yearly.reduce((sum, y) => sum + y.n_harmonized, 0);
    expect(yearlySum).toBeCloseTo(grid.totalHarmonized, 0);
    for (const month of data.months) {
      expect(month.lo).toBeLessThanOrEqual(month.n_harmonized);
      expect(month.hi).toBeGreaterThanOrEqual(month.n_harmonized);
      if (month.sensor_used === 'modis') expect(month.lo).toBe(month.hi);
    }
    expect(data.anomaly?.year).toBe(2025);
    expect(data.anomaly?.month).toBe(12);
  });

  it('is deterministic and honours the date range', async () => {
    const body = { geometry: polygon([32, 45.9, 35.3, 47.6]), start: '2010-03', end: '2012-06' };
    const a = await fixtureCalendar(body);
    const b = await fixtureCalendar(body);
    expect(a).toEqual(b);
    expect(a.months[0]).toMatchObject({ year: 2010, month: 3 });
    expect(a.months).toHaveLength(28);
  });

  it('answers 422 outside every country', async () => {
    await expect(fixtureCalendar({ geometry: polygon([0, 0, 1, 1]) })).rejects.toMatchObject({
      kind: 'http',
      status: 422,
    });
    await expect(fixtureCalendar({ geometry: polygon([0, 0, 1, 1]) })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
