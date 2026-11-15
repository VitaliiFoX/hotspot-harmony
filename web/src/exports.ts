// Downloads of what the dashboard shows: the calendar as CSV, and any chart card as a PNG image.

import type { Calendar } from "./api";

export type ExportContext = {
  region: string;
  /** West, south, east, north of the area of interest, degrees: its bounds when the area was drawn. */
  box: readonly number[];
  /** The area of interest as well-known text, longitude first; empty when it is a country's border. */
  wkt: string;
  /** The country picked on the globe, when the area of interest is its border. */
  country?: string | null;
  /** Border edition counted when `country` is set and `area_wkt` is omitted. */
  areaSource?: string | null;
};

function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * The burning activity calendar as CSV: one row per month of the selected period, with that calendar month's
 * median and middle half over the whole record, and the month's ratio to its median. Every row repeats the
 * record, unit and area so a row read on its own still says what it is. The area is given twice: its bounds
 * in four columns, and its exact outline as well-known text, which differs from the bounds when it was drawn.
 * A country picked on the globe is named in `country` with its border edition in `area_source` instead: its
 * border (web/public/countries.geojson) has thousands of points, too many to repeat on every row, so `area_wkt`
 * is then empty.
 */
export function calendarCsv(calendar: Calendar, context: ExportContext): string {
  const climatology = new Map(calendar.climatology.map((c) => [c.month, c]));
  const [west, south, east, north] = context.box;
  const header = [
    "year", "month", "value", "unit", "record", "sensor", "month_median", "month_p25", "month_p75",
    "ratio_to_median", "region", "country", "area_source", "west", "south", "east", "north", "area_wkt",
  ];
  const rows = calendar.months.map((m) => {
    const c = climatology.get(m.month);
    const ratio = c && c.median > 0 ? round(m.value / c.median, 2) : null;
    return [
      m.year, m.month, round(m.value), calendar.unit, calendar.series, m.sensor ?? "",
      c ? round(c.median) : null, c ? round(c.p25) : null, c ? round(c.p75) : null,
      ratio, context.region, context.country ?? "", context.areaSource ?? "", west, south, east, north, context.wkt,
    ];
  });
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

/** A file name from its parts, lower case, safe on every system. */
export function exportName(parts: (string | number)[], extension: string): string {
  const stem = parts
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("_");
  return `${stem}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const SVG_PAINT = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "opacity", "filter", "font-family", "font-size", "font-weight", "font-variant-numeric", "text-anchor",
  "stop-color", "stop-opacity",
];

/** A chart card as a PNG at twice the screen resolution, without its buttons, on the card's own background. */
export async function downloadPng(node: HTMLElement, filename: string): Promise<void> {
  const { toPng } = await import("html-to-image");
  const background = getComputedStyle(node).backgroundColor;
  // SVG marks are painted by CSS classes and custom properties, which the image renderer does not resolve:
  // write each mark's computed paint into its style attribute for the moment of the capture.
  const marks = [...node.querySelectorAll<SVGElement>("svg *")];
  const saved = marks.map((el) => el.getAttribute("style"));
  for (const el of marks) {
    const computed = getComputedStyle(el);
    for (const property of SVG_PAINT) el.style.setProperty(property, computed.getPropertyValue(property));
  }
  let url: string;
  try {
    url = await toPng(node, {
      pixelRatio: 2,
      backgroundColor: background,
      filter: (element) => !(element instanceof HTMLElement && element.dataset.export === "skip"),
    });
  } finally {
    marks.forEach((el, i) => (saved[i] === null ? el.removeAttribute("style") : el.setAttribute("style", saved[i]!)));
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}
