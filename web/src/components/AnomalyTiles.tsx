import { monthName, monthTitle, t, tn } from "../i18n";
import type { Anomaly, Climatology } from "../api";
import { formatValue } from "../scale";
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
  const month = monthName(anomaly.month);
  const values = { month, year: anomaly.year, error: error?.share != null ? percent(error.share) : "" };
  const years = climatology.find((c) => c.month === anomaly.month)?.years ?? 0;
  const kind = verdictKind(anomaly.ratio, error?.share ?? null);
  const verdict =
    kind === "none"
      ? anomaly.value > 0
        ? t("Burning in a month that is usually quiet")
        : t("No burning, as usual for {month}", values)
      : kind === "within"
        ? t("{month} {year} is within the method's error of a typical {month}", values)
        : kind === "same"
          ? t("{month} {year} burned as much as a typical {month}", values)
          : kind === "above"
            ? t("{month} {year} burned more than a typical {month}", values)
            : t("{month} {year} burned less than a typical {month}", values);
  const heroNote =
    anomaly.ratio === null
      ? t("the {month} median is zero, so there is no ratio", values)
      : error?.share != null
        ? kind === "within"
          ? t("the {month} median; the harmonized record can be off by about {error} in a month like this, so this is not unusual", values)
          : t("the {month} median; further from it than the method's error of about {error}", values)
        : error?.modis
          ? t("the {month} median; MODIS as reported, so no harmonization error", values)
          : t("the {month} median", values);
  const recordEndYear = recordEnd ? Number(recordEnd.slice(0, 4)) : null;
  return (
    <section className="headline" aria-label={t("{month} {year} against its history", values)}>
      <div className="tiles">
        <div className={kind === "within" ? "tile tile-hero is-within" : "tile tile-hero"}>
          <span className="tile-label">{verdict}</span>
          <span className="hero">{anomaly.ratio === null ? t("n/a") : `${anomaly.ratio.toFixed(2)}×`}</span>
          <span className="tile-note">{heroNote}</span>
        </div>
        <div className="tile">
          <span className="tile-label">
            {monthTitle(anomaly.month)} {anomaly.year}
          </span>
          <span className="tile-value">{formatValue(anomaly.value)}</span>
          <span className="tile-note">{busiest ? t("{unit}; the busiest of the last 12 months", { unit }) : unit}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t("{month} median", values)}</span>
          <span className="tile-value">{formatValue(anomaly.median)}</span>
          <span className="tile-note">{tn(years, "{unit}, over {n} year", "{unit}, over {n} years", { unit })}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t("Rank among years")}</span>
          <span className="tile-value">{anomaly.percentile}%</span>
          <span className="tile-note">{t("of the {month}s on record burned less", values)}</span>
        </div>
      </div>
      <div className="headline-notes">
          {raw && anomaly.ratio !== null && (
            <p>
              <strong>{t("Without harmonization: {raw}×.", { raw: raw.ratio.toFixed(2) })}</strong>{" "}
              {t(
                "The raw record would put {month} {year} at {raw}× a typical {month} instead of {ratio}×, because it sets VIIRS, which sees many more small fires, against a median that is partly MODIS.",
                { ...values, raw: raw.ratio.toFixed(2), ratio: anomaly.ratio.toFixed(2) },
              )}
            </p>
          )}
          {recordEndYear && (
            <p>
              {t(
                "The record ends with {year}, the last year in the FIRMS country archive, so the latest month here is not the current one.",
                { year: recordEndYear },
              )}
            </p>
          )}
          <p>
            {t(
              "A hotspot is a fire the satellite detected: clouds, smoke and the time of the overpass hide some fires, so no hotspot does not prove there was no fire.",
            )}
          </p>
      </div>
    </section>
  );
}
