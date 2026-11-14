/**
 * Defensive reader for `meta.report`, the free-form validation report.
 * Every key may be missing or have an unexpected type; nothing here throws.
 */

export interface ValidationMetrics {
  bias: number | null;
  wapeCountryYear: number | null;
  wapeCountryMonth: number | null;
  wapeTileYear: number | null;
  wapeTileMonth: number | null;
  nMonths: number | null;
}

export interface ValidationRow {
  key: string;
  label: string;
  /** True for the naive baselines the method is compared against. */
  baseline: boolean;
  metrics: ValidationMetrics;
}

export interface SeamSide {
  before: number | null;
  after: number | null;
  jumpRatio: number | null;
}

export interface DetectionPoint {
  /** True for daytime detections, false for night. */
  day: boolean;
  frpFrom: number;
  /** null for the open-ended last bin */
  frpTo: number | null;
  /** Probability that MODIS also detects a fire VIIRS saw. */
  p: number;
}

export interface CountryReport {
  found: boolean;
  calibration: string | null;
  note: string | null;
  validation: ValidationRow[];
  seam: { raw: SeamSide | null; harmonized: SeamSide | null } | null;
  detectionCurve: DetectionPoint[];
  sensorGapMonths: string[];
  /** Description of the error metric, from the top level of the report. */
  metric: string | null;
  generatedAt: string | null;
}

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const VALIDATION_ROWS: { key: string; label: string; baseline: boolean }[] = [
  {
    key: 'viirs_to_modis_leave_one_year_out',
    label: 'Harmonized VIIRS (this method)',
    baseline: false,
  },
  { key: 'baseline_raw_viirs', label: 'Baseline: raw VIIRS counts', baseline: true },
  { key: 'baseline_single_factor', label: 'Baseline: one constant factor', baseline: true },
  { key: 'noaa20_independent', label: 'NOAA-20 years, independent check', baseline: false },
  {
    key: 'terra_only_leave_one_year_out',
    label: 'Terra-only scaling (2000–2002 method)',
    baseline: false,
  },
];

function metrics(value: unknown): ValidationMetrics | null {
  const d = dict(value);
  if (!d) return null;
  const m: ValidationMetrics = {
    bias: num(d.bias),
    wapeCountryYear: num(d.wape_country_year),
    wapeCountryMonth: num(d.wape_country_month),
    wapeTileYear: num(d.wape_tile_year),
    wapeTileMonth: num(d.wape_tile_month),
    nMonths: num(d.n_months),
  };
  const hasAny = Object.values(m).some((v) => v !== null);
  return hasAny ? m : null;
}

function seamSide(value: unknown): SeamSide | null {
  const d = dict(value);
  if (!d) return null;
  const side: SeamSide = {
    before: num(d.before),
    after: num(d.after),
    jumpRatio: num(d.jump_ratio),
  };
  return side.before === null && side.after === null && side.jumpRatio === null ? null : side;
}

function detectionCurve(value: unknown): DetectionPoint[] {
  if (!Array.isArray(value)) return [];
  const out: DetectionPoint[] = [];
  for (const item of value) {
    const d = dict(item);
    if (!d) continue;
    const from = num(d.frp_from_mw);
    const p = num(d.p);
    if (from === null || p === null) continue;
    out.push({
      day: d.has_day === 1 || d.has_day === true,
      frpFrom: from,
      frpTo: num(d.frp_to_mw),
      p,
    });
  }
  return out.sort((a, b) => a.frpFrom - b.frpFrom);
}

const EMPTY: CountryReport = {
  found: false,
  calibration: null,
  note: null,
  validation: [],
  seam: null,
  detectionCurve: [],
  sensorGapMonths: [],
  metric: null,
  generatedAt: null,
};

/** Extract what the "About the method" panel shows for one country. */
export function parseCountryReport(report: unknown, country: string | null): CountryReport {
  const root = dict(report);
  if (!root) return { ...EMPTY };
  const base: CountryReport = {
    ...EMPTY,
    metric: str(root.metric),
    generatedAt: str(root.generated_at_utc),
  };
  const countries = dict(root.countries);
  const entry = country !== null && countries ? dict(countries[country]) : null;
  if (!entry) return base;

  const validationDict = dict(entry.validation);
  const validation: ValidationRow[] = [];
  if (validationDict) {
    for (const row of VALIDATION_ROWS) {
      const m = metrics(validationDict[row.key]);
      if (m) validation.push({ ...row, metrics: m });
    }
  }

  const seamDict = dict(entry.seam);
  const raw = seamDict ? seamSide(seamDict.raw) : null;
  const harmonized = seamDict ? seamSide(seamDict.harmonized) : null;

  return {
    ...base,
    found: true,
    calibration: str(entry.calibration),
    note: str(entry.note),
    validation,
    seam: raw || harmonized ? { raw, harmonized } : null,
    detectionCurve: detectionCurve(entry.detection_curve),
    sensorGapMonths: Array.isArray(entry.sensor_gap_months)
      ? entry.sensor_gap_months.filter((m): m is string => typeof m === 'string')
      : [],
  };
}

/** Label of a detection-curve bin: "0-1", "50+". */
export function frpBinLabel(point: DetectionPoint): string {
  return point.frpTo === null ? `${point.frpFrom}+` : `${point.frpFrom}–${point.frpTo}`;
}
