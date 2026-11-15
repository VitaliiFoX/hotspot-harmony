// Client for the hotspot-harmony API (see api/main.py).

export type SeriesName = "raw" | "harmonized";
export type Bbox = [west: number, south: number, east: number, north: number];
export type Region = { name: string; bbox: Bbox };

export type Meta = {
  regions: Region[];
  series: SeriesName[];
  default_series: SeriesName | null;
  first_month: string | null;
  last_month: string | null;
  /** First and last UTC day with hotspots, "YYYY-MM-DD". */
  first_day?: string | null;
  last_day?: string | null;
  cell_deg: number;
  raw_sensor_switch: string;
  csv_row_limit: number;
  /** What one value means in each series, e.g. "fire cell-days". */
  units: Partial<Record<SeriesName, string>>;
  /** Which sensor speaks for which period in the harmonized record; null until it exists. */
  harmonized_record: RecordPart[] | null;
};

export type RecordPart = { sensor: string; label: string; from: string; to: string | null };

/** Error of a check at each scale, as a share of what MODIS reported (WAPE), and its bias. */
export type ErrorScale = "country_year" | "country_month" | "tile_year" | "tile_month";
export type CheckErrors = { bias: number } & Record<ErrorScale, number>;
export type TrustCheck = "harmonized" | "single_factor" | "raw_viirs";
/** Checks of the record's other parts, when the report has them: NOAA-20 from 2022, Terra alone before July 2002. */
export type ExtraCheck = "noaa20" | "terra_only";
/** Mean yearly total of `after` over `before` (inclusive years), in the raw and in the harmonized record. */
export type SensorJump = { before: string; after: string; raw: number; harmonized: number };
export type TrustCountry = {
  method: string;
  /** How docs/VALIDATION.md names the method, e.g. "the context model". */
  method_name: string;
  /** True when the method was chosen again for every held-out year (`make validate NESTED=1`). */
  method_chosen_per_held_out_year: boolean;
  held_out_months: number;
  checks: Record<TrustCheck, CheckErrors> & Partial<Record<ExtraCheck, CheckErrors>>;
  sensor_jump?: SensorJump | null;
};
/** GET /api/validation: what `make validate` wrote to data/agg/harmonization_report.json. */
export type Validation = {
  source: string;
  generated_at_utc: string | null;
  unit: string | null;
  metric: string | null;
  fit_period: [string, string] | null;
  countries: Record<string, TrustCountry>;
};

export type MonthValue = { year: number; month: number; value: number; sensor: string | null };
export type Climatology = { month: number; median: number; p25: number; p75: number; years: number };
export type Anomaly = {
  year: number;
  month: number;
  value: number;
  median: number;
  ratio: number | null;
  percentile: number;
};
export type YearTotal = { year: number; value: number; complete: boolean };

export type Calendar = {
  series: SeriesName;
  unit: string;
  cells_used: number;
  warnings: string[];
  months: MonthValue[];
  climatology: Climatology[];
  /** The last month of the period against its history. */
  anomaly: Anomaly;
  /** The busiest of the last twelve months of the period against its history: the headline figure. */
  season_peak?: Anomaly;
  yearly: YearTotal[];
};

/** Hotspots of one sensor on each UTC day of a month, zeros included. */
export type MonthDays = {
  month: string;
  sensor: string;
  unit: string;
  /** `day` is the day of the month; a full "YYYY-MM-DD" is accepted too. */
  days: { day: number | string; value: number }[];
  /** Days of the month (1-31) when `sensor` was down: their count is missing data, not a quiet day. */
  gap_days?: number[];
};

/** One hotspot: longitude, latitude, minute of the UTC day (0..1439), index into `regions`. */
export type DayHotspot = [lon: number, lat: number, minute: number, regionIndex: number];

/** The hotspots of one UTC day, sorted by minute. */
export type DayHotspots = {
  date: string;
  sensor: string;
  unit: string;
  count: number;
  truncated: boolean;
  regions: string[];
  hotspots: DayHotspot[];
  /** True when `sensor` was down that day (a sensor gap of the harmonization report): the hotspots are incomplete. */
  sensor_gap?: boolean;
};

export type Polygon = { type: "Polygon"; coordinates: number[][][] };

const BASE: string = import.meta.env.VITE_API_URL ?? "";

/** A rectangle as a GeoJSON polygon, longitude first. */
export function boxPolygon([west, south, east, north]: Bbox): Polygon {
  return {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}

async function failure(response: Response): Promise<Error> {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") detail = body.detail;
  } catch {
    // not JSON: keep the status line
  }
  return new Error(detail);
}

function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export async function fetchMeta(): Promise<Meta> {
  const response = await fetch(`${BASE}/api/meta`);
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** GET /api/cells: where and when it burns, per grid cell, over a period cut to the record. */
export type Cells = {
  series: SeriesName;
  unit: string;
  start: string;
  end: string;
  years: number;
  cell_deg: number;
  /** The halves of the period's full years the trend compares, "YYYY-YYYY"; null with fewer than two full years. */
  halves: { early: string; late: string } | null;
  cells: {
    lat: number; lon: number; per_year: number; years_burning: number; peak_month: number;
    early: number | null; late: number | null; trend: number | null;
  }[];
};

export async function fetchCells(
  start: string,
  end: string,
  signal?: AbortSignal,
  options: { deg?: number; series?: SeriesName } = {},
): Promise<Cells> {
  const query = new URLSearchParams({ start, end, series: options.series ?? "harmonized" });
  if (options.deg) query.set("deg", String(options.deg));
  const response = await fetch(`${BASE}/api/cells?${query}`, { signal });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** POST /api/cells/top: the busiest cells inside an area, most burning a year first. */
export async function fetchTopCells(
  body: { geometry: Polygon; start: string; end: string; limit?: number },
  signal?: AbortSignal,
): Promise<Cells> {
  const response = await post("/api/cells/top", { ...body, series: "harmonized" }, signal);
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function fetchValidation(): Promise<Validation> {
  const response = await fetch(`${BASE}/api/validation`);
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function fetchMonthDays(month: string, signal?: AbortSignal): Promise<MonthDays> {
  const response = await fetch(`${BASE}/api/hotspots/days?month=${encodeURIComponent(month)}`, { signal });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function fetchDayHotspots(date: string, signal?: AbortSignal): Promise<DayHotspots> {
  const response = await fetch(`${BASE}/api/hotspots/day?date=${encodeURIComponent(date)}`, { signal });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function fetchCalendar(
  body: { geometry: Polygon; start: string; end: string; series: SeriesName },
  signal?: AbortSignal,
): Promise<Calendar> {
  const response = await post("/api/calendar", body, signal);
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function fetchHotspotsCsv(body: {
  geometry: Polygon;
  start: string;
  end: string;
}): Promise<{ blob: Blob; truncated: boolean }> {
  const response = await post("/api/hotspots.csv", body);
  if (!response.ok) throw await failure(response);
  return { blob: await response.blob(), truncated: response.headers.get("X-Truncated") === "true" };
}
