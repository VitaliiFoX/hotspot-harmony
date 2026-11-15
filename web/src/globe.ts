// Pure logic behind the globe and the date and time panel: dates, counts, scales and the night side.

import type { FilterSpecification } from "maplibre-gl";
import type { Bbox, DayHotspot, Region } from "./api";
import { dayInWords, formatCount, monthName, monthTitle, t, tn } from "./i18n";


/** The date the globe opens on when the record covers it: a busy day in the southern burning season. */
export const PREFERRED_DATE = "2025-08-20";
/** Time of day the globe opens on, in minutes after 00:00 UTC (23:59, the whole day). */
export const DEFAULT_TIME = 23 * 60 + 59;
export const LAST_MINUTE = 24 * 60 - 1;

/** How the map at the top of the page is shown: the 3D globe, or the flat world map (Web Mercator). */
export type MapView = "globe" | "flat";
export const DEFAULT_VIEW: MapView = "globe";

/** `?view=` from the address; anything unknown or missing is the globe. */
export function parseViewParam(text: string | null): MapView {
  return text === "flat" || text === "globe" ? text : DEFAULT_VIEW;
}

/**
 * Zoom at which the flat world (512 px square at zoom 0) covers a map of this size on both sides, so no sky shows
 * around it. Zoom 0 for a map with no size yet.
 */
export function flatFillZoom(width: number, height: number): number {
  const side = Math.max(width, height);
  return side > 0 ? Math.log2(side / 512) : 0;
}

/** "YYYY-MM-DD" if the text is a real calendar date written that way, otherwise null. */
export function parseDateParam(text: string | null): string | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return text;
}

/** A whole hour 0..23, or null for anything else. */
/**
 * The time of day from the address, in minutes after 00:00 UTC: "HH:MM", or an older link's whole hour
 * "HH", read as the end of that hour. Null when it is not a time of day.
 */
export function parseTimeParam(time: string | null, hour: string | null = null): number | null {
  const hm = time?.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const [h, m] = [Number(hm[1]), Number(hm[2])];
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  }
  if (hour && /^\d{1,2}$/.test(hour) && Number(hour) <= 23) return Number(hour) * 60 + 59;
  return null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Keep a date inside first..last; dates compare as text because they are zero-padded. */
export function clampDate(date: string, first: string, last: string): string {
  if (date < first) return first;
  if (date > last) return last;
  return date;
}

/** The date to open on: the preferred day when the record covers it, otherwise the last day. */
export function defaultDate(first: string, last: string): string {
  return PREFERRED_DATE >= first && PREFERRED_DATE <= last ? PREFERRED_DATE : last;
}

/** "YYYY-MM" moved by a number of months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * The same day number in another month, shortened to that month's length (31 March to February
 * gives the 28th or 29th) and kept inside first..last.
 */
export function moveToMonth(date: string, month: string, first: string, last: string): string {
  const [year, index] = month.split("-").map(Number);
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, index));
  return clampDate(`${month}-${String(day).padStart(2, "0")}`, first, last);
}

/** The days of a month laid out Monday first: null for each blank before the 1st. */
export function monthGrid(month: string): (string | null)[] {
  const [year, index] = month.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, index - 1, 1)).getUTCDay(); // 0 is Sunday
  const blanks = (weekday + 6) % 7;
  const days: (string | null)[] = Array.from({ length: blanks }, () => null);
  for (let day = 1; day <= daysInMonth(year, index); day++) days.push(`${month}-${String(day).padStart(2, "0")}`);
  return days;
}

/** A month's day as "YYYY-MM-DD", whether given as the day of the month or already as a date. */
export function dayKey(month: string, day: number | string): string {
  if (typeof day === "string" && day.length === 10) return day;
  return `${month}-${String(Number(day)).padStart(2, "0")}`;
}

/** "20 August 2025". */
export function longDate(date: string): string {
  return dayInWords(date);
}

/** "August 2025". */
export function longMonth(month: string): string {
  return `${monthTitle(Number(month.slice(5, 7)))} ${month.slice(0, 4)}`;
}

