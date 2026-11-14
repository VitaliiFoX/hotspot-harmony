import { describe, expect, it } from 'vitest';
import type { ClimatologyMonth, MonthValue, RecordPeriod } from '../api/types';
import {
  buildMonthGrid,
  cellValue,
  colorValue,
  deviationValue,
  fromLogColor,
  isEmptyResult,
  ratioToMedian,
  rawRecord,
  rawSourceLabel,
  sensorLabel,
  visiblePeriods,
} from './monthGrid';

function m(year: number, month: number, harmonized: number, raw = harmonized): MonthValue {
  return {
    year,
    month,
    n_harmonized: harmonized,
    n_raw: raw,
    sensor_used: year < 2022 ? 'modis' : 'viirs_noaa20',
    lo: harmonized,
    hi: harmonized,
  };
}

const CLIM: ClimatologyMonth[] = [
  { month: 11, median: 4, p25: 1, p75: 9, years: 3 },
  { month: 12, median: 0, p25: 0, p75: 0, years: 3 },
  { month: 1, median: 2, p25: 1, p75: 3, years: 2 },
];

const RECORD: RecordPeriod[] = [
  { sensor: 'modis_terra', label: 'MODIS Terra only, scaled', from: '2000-11', to: '2002-06' },
  { sensor: 'modis', label: 'MODIS Terra + Aqua (reference)', from: '2002-07', to: '2021-12' },
  { sensor: 'viirs_noaa20', label: 'VIIRS NOAA-20, harmonized', from: '2022-01', to: null },
];

describe('buildMonthGrid', () => {
  const grid = buildMonthGrid(
    [m(2001, 1, 8, 3), m(2000, 11, 2), m(2000, 12, 0), m(2002, 2, 16.5, 40)],
    CLIM,
  );

  it('makes one row per year and pads months outside the range with null', () => {
    expect(grid.years).toEqual([2000, 2001, 2002]);
    expect(grid.rows).toHaveLength(3);
    expect(grid.rows[0]?.slice(0, 10).every((c) => c === null)).toBe(true);
    expect(grid.rows[0]?.[10]?.harmonized).toBe(2);
    expect(grid.rows[0]?.[11]?.harmonized).toBe(0);
    expect(grid.rows[1]?.[0]?.raw).toBe(3);
    expect(grid.rows[1]?.[1]).toBeNull();
    expect(grid.rows[2]?.[1]?.harmonized).toBe(16.5);
  });

  it('sorts cells and tracks range, maxima and totals', () => {
    expect(grid.cells.map((c) => `${c.year}-${c.month}`)).toEqual([
      '2000-11',
      '2000-12',
      '2001-1',
      '2002-2',
    ]);
    expect(grid.first).toEqual({ year: 2000, month: 11 });
    expect(grid.last).toEqual({ year: 2002, month: 2 });
    expect(grid.maxHarmonized).toBe(16.5);
    expect(grid.maxRaw).toBe(40);
    expect(grid.totalHarmonized).toBe(26.5);
  });

  it('attaches the median of the calendar month', () => {
    expect(grid.rows[0]?.[10]?.median).toBe(4);
    expect(grid.rows[2]?.[1]?.median).toBeNull();
  });

  it('handles an empty list', () => {
    const empty = buildMonthGrid([]);
    expect(empty.years).toEqual([]);
    expect(empty.first).toBeNull();
    expect(isEmptyResult(empty)).toBe(false);
  });

  it('recognises an all-zero result', () => {
    expect(isEmptyResult(buildMonthGrid([m(2024, 1, 0), m(2024, 2, 0)]))).toBe(true);
    expect(isEmptyResult(grid)).toBe(false);
  });
});

describe('cell values and colour values', () => {
  const cell = buildMonthGrid([m(2000, 11, 8, 99)], CLIM).cells[0]!;

  it('switches between harmonized and raw', () => {
    expect(cellValue(cell, 'harmonized')).toBe(8);
    expect(cellValue(cell, 'raw')).toBe(99);
  });

  it('computes linear, log and deviation colour values', () => {
    expect(colorValue(cell, 'harmonized', 'linear')).toBe(8);
    expect(colorValue(cell, 'raw', 'log')).toBeCloseTo(2);
    expect(fromLogColor(colorValue(cell, 'raw', 'log'))).toBeCloseTo(99);
    // (8 + 1) / (4 + 1) = 1.8 times the usual level.
    expect(colorValue(cell, 'harmonized', 'deviation')).toBeCloseTo(Math.log2(1.8));
  });

  it('clamps deviation and treats zeros and tiny counts with care', () => {
    expect(deviationValue(1000, 1)).toBe(3);
    expect(deviationValue(0, 500)).toBe(-3);
    expect(deviationValue(0, 0)).toBe(0);
    expect(deviationValue(0, 2)).toBeCloseTo(Math.log2(1 / 3));
    expect(deviationValue(3, 0)).toBe(2);
    expect(deviationValue(4, null)).toBe(0);
    // For large counts it is the plain ratio.
    expect(deviationValue(2000, 1000)).toBeCloseTo(1, 2);
    expect(ratioToMedian(4, 0)).toBeNull();
    expect(ratioToMedian(4, null)).toBeNull();
    expect(ratioToMedian(6, 4)).toBe(1.5);
  });
});

describe('sensor periods', () => {
  it('clips the record to the visible range and keeps letters stable', () => {
    const all = visiblePeriods(RECORD, { year: 2000, month: 11 }, { year: 2025, month: 12 });
    expect(all.map((p) => p.letter)).toEqual(['A', 'B', 'C']);
    expect(all[2]?.to).toEqual({ year: 2025, month: 12 });

    const late = visiblePeriods(RECORD, { year: 2010, month: 3 }, { year: 2023, month: 6 });
    expect(late.map((p) => p.letter)).toEqual(['B', 'C']);
    expect(late[0]?.from).toEqual({ year: 2010, month: 3 });
    expect(late[1]?.to).toEqual({ year: 2023, month: 6 });
  });

  it('returns nothing without a range or with a broken record', () => {
    expect(visiblePeriods(RECORD, null, null)).toEqual([]);
    expect(
      visiblePeriods(
        [{ sensor: 'x', label: 'X', from: 'soon', to: null }],
        { year: 2000, month: 1 },
        { year: 2001, month: 1 },
      ),
    ).toEqual([]);
  });

  it('describes the raw splice at February 2012', () => {
    const raw = rawRecord('2000-11');
    expect(raw[0]?.to).toBe('2012-01');
    expect(raw[1]?.from).toBe('2012-02');
    expect(rawSourceLabel({ year: 2012, month: 1 })).toBe('MODIS, raw count');
    expect(rawSourceLabel({ year: 2012, month: 2 })).toBe('VIIRS, raw count');
  });

  it('labels a sensor code from the record, falling back to the code', () => {
    expect(sensorLabel('modis', RECORD)).toBe('MODIS Terra + Aqua (reference)');
    expect(sensorLabel('something_new', RECORD)).toBe('something_new');
  });
});
