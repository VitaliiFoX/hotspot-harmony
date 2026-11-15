// When to ask the API, and when not to: the rules that make the page answer at once.

import type { AreaGeometry, Calendar, SeriesName } from "./api";

export type CalendarBody = { geometry: AreaGeometry; start: string; end: string; series: SeriesName };
export type View = {
  region: string;
  box: readonly string[];
  start: string;
  end: string;
  series: SeriesName;
  /** The corners of an area drawn on the globe; absent or null when the area is the box. */
  area?: readonly (readonly number[])[] | null;
  /** The country picked on the globe, counted inside its border; absent or null when none is. */
  country?: string | null;
};

/** Typing coordinates sends a keystroke at a time, so those requests wait for a pause. */
export const TYPING_PAUSE_MS = 300;

/**
 * How long to wait before asking for a new view. Only a box edited by hand waits: a first load, a
 * region, a date, a switch between the raw and the harmonized record, an area drawn on the globe or
 * removed from it, or a country picked there or let go is one deliberate action.
 */
export function delayFor(previous: View | null, next: View): number {
  if (!previous || next.area || previous.area || next.country || previous.country) return 0;
  const boxEdited = previous.box.join(",") !== next.box.join(",");
  const restSame =
    previous.region === next.region &&
    previous.start === next.start &&
    previous.end === next.end &&
    previous.series === next.series;
  return boxEdited && restSame ? TYPING_PAUSE_MS : 0;
}

export function requestKey(body: CalendarBody): string {
  return [body.series, body.start, body.end, JSON.stringify(body.geometry.coordinates)].join("|");
}

/** The record the viewer is not looking at, if the API serves it: fetched ahead so the switch is instant. */
export function otherSeries(current: SeriesName, available: readonly SeriesName[]): SeriesName | null {
  return available.find((name) => name !== current) ?? null;
}

/** Answers already received, newest kept. A view seen before is shown without asking again. */
export class CalendarCache {
  private readonly entries = new Map<string, Calendar>();

  constructor(private readonly limit = 40) {}

  get(body: CalendarBody): Calendar | undefined {
    return this.entries.get(requestKey(body));
  }

  set(body: CalendarBody, calendar: Calendar): void {
    const key = requestKey(body);
    this.entries.delete(key);
    this.entries.set(key, calendar);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
