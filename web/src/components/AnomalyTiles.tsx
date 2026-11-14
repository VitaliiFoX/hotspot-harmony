import type { Anomaly, Climatology } from "../api";
import { MONTHS_LONG, formatValue } from "../scale";

type Props = { anomaly: Anomaly; climatology: Climatology[]; unit: string };

/** The headline: how the last selected month compares with the same month in every year on record. */
export function AnomalyTiles({ anomaly, climatology, unit }: Props) {
  const month = MONTHS_LONG[anomaly.month - 1];
  const years = climatology.find((c) => c.month === anomaly.month)?.years ?? 0;
  const verdict =
    anomaly.ratio === null
      ? anomaly.value > 0
        ? `Burning in a month that is usually quiet`
        : `No burning, as usual for ${month}`
      : anomaly.ratio >= 1
        ? `${month} ${anomaly.year} burned more than a typical ${month}`
        : `${month} ${anomaly.year} burned less than a typical ${month}`;
  return (
    <section className="tiles" aria-label={`${month} ${anomaly.year} against its history`}>
      <div className="tile tile-hero">
        <span className="tile-label">{verdict}</span>
        <span className="hero">{anomaly.ratio === null ? "n/a" : `${anomaly.ratio.toFixed(2)}×`}</span>
        <span className="tile-note">
          {anomaly.ratio === null ? `the ${month} median is zero, so there is no ratio` : `the ${month} median`}
        </span>
      </div>
      <div className="tile">
        <span className="tile-label">
          {month} {anomaly.year}
        </span>
        <span className="tile-value">{formatValue(anomaly.value)}</span>
        <span className="tile-note">{unit}</span>
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
    </section>
  );
}
