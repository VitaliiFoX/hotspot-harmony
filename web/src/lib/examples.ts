import type { CountryMeta, Meta } from '../api/types';
import { bboxToPolygon, type AreaGeometry } from './geometry';

export interface ExampleArea {
  id: string;
  label: string;
  geometry: AreaGeometry;
}

const UKRAINE = 'Ukraine';

/** Hand-picked areas inside Ukraine: [west, south, east, north]. */
const UKRAINE_EXAMPLES: { id: string; label: string; bbox: number[] }[] = [
  { id: 'chornobyl', label: 'Chornobyl Exclusion Zone', bbox: [29.2, 51.1, 30.6, 51.6] },
  { id: 'kherson', label: 'Kherson region', bbox: [32.0, 45.9, 35.3, 47.6] },
];

/** The country shown first: Ukraine when it is available, otherwise the first one listed. */
export function defaultCountry(meta: Pick<Meta, 'countries'> | null): CountryMeta | null {
  if (!meta || meta.countries.length === 0) return null;
  return meta.countries.find((c) => c.name === UKRAINE) ?? meta.countries[0] ?? null;
}

function fromBBox(id: string, label: string, bbox: readonly number[]): ExampleArea | null {
  const polygon = bboxToPolygon(bbox);
  return polygon.ok ? { id, label, geometry: polygon.value } : null;
}

/** One-click example areas: two places in Ukraine, then every available country as a whole. */
export function buildExamples(meta: Pick<Meta, 'countries'> | null): ExampleArea[] {
  if (!meta) return [];
  const out: (ExampleArea | null)[] = [];
  if (meta.countries.some((c) => c.name === UKRAINE)) {
    for (const e of UKRAINE_EXAMPLES) out.push(fromBBox(e.id, e.label, e.bbox));
  }
  const first = defaultCountry(meta);
  const ordered = first ? [first, ...meta.countries.filter((c) => c !== first)] : [];
  for (const country of ordered) {
    out.push(fromBBox(`country-${country.name}`, `Whole ${country.name}`, country.bbox));
  }
  return out.filter((e): e is ExampleArea => e !== null);
}

/** Area loaded on first visit: the whole default country. */
export function defaultArea(meta: Pick<Meta, 'countries'> | null): AreaGeometry | null {
  const country = defaultCountry(meta);
  if (!country) return null;
  const polygon = bboxToPolygon(country.bbox);
  return polygon.ok ? polygon.value : null;
}
