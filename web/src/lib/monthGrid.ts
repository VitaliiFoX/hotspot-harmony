import type { ClimatologyMonth, MonthValue, RecordPeriod } from '../api/types';
import { DEVIATION_LIMIT } from './colors';
import { compareYM, formatYM, parseYM, ymIndex, type YM } from './ym';

/** Which record is displayed. */
export type RecordMode = 'harmonized' | 'raw';

/** How calendar cells are coloured. */
export type ColorScale = 'linear' | 'log' | 'deviation';

export interface GridCell {
  year: number;
  month: number;
  harmonized: number;
  raw: number;
  sensor: string;
  lo: number;
  hi: number;
  /** Historical median for this calendar month, null when the API sent none. */
  median: number | null;
}

export interface MonthGrid {
  /** Ascending list of years, one per calendar row. */
  years: number[];
  /** rows[i][m - 1] is the cell of years[i], month m; null when outside the range. */
  rows: (GridCell | null)[][];
  /** All existing cells in chronological order. */
  cells: GridCell[];
  maxHarmonized: number;
  maxRaw: number;
  totalHarmonized: number;
  totalRaw: number;
  first: YM | null;
  last: YM | null;
}

/** The raw splice switches from MODIS counts to VIIRS counts in February 2012. */
export const RAW_SPLICE: YM = { year: 2012, month: 2 };

/** Shape the flat list of months into a years x 12 grid. */
export function buildMonthGrid(
  months: readonly MonthValue[],
  climatology: readonly ClimatologyMonth[] = [],
): MonthGrid {
  const medians = new Map<number, number>();
  for (const c of climatology) medians.set(c.month, c.median);

  const cells: GridCell[] = months
    .filter((m) => Number.isFinite(m.year) && m.month >= 1 && m.month <= 12)
    .map((m) => ({
      year: m.year,
      month: m.month,
      harmonized: Number.isFinite(m.n_harmonized) ? m.n_harmonized : 0,
      raw: Number.isFinite(m.n_raw) ? m.n_raw : 0,
      sensor: m.sensor_used,
      lo: Number.isFinite(m.lo) ? m.lo : m.n_harmonized,
      hi: Number.isFinite(m.hi) ? m.hi : m.n_harmonized,
      median: medians.get(m.month) ?? null,
    }))
    .sort(compareYM);

  const first = cells[0];
  const last = cells[cells.length - 1];
  const years: number[] = [];
  const rows: (GridCell | null)[][] = [];
  if (first && last) {
    for (let y = first.year; y <= last.year; y += 1) {
      years.push(y);
      rows.push(new Array<GridCell | null>(12).fill(null));
    }
    for (const cell of cells) {
      const row = rows[cell.year - first.year];
      if (row) row[cell.month - 1] = cell;
    }
  }

  let maxHarmonized = 0;
  let maxRaw = 0;
  let totalHarmonized = 0;
  let totalRaw = 0;
  for (const cell of cells) {
    if (cell.harmonized > maxHarmonized) maxHarmonized = cell.harmonized;
    if (cell.raw > maxRaw) maxRaw = cell.raw;
    totalHarmonized += cell.harmonized;
    totalRaw += cell.raw;
  }

  return {
    years,
    rows,
    cells,
    maxHarmonized,
    maxRaw,
    totalHarmonized,
    totalRaw,
    first: first ? { year: first.year, month: first.month } : null,
    last: last ? { year: last.year, month: last.month } : null,
  };
}

export function cellValue(cell: GridCell, mode: RecordMode): number {
  return mode === 'raw' ? cell.raw : cell.harmonized;
}

/** Ratio of a value to the usual level; null when the usual level is zero or unknown. */
export function ratioToMedian(value: number, median: number | null): number | null {
  if (median === null || !Number.isFinite(median) || median <= 0) return null;
  return value / median;
}

/**
 * Position of a value on the deviation scale: log2 of (value + 1) / (median + 1),
 * clamped to +-DEVIATION_LIMIT. Adding one keeps months with tiny counts from
 * looking extreme (0 against a usual 2 is "a little below", not "infinitely below")
 * and gives zero against zero the neutral midpoint. For large counts it is the
 * plain ratio to the usual level.
 */
export function deviationValue(value: number, median: number | null): number {
  if (median === null || !Number.isFinite(median) || !Number.isFinite(value)) return 0;
  const log = Math.log2((Math.max(0, value) + 1) / (Math.max(0, median) + 1));
  return Math.max(-DEVIATION_LIMIT, Math.min(DEVIATION_LIMIT, log));
}

/** Value that drives the colour of a cell for the chosen record and scale. */
export function colorValue(cell: GridCell, mode: RecordMode, scale: ColorScale): number {
  const value = cellValue(cell, mode);
  if (scale === 'deviation') return deviationValue(value, cell.median);
  if (scale === 'log') return Math.log10(1 + Math.max(0, value));
  return value;
}

/** Inverse of the log colour transform. */
export function fromLogColor(colorVal: number): number {
  return 10 ** colorVal - 1;
}

export interface SensorPeriod {
  /** A, B, C ... used to tie calendar rows to the legend. */
  letter: string;
  sensor: string;
  label: string;
  from: YM;
  to: YM;
}

/**
 * Sensor periods clipped to the visible range, in chronological order.
 * Periods entirely outside the range are dropped; letters stay tied to the
 * position in the full record so "B" always means the same sensor.
 */
export function visiblePeriods(
  record: readonly RecordPeriod[],
  first: YM | null,
  last: YM | null,
): SensorPeriod[] {
  if (!first || !last) return [];
  const out: SensorPeriod[] = [];
  record.forEach((period, index) => {
    const from = parseYM(period.from);
    if (!from) return;
    const to = period.to ? parseYM(period.to) : last;
    if (!to) return;
    const clippedFrom = compareYM(from, first) < 0 ? first : from;
    const clippedTo = compareYM(to, last) > 0 ? last : to;
    if (compareYM(clippedFrom, clippedTo) > 0) return;
    out.push({
      letter: String.fromCharCode(65 + (index % 26)),
      sensor: period.sensor,
      label: period.label,
      from: clippedFrom,
      to: clippedTo,
    });
  });
  return out.sort((a, b) => compareYM(a.from, b.from));
}

/** The two halves of the raw (uncorrected) splice, as a record for visiblePeriods(). */
export function rawRecord(seriesStart: string): RecordPeriod[] {
  const before = { year: RAW_SPLICE.year, month: RAW_SPLICE.month - 1 };
  return [
    { sensor: 'raw_modis', label: 'MODIS, raw counts', from: seriesStart, to: formatYM(before) },
    { sensor: 'raw_viirs', label: 'VIIRS, raw counts', from: formatYM(RAW_SPLICE), to: null },
  ];
}

/** Source of a raw value: MODIS before the splice, VIIRS from it on. */
export function rawSourceLabel(ym: YM): string {
  return ymIndex(ym) < ymIndex(RAW_SPLICE) ? 'MODIS, raw count' : 'VIIRS, raw count';
}

/** Human label for a `sensor_used` code, taken from the record description. */
export function sensorLabel(sensor: string, record: readonly RecordPeriod[]): string {
  return record.find((r) => r.sensor === sensor)?.label ?? sensor;
}

/** True when every month of the result has zero hotspots in both records. */
export function isEmptyResult(grid: MonthGrid): boolean {
  return grid.cells.length > 0 && grid.totalHarmonized === 0 && grid.totalRaw === 0;
}