/** "18:00". */
export function hourLabel(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes after 00:00 as "HH:MM". */
export function timeLabel(time: number): string {
  return hourLabel(Math.floor(time / 60), time % 60);
}

/** A sensor id as people read it: "viirs_snpp" is "VIIRS S-NPP". */
export function sensorLabel(sensor: string): string {
  const known: Record<string, string> = {
    modis: "MODIS",
    viirs_snpp: "VIIRS S-NPP",
    viirs_noaa20: "VIIRS NOAA-20",
    viirs_noaa21: "VIIRS NOAA-21",
  };
  return known[sensor] ?? sensor.replaceAll("_", " ").toUpperCase();
}

export type RegionCounts = { throughHour: number; inHour: number; day: number };
export type HourCounts = RegionCounts & { regions: RegionCounts[] };

/**
 * Hotspots from 00:00 through `time` (minutes after 00:00 UTC, inclusive), in the hour up to it, and in the
 * whole day, overall and per region. Over a period the third field of a hotspot is its day of the period instead
 * of its minute: `time` is then a day and `window` 1, so "in the hour" reads "on that day".
 */
export function countHotspots(hotspots: DayHotspot[], time: number, regionCount: number, window = 60): HourCounts {
  const start = time - (window - 1);
  const end = time + 1;
  const regions: RegionCounts[] = Array.from({ length: regionCount }, () => ({ throughHour: 0, inHour: 0, day: 0 }));
  const total: RegionCounts = { throughHour: 0, inHour: 0, day: 0 };
  for (const [, , minute, regionIndex] of hotspots) {
    const targets = regions[regionIndex] ? [total, regions[regionIndex]] : [total];
    for (const counts of targets) {
      counts.day++;
      if (minute < end) counts.throughHour++;
      if (minute >= start && minute < end) counts.inHour++;
    }
  }
  return { ...total, regions };
}

/** Size in px and opacity of a day's dot in the calendar, by the square root of its share of the month's maximum. */
export function dotStyle(value: number, monthMax: number): { size: number; opacity: number } | null {
  if (value <= 0 || monthMax <= 0) return null;
  const share = Math.sqrt(Math.min(value / monthMax, 1));
  return { size: 4 + 4 * share, opacity: 0.35 + 0.65 * share };
}

/** Map filters: every hotspot up to the end of the hour, and those detected within the hour (or on that day of a period). */
export function hourFilters(time: number, window = 60): { through: FilterSpecification; inHour: FilterSpecification } {
  return {
    through: ["<=", ["get", "minute"], time],
    inHour: ["all", [">", ["get", "minute"], time - window], ["<=", ["get", "minute"], time]],
  };
}

/** The region whose box holds a point, or null. Boxes are checked in the order of the list. */
export function regionAt(regions: Region[], lon: number, lat: number): Region | null {
  return regions.find(({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n) ?? null;
}

/** The point on the sphere halfway between the regions' box centres, so a globe centred there shows them all if it can. */
export function regionsCenter(regions: Region[]): { lon: number; lat: number } {
  if (regions.length === 0) return { lon: 0, lat: 20 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { bbox } of regions) {
    const lon = toRad((bbox[0] + bbox[2]) / 2);
    const lat = toRad((bbox[1] + bbox[3]) / 2);
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }
  return { lon: toDeg(Math.atan2(y, x)), lat: toDeg(Math.atan2(z, Math.hypot(x, y))) };
}

/** A box as a closed ring of [lon, lat] corners. */
export function boxRing([west, south, east, north]: Bbox): [number, number][] {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

/** Milliseconds of the middle of an hour of a UTC day, the instant the night side is drawn for. */
/** The instant shown: the selected day at the selected minute, UTC. */
export function hourInstant(date: string, time: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 0, time);
}

/**
 * Where the Sun is overhead at an instant. Longitude from the UTC time alone (no equation of time,
 * at most about 4 degrees off); declination from -23.44 cos(360/365 (N + 10)) with N the days since
 * 1 January 00:00 UTC, within about a degree.
 */
export function subsolarPoint(ms: number): { lon: number; lat: number } {
  const time = new Date(ms);
  const hours = time.getUTCHours() + time.getUTCMinutes() / 60 + time.getUTCSeconds() / 3600;
  const dayOfYear = (ms - Date.UTC(time.getUTCFullYear(), 0, 1)) / 86_400_000;
  let lon = (12 - hours) * 15;
  if (lon > 180) lon -= 360;
  if (lon <= -180) lon += 360;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  return { lon, lat };
}

/**
 * The night hemisphere as one polygon: the terminator traced from 180 W to 180 E, closed over the
 * pole that is in darkness. Near the equinoxes the declination is held a little off zero so the
 * terminator stays a function of longitude. Latitudes stop at the edge of Web Mercator, because
 * the map tiles its sources in that projection and cannot place a vertex on a pole.
 */
export function nightPolygon(ms: number, steps = 180): { type: "Polygon"; coordinates: [number, number][][] } {
  const sun = subsolarPoint(ms);
  const declination = toRad(Math.abs(sun.lat) < 0.1 ? (sun.lat < 0 ? -0.1 : 0.1) : sun.lat);
  const darkPole = declination > 0 ? -MERCATOR_LIMIT : MERCATOR_LIMIT;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const lon = -180 + (360 * i) / steps;
    const lat = toDeg(Math.atan(-Math.cos(toRad(lon - sun.lon)) / Math.tan(declination)));
    ring.push([lon, round(Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat)))]);
  }
  ring.push([180, darkPole], [-180, darkPole], ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

/** The terminator alone, west to east, without the closing edge over the dark pole: drawn blurred to soften it. */
export function terminatorLine(ms: number, steps = 180): { type: "LineString"; coordinates: [number, number][] } {
  return { type: "LineString", coordinates: nightPolygon(ms, steps).coordinates[0].slice(0, steps + 1) };
}

/** The latitude where Web Mercator ends, atan(sinh(pi)). */
export const MERCATOR_LIMIT = 85.0511;

/** Whether a point is on the night side: the Sun below its horizon. */
export function isNight(ms: number, lon: number, lat: number): boolean {
  const sun = subsolarPoint(ms);
  const elevation =
    Math.sin(toRad(lat)) * Math.sin(toRad(sun.lat)) +
    Math.cos(toRad(lat)) * Math.cos(toRad(sun.lat)) * Math.cos(toRad(lon - sun.lon));
  return elevation < 0;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** One grid cell of /api/cells: where and when it burns over the chosen period. */
export type BurnCell = {
  lat: number;
  lon: number;
  per_year: number;
  years_burning: number;
  peak_month: number;
  /** Mean yearly value of the first and the second half of the period's full years, and the second over the first. */
  early?: number | null;
  late?: number | null;
  trend?: number | null;
};

/**
 * The change of a cell in doublings (log2 of the ratio), what the trend map colours: 0 when the change is inside the
 * method's error (`error`, a share), capped at two doublings either way, null when the first half did not burn.
 */
export function trendChange(trend: number | null | undefined, error: number): number | null {
  if (trend === null || trend === undefined) return null;
  if (Math.abs(trend - 1) <= error) return 0;
  return Math.max(-2, Math.min(2, Math.round(Math.log2(trend) * 1000) / 1000));
}

function yearsLabel(span: string): string {
  return span.replace("-", "–");
}

/** What the hover over a cell says on the trend map. */
export function trendSentence(
  cell: Pick<BurnCell, "early" | "late" | "trend">,
  halves: { early: string; late: string },
  error: number,
): string {
  const early = yearsLabel(halves.early);
  const late = yearsLabel(halves.late);
  if (cell.trend === null || cell.trend === undefined) {
    const amount = (cell.late ?? 0) >= 10 ? Math.round(cell.late ?? 0).toString() : (cell.late ?? 0).toFixed(1);
    return t("No burning in {early}, so no change can be given; about {amount} a year in {late}.", { early, amount, late });
  }
  const percentChange = Math.round((cell.trend - 1) * 100);
  const signed = percentChange > 0 ? `+${percentChange}%` : percentChange < 0 ? `−${-percentChange}%` : t("no change");
  if (Math.abs(cell.trend - 1) <= error) {
    return t("{late} against {early}: {signed}, within the method's error of ±{error}%.", {
      late, early, signed, error: Math.round(error * 100),
    });
  }
  return t("{late} against {early}: {signed} ({ratio}×).", { late, early, signed, ratio: cell.trend.toFixed(2) });
}

/** The cells that burn most a year, most first: what the globe's table lists in "Where it burns". */
export function busiestCells<T extends Pick<BurnCell, "per_year" | "lat" | "lon">>(cells: readonly T[], limit = 25): T[] {
  return [...cells].sort((a, b) => b.per_year - a.per_year || b.lat - a.lat || a.lon - b.lon).slice(0, limit);
}

/** The change of a cell as the table writes it: "+40%", "−12%", "within the error" or a dash when it did not burn before. */
export function changeLabel(trend: number | null | undefined, error: number): string {
  if (trend === null || trend === undefined) return "–";
  if (Math.abs(trend - 1) <= error) return t("within the error");
  const percentChange = Math.round((trend - 1) * 100);
  return percentChange > 0 ? `+${percentChange}%` : percentChange < 0 ? `−${-percentChange}%` : t("no change");
}

const KM_PER_DEGREE = 111.32;

/** Area of a grid cell, km2: a degree of longitude shrinks with the cosine of the latitude. */
export function cellAreaKm2(lat: number, cellDeg: number): number {
  return (cellDeg * KM_PER_DEGREE) ** 2 * Math.cos((lat * Math.PI) / 180);
}

/** Burning per year per 100 km2, to one decimal: what the map colours, so cells compare across latitudes. */
function density(cell: BurnCell, cellDeg: number): number {
  return Math.round((cell.per_year / cellAreaKm2(cell.lat, cellDeg)) * 100 * 10) / 10;
}

/** The cells as squares of the grid around their centres, carrying what the map colours and the hover reads. */
export function cellSquares(cells: readonly BurnCell[], cellDeg: number, trendError = 0) {
  const half = cellDeg / 2;
  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => ({
      type: "Feature" as const,
      properties: {
        lat: cell.lat, lon: cell.lon, per_year: cell.per_year, years_burning: cell.years_burning, peak_month: cell.peak_month,
        density: density(cell, cellDeg), early: cell.early ?? null, late: cell.late ?? null, trend: cell.trend ?? null,
        change: trendChange(cell.trend, trendError),
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [cell.lon - half, cell.lat - half], [cell.lon + half, cell.lat - half], [cell.lon + half, cell.lat + half],
          [cell.lon - half, cell.lat + half], [cell.lon - half, cell.lat - half],
        ]],
      },
    })),
  };
}

