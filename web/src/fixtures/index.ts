/**
 * Fixtures for running the app without a backend (VITE_USE_FIXTURES=1).
 *
 * `meta.json` is a saved copy of a real GET /api/meta answer. Calendar answers are
 * SYNTHETIC: generated deterministically from the polygon so that every area gives
 * a plausible, repeatable result with the same shape as the real API. The numbers
 * mean nothing; never show them as findings.
 */
import { ApiError } from '../api/client';
import type {
  Anomaly,
  CalendarRequest,
  CalendarResponse,
  ClimatologyMonth,
  HotspotsCsvRequest,
  HotspotsCsvResult,
  Meta,
  MonthValue,
  TopMonth,
  YearValue,
} from '../api/types';
import { bboxIntersects, geometryBBox, type BBox } from '../lib/geometry';
import { RAW_SPLICE } from '../lib/monthGrid';
import { compareYM, fromIndex, parseYM, ymIndex, type YM } from '../lib/ym';
import metaJson from './meta.json';

const META = metaJson as unknown as Meta;

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashNumbers(values: number[]): number {
  let h = 2166136261;
  for (const v of values) {
    h ^= Math.round(v * 1000);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Relative burning activity by calendar month: spring and late-summer peaks. */
const SEASON = [0.02, 0.06, 0.9, 1.0, 0.22, 0.14, 0.5, 0.85, 0.55, 0.32, 0.07, 0.01];

function sensorFor(ym: YM): string {
  for (const period of META.record) {
    const from = parseYM(period.from);
    const to = period.to ? parseYM(period.to) : null;
    if (from && compareYM(ym, from) >= 0 && (!to || compareYM(ym, to) <= 0)) return period.sensor;
  }
  return META.record[META.record.length - 1]?.sensor ?? 'modis';
}

export function fixtureMeta(): Promise<Meta> {
  return delay(META);
}

export function fixtureCalendar(body: CalendarRequest): Promise<CalendarResponse> {
  const box = geometryBBox(body.geometry);
  const hit = META.countries.filter((c) => bboxIntersects(c.bbox as BBox, box));
  if (hit.length === 0) {
    const names = META.countries.map((c) => c.name).join(', ');
    return delay(null, 150).then(() => {
      throw new ApiError(
        'http',
        `The area is outside the countries with data. Available: ${names}.`,
        422,
      );
    });
  }

  // Range: the union of the hit countries' series, clipped by the request.
  let first = Math.min(...hit.map((c) => ymIndex(parseYM(c.start) ?? { year: 2000, month: 11 })));
  let last = Math.max(...hit.map((c) => ymIndex(parseYM(c.end) ?? { year: 2025, month: 12 })));
  const reqStart = parseYM(body.start);
  const reqEnd = parseYM(body.end);
  if (reqStart) first = Math.max(first, ymIndex(reqStart));
  if (reqEnd) last = Math.min(last, ymIndex(reqEnd));

  // Grid cells of the part of the bounding box that has data.
  const cell = META.grid.cell_deg;
  let cells = 0;
  for (const c of hit) {
    const w = Math.max(box[0], c.bbox[0]);
    const e = Math.min(box[2], c.bbox[2]);
    const s = Math.max(box[1], c.bbox[1]);
    const n = Math.min(box[3], c.bbox[3]);
    if (e > w && n > s) cells += Math.ceil((e - w) / cell) * Math.ceil((n - s) / cell);
  }
  cells = Math.max(1, cells);

  const seed = hashNumbers(box);
  const yearFactor = new Map<number, number>();
  const factorOf = (year: number): number => {
    let f = yearFactor.get(year);
    if (f === undefined) {
      f = 0.55 + 1.3 * rng(seed ^ (year * 7919))() ** 1.6;
      yearFactor.set(year, f);
    }
    return f;
  };

  const months: MonthValue[] = [];
  for (let i = first; i <= last; i += 1) {
    const ym = fromIndex(i);
    const rand = rng(seed ^ (i * 104729));
    const season = SEASON[ym.month - 1] ?? 0;
    const expected = cells * 1.7 * season * factorOf(ym.year) * (0.5 + rand() * 1.1);
    // Small areas in the off season have nothing at all.
    const truth = expected < 0.6 ? (rand() < expected ? 1 : 0) : expected;
    const sensor = sensorFor(ym);
    const viirsEra = compareYM(ym, RAW_SPLICE) >= 0;

    let harmonized: number;
    let lo: number;
    let hi: number;
    let raw: number;
    if (sensor === 'modis') {
      harmonized = Math.round(truth);
      lo = harmonized;
      hi = harmonized;
      raw = viirsEra ? Math.round(truth * (2.0 + rand() * 0.5)) : harmonized;
    } else if (sensor === 'modis_terra') {
      harmonized = round1(truth * (0.95 + rand() * 0.1));
      lo = round1(harmonized * 0.75);
      hi = round1(harmonized * 1.3);
      raw = Math.round(truth * 0.45);
    } else {
      harmonized = round1(truth * (0.94 + rand() * 0.12));
      lo = round1(harmonized * 0.88);
      hi = round1(harmonized * 1.13);
      raw = Math.round(truth * (2.0 + rand() * 0.5));
    }
    months.push({
      year: ym.year,
      month: ym.month,
      n_harmonized: harmonized,
      n_raw: raw,
      sensor_used: sensor,
      lo,
      hi,
    });
  }

  const climatology: ClimatologyMonth[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const values = months
      .filter((x) => x.month === m)
      .map((x) => x.n_harmonized)
      .sort((a, b) => a - b);
    climatology.push({
      month: m,
      median: round1(quantile(values, 0.5)),
      p25: round1(quantile(values, 0.25)),
      p75: round1(quantile(values, 0.75)),
      years: values.length,
    });
  }
  const medianOf = (month: number): number => climatology[month - 1]?.median ?? 0;

  let anomaly: Anomaly | null = null;
  const latest = months[months.length - 1];
  if (latest) {
    const earlier = months
      .filter((x) => x.month === latest.month && x.year < latest.year)
      .map((x) => x.n_harmonized);
    if (earlier.length > 0) {
      const median = medianOf(latest.month);
      const below = earlier.filter((v) => v < latest.n_harmonized).length;
      const equal = earlier.filter((v) => v === latest.n_harmonized).length;
      anomaly = {
        year: latest.year,
        month: latest.month,
        value: latest.n_harmonized,
        median,
        ratio: median > 0 ? Math.round((latest.n_harmonized / median) * 100) / 100 : null,
        percentile: Math.round((100 * (below + 0.5 * equal)) / earlier.length),
        lo: latest.lo,
        hi: latest.hi,
        years_compared: earlier.length,
      };
    }
  }

  const topMonths: TopMonth[] = months
    .filter((x) => x.n_harmonized > 0 && medianOf(x.month) > 0)
    .map((x) => ({
      year: x.year,
      month: x.month,
      value: x.n_harmonized,
      median: medianOf(x.month),
      ratio: Math.round((x.n_harmonized / medianOf(x.month)) * 100) / 100,
    }))
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
    .slice(0, 5);

  const byYear = new Map<number, YearValue & { count: number }>();
  for (const x of months) {
    const y = byYear.get(x.year) ?? {
      year: x.year,
      n_harmonized: 0,
      n_raw: 0,
      complete: false,
      count: 0,
    };
    y.n_harmonized += x.n_harmonized;
    y.n_raw += x.n_raw;
    y.count += 1;
    byYear.set(x.year, y);
  }
  const yearly: YearValue[] = [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      year: y.year,
      n_harmonized: round1(y.n_harmonized),
      n_raw: y.n_raw,
      complete: y.count === 12,
    }));

  return delay({
    cells_used: cells,
    countries: hit.map((c) => c.name),
    unit: META.unit,
    months,
    climatology,
    anomaly,
    top_months: topMonths,
    yearly,
  });
}

