import type { Anomaly } from '../api/types';
import { DEVIATION_LIMIT, PUOR_BELOW_TO_ABOVE } from '../lib/colors';
import { formatCount, formatRange, formatRatio } from '../lib/format';
import { isQuietMonth, pluralMonth } from '../lib/headline';
import { deviationValue } from '../lib/monthGrid';
import { monthName } from '../lib/ym';

interface AnomalyBlockProps {
  anomaly: Anomaly | null;
  unit: string;
}

function verdict(anomaly: Anomaly): string {
  if (isQuietMonth(anomaly)) return 'As usual: no hotspots';
  if (anomaly.ratio === null) return 'Above usual (usually none)';
  if (anomaly.ratio >= 1.25) return 'Above usual';
  if (anomaly.ratio <= 0.8) return 'Below usual';
  return 'About usual';
}

/** The latest month against the historical median for the same calendar month. */
export function AnomalyBlock({ anomaly, unit }: AnomalyBlockProps) {
  if (!anomaly) {
    return (
      <p className="note">
        There is no recent month to compare with the past for this area and date range.
      </p>
    );
  }
  const month = monthName(anomaly.month);
  const hasRange = anomaly.lo !== anomaly.hi;
  const p = Math.round(anomaly.percentile);
  const position =
    (deviationValue(anomaly.value, anomaly.median) + DEVIATION_LIMIT) / (2 * DEVIATION_LIMIT);
  const gradient = `linear-gradient(to right, ${PUOR_BELOW_TO_ABOVE.join(', ')})`;
  const compared =
    typeof anomaly.years_compared === 'number' ? ` (${anomaly.years_compared} earlier years)` : '';

  return (
    <div className="anomaly">
      <div className="anomaly__main">
        <p className="anomaly__when">
          {month} {anomaly.year}
        </p>
        <p className="anomaly__value">
          <strong>{formatCount(anomaly.value)}</strong> <span>{unit}</span>
        </p>
        <p className="anomaly__verdict">{verdict(anomaly)}</p>
      </div>

      <dl className="anomaly__facts">
        <div>
          <dt>Usual {month} (median)</dt>
          <dd>{formatCount(anomaly.median)}</dd>
        </div>
        <div>
          <dt>Ratio to usual</dt>
          <dd>
            {anomaly.ratio === null ? 'not defined (usual level is 0)' : formatRatio(anomaly.ratio)}
          </dd>
        </div>
        <div>
          <dt>Rank</dt>
          <dd>
            {anomaly.value === 0 && anomaly.median === 0
              ? `same as most ${pluralMonth(anomaly.month)}: none`
              : Number.isFinite(p)
                ? `higher than ${p}% of ${pluralMonth(anomaly.month)}`
                : '\u2013'}
            {compared}
          </dd>
        </div>
        <div>
          <dt>90% range</dt>
          <dd>
            {hasRange ? formatRange(anomaly.lo, anomaly.hi) : 'no spread reported for this month'}
          </dd>
        </div>
      </dl>

      <div className="deviation" aria-hidden="true">
        <div className="deviation__bar" style={{ background: gradient }}>
          <span className="deviation__marker" style={{ left: `${position * 100}%` }} />
        </div>
        <div className="deviation__ticks">
          <span>1/8 of usual</span>
          <span>usual</span>
          <span>8x usual</span>
        </div>
      </div>
    </div>
  );
}
