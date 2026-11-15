import type { Anomaly, Climatology } from "../api";
import { MONTHS_LONG, formatValue } from "../scale";
import { percent, verdictKind } from "../trust";

type Props = {
  anomaly: Anomaly;
  climatology: Climatology[];
  unit: string;
  /** The month is the busiest of the last twelve of the period, not simply the last one. */
  busiest?: boolean;
  /**
   * The error of the method that applies to this month at the scale of the area (`monthError`), or null when none
   * does. `modis` says why there is none: the month is MODIS as reported.
   */
  error?: { share: number | null; modis: boolean } | null;
  /** The same month in the raw record against the raw record's own median: what the page would say unharmonized. */
  raw?: { ratio: number } | null;
  /** Last month of the record, "YYYY-MM": the page says plainly that nothing after it can be shown. */
  recordEnd?: string | null;
};

/** The headline: how one month (the busiest of the last twelve, or the last) compares with the same month in every year on record. */
export function AnomalyTiles({ anomaly, climatology, unit, busiest = false, error = null, raw = null, recordEnd = null }: Props) {
  const month = MONTHS_LONG[anomaly.month - 1];
  const years = climatology.find((c) => c.month === anomaly.month)?.years ?? 0;
  const kind = verdictKind(anomaly.ratio, error?.share ?? null);
  const verdict =
    kind === "none"
      ? anomaly.value > 0
        ? `Burning in a month that is usually quiet`
        : `No burning, as usual for ${month}`
      : kind === "within"
        ? `${month} ${anomaly.year} is within the method's error of a typical ${month}`
        : kind === "same"
          ? `${month} ${anomaly.year} burned as much as a typical ${month}`
          : kind === "above"
            ? `${month} ${anomaly.year} burned more than a typical ${month}`
            : `${month} ${anomaly.year} burned less than a typical ${month}`;
  const heroNote =
    anomaly.ratio === null
      ? `the ${month} median is zero, so there is no ratio`
      : error?.share != null
        ? kind === "within"
          ? `the ${month} median; the harmonized record can be off by about ${percent(error.share)} in a month like this, so this is not unusual`
          : `the ${month} median; further from it than the method's error of about ${percent(error.share)}`
        : error?.modis
          ? `the ${month} median; MODIS as reported, so no harmonization error`
          : `the ${month} median`;
  const recordEndYear = recordEnd ? Number(recordEnd.slice(0, 4)) : null;
  return (
    <section className="headline" aria-label={`${month} ${anomaly.year} against its history`}>
      <div className="tiles">
        <div className={kind === "within" ? "tile tile-hero is-within" : "tile tile-hero"}>
          <span className="tile-label">{verdict}</span>
          <span className="hero">{anomaly.ratio === null ? "n/a" : `${anomaly.ratio.toFixed(2)}×`}</span>
          <span className="tile-note">{heroNote}</span>
        </div>
        <div className="tile">
          <span className="tile-label">
            {month} {anomaly.year}
          </span>
          <span className="tile-value">{formatValue(anomaly.value)}</span>
          <span className="tile-note">{busiest ? `${unit}; the busiest of the last 12 months` : unit}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{month} median</span>
          <span className="tile-value">{formatValue(anomaly.median)}</span>
          <span className="tile-note">{`${unit}, over ${years} years`}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Rank among years</span>
          <span className="tile-value">{anomaly.percentile}%</span>
          <span className="tile-note">{`of ${month}s on record burned less`}</span>
        </div>
      </div>
      {(raw || recordEndYear) && (
        <div className="headline-notes">
          {raw && anomaly.ratio !== null && (
            <p>
              <strong>{`Without harmonization: ${raw.ratio.toFixed(2)}×.`}</strong>
              {` The raw record would put ${month} ${anomaly.year} at ${raw.ratio.toFixed(2)}× a typical ${month} instead of ${anomaly.ratio.toFixed(2)}×, because it sets VIIRS, which sees many more small fires, against a median that is partly MODIS.`}
            </p>
          )}
          {recordEndYear && (
            <p>
              {`The record ends with ${recordEndYear}, the last year in the FIRMS country archive, so the latest month here is not the current one.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
