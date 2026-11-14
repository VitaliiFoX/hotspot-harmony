/** Colour scales. All are colour-blind safe; none relies on a red-green contrast. */

/** Viridis, dark to light (matplotlib reference stops). */
export const VIRIDIS = [
  '#440154',
  '#482878',
  '#3e4989',
  '#31688e',
  '#26828e',
  '#1f9e89',
  '#35b779',
  '#6ece58',
  '#b5de2b',
  '#fde725',
] as const;

/**
 * Viridis reversed: light yellow for low counts, dark purple for high counts,
 * so "more fire" reads as "darker" on the light page.
 */
export const VIRIDIS_LOW_TO_HIGH = [...VIRIDIS].reverse();

/** ColorBrewer PuOr (11 classes), purple = below usual, orange = above usual. */
export const PUOR_BELOW_TO_ABOVE = [
  '#2d004b',
  '#542788',
  '#8073ac',
  '#b2abd2',
  '#d8daeb',
  '#f7f7f7',
  '#fee0b6',
  '#fdb863',
  '#e08214',
  '#b35806',
  '#7f3b08',
] as const;

/** Cell colour for a month with no hotspots at all. */
export const ZERO_COLOR = '#e9ebe6';

/**
 * Series colours: the entity keeps its colour in every chart. Each pair that
 * shares a chart was checked for colour-vision-deficiency separation
 * (harmonized/raw, median/latest year, day/night); lines also differ in dash
 * or marker so colour is never the only cue.
 */
export const SERIES = {
  harmonized: '#2a78d6',
  raw: '#c9521f',
  /** The usual level comes from the harmonized record, so it shares its blue. */
  median: '#2a78d6',
  band: '#cde2fb',
  latest: '#b8457f',
  day: '#b35806',
  night: '#6b4bb5',
} as const;

export const INK = {
  text: '#1c2733',
  muted: '#566373',
  grid: '#e3e6e1',
  axis: '#aab2bb',
  surface: '#ffffff',
} as const;

/** Deviation is shown on a log2 scale clamped to +-3 (1/8 to 8 times the usual level). */
export const DEVIATION_LIMIT = 3;

/** Pick a colour from a list of stops for t in [0, 1] (nearest stop, no interpolation). */
export function pickStop(stops: readonly string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const index = Math.round(clamped * (stops.length - 1));
  return stops[index] ?? stops[0] ?? '#000000';
}
