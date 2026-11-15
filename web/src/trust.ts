// How far the harmonized record can be trusted: the wording and the choices of the trust block, kept pure.

import type { ErrorScale, TrustCheck, TrustCountry } from "./api";

/** The scales of the check, coarse to fine, as the table shows them. */
export const SCALES: readonly ErrorScale[] = ["country_year", "country_month", "tile_year", "tile_month"];

export const SCALE_LABELS: Record<ErrorScale, string> = {
  country_year: "Country, per year",
  country_month: "Country, per month",
  tile_year: "1° tile, per year",
  tile_month: "1° tile, per month",
};

/** The method first, then the two baselines it has to beat. */
export const CHECKS: readonly TrustCheck[] = ["harmonized", "single_factor", "raw_viirs"];

export const CHECK_LABELS: Record<TrustCheck, string> = {
  harmonized: "This method, on years it did not see",
  // pipeline.validate fits it on every year at once, the scored year included: an advantage the method lacks.
  single_factor: "Baseline: one scaling factor, fitted on all years",
  raw_viirs: "Baseline: VIIRS as delivered, no correction",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A share as a percentage with one decimal: 0.0662 is "6.6%". */
export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** A ratio as the change it means: 2.0 is "+100%", 0.902 is "−10%". */
export function change(ratio: number): string {
  const percentChange = Math.round((ratio - 1) * 100);
  if (percentChange === 0) return "no change";
  return percentChange > 0 ? `+${percentChange}%` : `−${-percentChange}%`;
}

/** A bias with its sign, so over- and under-counting read apart: 0.0076 is "+0.8%". */
export function signedPercent(share: number): string {
  const text = percent(Math.abs(share));
  if (text === "0.0%") return text;
  return share > 0 ? `+${text}` : `−${text}`;
}

/** The scales where one plain scaling factor beats the method. The page says so rather than hide it. */
export function scalesWhereFactorWins(country: TrustCountry): ErrorScale[] {
  return SCALES.filter((scale) => country.checks.single_factor[scale] < country.checks.harmonized[scale]);
}

/**
 * The monthly error to expect for the area on screen. A whole country reads the country figure; any smaller area
 * reads the 1-degree tile figure, the finest scale that was checked.
 */
export function expectedError(country: TrustCountry, wholeRegion: boolean): { scale: ErrorScale; share: number } {
  const scale: ErrorScale = wholeRegion ? "country_month" : "tile_month";
  return { scale, share: country.checks.harmonized[scale] };
}

/** The command that wrote the figures: only `NESTED=1` keeps the choice of method away from the held-out year. */
export function validateCommand(country: TrustCountry): string {
  return country.method_chosen_per_held_out_year ? "make validate NESTED=1" : "make validate";
}

/** "2026-11-14T21:50:59Z" as "14 November 2026, 21:50 UTC". */
export function reportTime(iso: string | null): string {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "an unknown time";
  const [, year, month, day, hour, minute] = match;
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year}, ${hour}:${minute} UTC`;
}
