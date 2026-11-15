// Where the reader is on the page: the sections of the report under the map, which of them is on screen, and the
// months a period field offers.

export type Section = { id: string; label: string };

/**
 * The section the reader is in: the last one whose top has reached `line`, the lower edge of the sticky bar in the
 * coordinates of the tops. Before the first section reaches it there is none, as the map is still on screen. At
 * the end of the page the last section is taken, since a short one never gets its top up to the line. Tops come
 * in page order; a section that is not on the page has no entry.
 */
export function activeSection(tops: { id: string; top: number }[], line: number, atEnd = false): string | null {
  if (tops.length === 0) return null;
  if (atEnd) return tops[tops.length - 1].id;
  let active: string | null = null;
  for (const section of tops) {
    if (section.top <= line) active = section.id;
  }
  return active;
}

/** A section's place in the report, as the label over it shows it: 01, 02 and so on. */
export function sectionNumber(sections: Section[], id: string): string {
  return String(sections.findIndex((section) => section.id === id) + 1).padStart(2, "0");
}

/** The years a period field offers: every year from that of `min` to that of `max`, both `YYYY-MM`. */
export function yearsBetween(min: string, max: string): number[] {
  const first = Number(min.slice(0, 4));
  const last = Number(max.slice(0, 4));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

/** Whether month `month` (1 to 12) of `year` lies inside `min` to `max`, both `YYYY-MM` and both included. */
export function monthAllowed(year: number, month: number, min: string, max: string): boolean {
  const text = `${year}-${String(month).padStart(2, "0")}`;
  return text >= min && text <= max;
}

/**
 * A month put together from the two lists of a period field, kept inside `min` to `max`: picking a year whose
 * chosen month is out of range moves to the nearest month that is in it.
 */
export function pickMonth(year: number, month: number, min: string, max: string): string {
  const text = `${year}-${String(month).padStart(2, "0")}`;
  return text < min ? min : text > max ? max : text;
}
