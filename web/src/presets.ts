// Example areas a visitor can open with one click: each is a link to a drawn area and a day on the globe.

import { type Corner, boxCorners, formatAreaParam } from "./area";

export type Preset = {
  name: string;
  /** What the area is and why that day, shown as the link's title. */
  note: string;
  region: string;
  area: Corner[];
  /** The UTC day and time the globe opens on. */
  date: string;
  time: string;
  /** Last month of the period, so the headline weighs the year of that day against its history. */
  end: string;
};

// The days are the busiest in each box by VIIRS S-NPP hotspots with the default filters (data/points), as found
// with the queries in the pull request that added them. The boxes are rough: no border data is in the repo.
export const PRESETS: Preset[] = [
  {
    name: "Chornobyl exclusion zone, April 2020",
    note: "A box around the exclusion zone; the globe opens on the day of the April 2020 fires with the most hotspots in it.",
    region: "Ukraine",
    area: boxCorners([29.2, 50.9, 30.9, 51.6]),
    date: "2020-04-08",
    time: "23:59",
    end: "2020-12",
  },
  {
    name: "Southern steppe, summer 2015",
    note: "A box over the steppe from Mykolaiv to Zaporizhzhia, where most burning comes in July and August; the globe opens on its busiest day before 2022.",
    region: "Ukraine",
    area: boxCorners([31.5, 46.3, 36.0, 47.8]),
    date: "2015-08-04",
    time: "23:59",
    end: "2015-12",
  },
];

/** The address of a preset, keeping only the page's theme from the current view; the period starts with the record. */
export function presetHref(preset: Preset, current: URLSearchParams): string {
  const query = new URLSearchParams();
  const theme = current.get("theme");
  if (theme) query.set("theme", theme);
  query.set("region", preset.region);
  query.set("area", formatAreaParam(preset.area));
  query.set("end", preset.end);
  query.set("date", preset.date);
  query.set("time", preset.time);
  return `?${query.toString().replaceAll("%2C", ",").replaceAll("%3B", ";").replaceAll("%3A", ":")}`;
}