/** A colour step as the legend prints it: whole numbers from 10, one decimal below, two below 0.1. */
export function stopLabel(value: number): string {
  if (value >= 10) return String(Math.round(value));
  if (value >= 0.1) return value.toFixed(1);
  return value.toFixed(2);
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * Where the colour of the cells steps up: the median, the upper quartile, the 90th and the 98th percentile of their
 * burning per year, so a few extreme cells do not wash the rest out. Strictly rising, as the map requires.
 */
export function cellStops(values: readonly number[]): [number, number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const raw = sorted.length ? [0.5, 0.75, 0.9, 0.98].map((q) => Math.round(quantile(sorted, q) * 100) / 100) : [1, 1, 1, 1];
  const stops = [raw[0]];
  for (const value of raw.slice(1)) stops.push(Math.max(value, Math.round((stops[stops.length - 1] + 0.001) * 1000) / 1000));
  return stops as [number, number, number, number];
}

/** What the hover over a cell says: how often, how much (also per 100 km2) and when it burns. */
export function cellSentence(cell: BurnCell, years: number, unit: string, cellDeg: number): string {
  const amount = cell.per_year >= 10 ? formatCount(Math.round(cell.per_year)) : cell.per_year.toFixed(1);
  const perArea = stopLabel((cell.per_year / cellAreaKm2(cell.lat, cellDeg)) * 100);
  return tn(
    cell.years_burning,
    "Burned in {n} of {years} years, about {amount} {unit} a year ({perArea} per 100 km²), most in {month}.",
    "Burns in {n} of {years} years, about {amount} {unit} a year ({perArea} per 100 km²), most in {month}.",
    { years, amount, unit: t(unit), perArea, month: monthName(cell.peak_month) },
  );
}

/** A cell centre as people read it: "48.13° N, 37.63° E". */
export function latLonLabel(lat: number, lon: number): string {
  const part = (value: number, positive: string, negative: string) =>
    `${(Math.round(Math.abs(value) * 100) / 100).toFixed(2)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, t("N"), t("S"))}, ${part(lon, t("E"), t("W"))}`;
}
