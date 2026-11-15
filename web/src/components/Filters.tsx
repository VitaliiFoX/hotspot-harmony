import type { Meta, SeriesName } from "../api";
import type { Corner } from "../area";

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
};

const BOX_LABELS = ["West", "South", "East", "North"];

/** One row of controls that scope everything below it. */
export function Filters({ meta, value, onChange, onDownload, downloading, problem, hasData = true }: Props) {
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
  const drawn = value.area !== null;
  // A drawn area and a picked country both fix the area of interest: the box fields then only show its bounds.
  const fixed = drawn || value.country !== null;
  return (
    <form className="filters" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span>Period, from</span>
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
        <span>to</span>
        <input
          type="month"
          value={value.end}
          min={value.start}
          max={meta.last_month ?? undefined}
          pattern="\d{4}-\d{2}"
          onChange={(event) => event.target.value && onChange({ ...value, end: event.target.value })}
        />
      </label>
      <label>
        <span>Region</span>
        <select value={value.region} onChange={(event) => pickRegion(event.target.value)}>
          {meta.regions.map((region) => (
            <option key={region.name}>{region.name}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>
          {drawn
            ? `Area of interest: drawn on the globe, ${value.area?.length} corners. Its bounds, degrees`
            : value.country
              ? `Area of interest: ${value.country}, inside its border. Its bounds, degrees`
              : "Area of interest, degrees"}
        </legend>
        {BOX_LABELS.map((label, index) => (
          <label key={label} className="coordinate">
            <span>{label}</span>
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
            {drawn ? "Remove the drawn area" : `Back to the box of ${value.region}`}
          </button>
        )}
      </fieldset>
      <fieldset>
        <legend>Record</legend>
        <div className="segmented">
          {(["harmonized", "raw"] as SeriesName[]).map((name) => {
            const available = meta.series.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={value.series === name}
                disabled={!available}
                title={available ? undefined : "The pipeline has not produced this record yet"}
                onClick={() => onChange({ ...value, series: name })}
              >
                {name === "raw" ? "Raw" : "Harmonized"}
              </button>
            );
          })}
        </div>
      </fieldset>
      <button type="button" className="primary" onClick={onDownload} disabled={downloading || problem !== null || !hasData}>
        {downloading ? "Preparing CSV..." : "Download hotspots (CSV)"}
      </button>
      {problem && (
        <p className="filter-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
