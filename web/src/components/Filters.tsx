import { t } from "../i18n";
import type { Meta, SeriesName } from "../api";
import type { Corner } from "../area";
import type { Country, Place } from "../countries";
import { RegionSearch } from "./RegionSearch";

export type FilterState = {
  region: string;
  /** West, south, east, north as typed; validated before a request is made. */
  box: [string, string, string, string];
  /** The corners of an area drawn on the globe. When set it is the area of interest and `box` holds its bounds. */
  area: Corner[] | null;
  /**
   * The country picked on the globe, by its Natural Earth name. When set, the area of interest is its border
   * and `box` holds its bounds; `region` is the region whose record holds it, when one does.
   */
  country: string | null;
  start: string;
  end: string;
  series: SeriesName;
};

type Props = {
  meta: Meta;
  value: FilterState;
  onChange: (next: FilterState) => void;
  onDownload: () => void;
  downloading: boolean;
  problem: string | null;
  /** False while the picked country has no record to download from. */
  hasData?: boolean;
  /** The borders of every country, for the region search; empty until they arrive. */
  countries?: Country[];
  /** Load country borders on demand when the region search opens. */
  onEnsureCountries?: () => void;
  /** Take a country found by the region search as the area of interest, by its border. */
  onPickCountry?: (name: string) => void;
};

const BOX_LABELS = ["West", "South", "East", "North"] as const;

/** One row of controls that scope everything below it. */
export function Filters({
  meta, value, onChange, onDownload, downloading, problem, hasData = true, countries = [], onEnsureCountries, onPickCountry,
}: Props) {
  function pickRegion(name: string) {
    const region = meta.regions.find((r) => r.name === name);
    if (region) {
      onChange({ ...value, region: name, box: region.bbox.map(String) as FilterState["box"], area: null, country: null });
    }
  }
  function setBox(index: number, text: string) {
    const box = [...value.box] as FilterState["box"];
    box[index] = text;
    onChange({ ...value, box, area: null, country: null });
  }
  // A region is taken by its box, as the region list always did; any other country by its border.
  function pickPlace(place: Place) {
    if (place.kind === "region") pickRegion(place.name);
    else onPickCountry?.(place.name);
  }
  const drawn = value.area !== null;
  // A drawn area and a picked country both fix the area of interest: the box fields then only show its bounds.
  const fixed = drawn || value.country !== null;
  return (
    <form className="filters" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span>{t("Period, from")}</span>
        <input
          type="month"
          value={value.start}
          min={meta.first_month ?? undefined}
          max={value.end}
          pattern="\d{4}-\d{2}"
          onChange={(event) => event.target.value && onChange({ ...value, start: event.target.value })}
        />
      </label>
      <label>
        <span>{t("to")}</span>
        <input
          type="month"
          value={value.end}
          min={value.start}
          max={meta.last_month ?? undefined}
          pattern="\d{4}-\d{2}"
          onChange={(event) => event.target.value && onChange({ ...value, end: event.target.value })}
        />
      </label>
      <RegionSearch
        regions={meta.regions}
        countries={onPickCountry ? countries : []}
        current={value.country ?? value.region}
        onPick={pickPlace}
        onOpen={onEnsureCountries}
      />
      <fieldset>
        <legend>
          {drawn
            ? t("Area of interest: drawn on the map, {n} corners. Its bounds, degrees", { n: value.area?.length ?? 0 })
            : value.country
              ? t("Area of interest: {country}, inside its border. Its bounds, degrees", { country: t(value.country) })
              : t("Area of interest, degrees")}
        </legend>
        {BOX_LABELS.map((label, index) => (
          <label key={label} className="coordinate">
            <span>{t(label)}</span>
            <input
              type="number"
              step="0.25"
              value={value.box[index]}
              readOnly={fixed}
              aria-invalid={problem !== null}
              onChange={(event) => setBox(index, event.target.value)}
            />
          </label>
        ))}
        {fixed && (
          <button type="button" onClick={() => pickRegion(value.region)}>
            {drawn ? t("Remove the drawn area") : t("Back to the box of {region}", { region: t(value.region) })}
          </button>
        )}
      </fieldset>
      <fieldset>
        <legend>{t("Record")}</legend>
        <div className="segmented">
          {(["harmonized", "raw"] as SeriesName[]).map((name) => {
            const available = meta.series.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={value.series === name}
                disabled={!available}
                title={available ? undefined : t("The pipeline has not produced this record yet")}
                onClick={() => onChange({ ...value, series: name })}
              >
                {name === "raw" ? t("Raw") : t("Harmonized")}
              </button>
            );
          })}
        </div>
      </fieldset>
      <button type="button" className="primary" onClick={onDownload} disabled={downloading || problem !== null || !hasData}>
        {downloading ? t("Preparing CSV...") : t("Download hotspots (CSV)")}
      </button>
      {problem && (
        <p className="filter-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