export function fixtureHotspotsCsv(body: HotspotsCsvRequest): Promise<HotspotsCsvResult> {
  const [w, s, e, n] = geometryBBox(body.geometry);
  const rand = rng(hashNumbers([w, s, e, n]));
  const lines = [
    'lat,lon,acq_datetime_utc,sensor,satellite,confidence_class,frp,daynight,type,country',
  ];
  const startMs = Date.parse(`${body.start}T00:00:00Z`);
  const endMs = Date.parse(`${body.end}T23:59:00Z`);
  for (let i = 0; i < 60; i += 1) {
    const lat = (s + rand() * (n - s)).toFixed(5);
    const lon = (w + rand() * (e - w)).toFixed(5);
    const when = new Date(startMs + rand() * Math.max(0, endMs - startMs)).toISOString();
    const viirs = rand() > 0.3;
    lines.push(
      [
        lat,
        lon,
        `${when.slice(0, 16)}:00Z`,
        viirs ? 'viirs_noaa20' : 'modis',
        viirs ? 'N20' : 'Aqua',
        'nominal',
        (rand() * 40).toFixed(2),
        rand() > 0.4 ? 'D' : 'N',
        '0',
        'Fixture',
      ].join(','),
    );
  }
  // Pretend the cap was hit for very long windows, to exercise the "truncated" notice.
  const truncated = endMs - startMs > 10 * 365 * 86400 * 1000;
  return delay({
    blob: new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }),
    truncated,
    filename: `hotspots_${body.start}_${body.end}.csv`,
  });
}
