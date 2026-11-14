import type { AreaGeometry } from '../lib/geometry';

/** Types for the Hotspot Harmony API. They mirror the backend contract exactly. */

export interface HealthResponse {
  status: string;
}

export interface CountryMeta {
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** "YYYY-MM" */
  start: string;
  /** "YYYY-MM" */
  end: string;
  calibration?: string;
}

export interface RecordPeriod {
  sensor: string;
  label: string;
  /** "YYYY-MM" */
  from: string;
  /** "YYYY-MM", or null for "still running" */
  to: string | null;
}

export interface Meta {
  unit: string;
  unit_short: string;
  attribution: string;
  grid: { cell_deg: number };
  series: { start: string; end: string };
  countries: CountryMeta[];
  record: RecordPeriod[];
  /** Free-form validation report; read it only through lib/report.ts. */
  report?: unknown;
}

export interface CalendarRequest {
  geometry: AreaGeometry;
  /** "YYYY-MM" */
  start?: string;
  /** "YYYY-MM" */
  end?: string;
}

export interface MonthValue {
  year: number;
  month: number;
  n_harmonized: number;
  n_raw: number;
  sensor_used: string;
  lo: number;
  hi: number;
}

export interface ClimatologyMonth {
  month: number;
  median: number;
  p25: number;
  p75: number;
  years: number;
}

export interface Anomaly {
  year: number;
  month: number;
  value: number;
  median: number;
  /** null when the median is 0 */
  ratio: number | null;
  percentile: number;
  lo: number;
  hi: number;
  /** Optional addition: number of earlier years the month is compared with. */
  years_compared?: number;
}

export interface YearValue {
  year: number;
  n_harmonized: number;
  n_raw: number;
  complete: boolean;
}

/** Optional addition: months of the range that stand out most against the usual level. */
export interface TopMonth {
  year: number;
  month: number;
  value: number;
  median: number;
  /** null when the median is 0 */
  ratio: number | null;
}

export interface CalendarResponse {
  cells_used: number;
  countries: string[];
  months: MonthValue[];
  climatology: ClimatologyMonth[];
  anomaly: Anomaly | null;
  yearly: YearValue[];
  top_months?: TopMonth[];
  unit?: string;
}

export interface HotspotsCsvRequest {
  geometry: AreaGeometry;
  /** "YYYY-MM-DD" */
  start: string;
  /** "YYYY-MM-DD" */
  end: string;
}

export interface HotspotsCsvResult {
  blob: Blob;
  /** True when the server capped the file at 500,000 rows (X-Truncated: true). */
  truncated: boolean;
  filename: string;
}
