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
  cell_deg: number;
  raw_sensor_switch: string;
  csv_row_limit: number;
  /** What one value means in each series, e.g. "fire cell-days". */
  units: Partial<Record<SeriesName, string>>;
  /** Which sensor speaks for which period in the harmonized record; null until it exists. */
  harmonized_record: RecordPart[] | null;
};

export type RecordPart = { sensor: string; label: string; from: string; to: string | null };

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
  anomaly: Anomaly;
  yearly: YearTotal[];
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
