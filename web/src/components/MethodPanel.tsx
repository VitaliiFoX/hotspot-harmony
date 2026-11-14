import { useMemo, useState } from 'react';
import { buildDetectionOption } from '../charts/chartOptions';
import { formatCount, formatPercent, formatRatio } from '../lib/format';
import { parseCountryReport, type SeamSide, type ValidationMetrics } from '../lib/report';
import { EChart } from './EChart';

/** Shown exactly as given, also when the API is unreachable. */
export const ATTRIBUTION = 'NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)';

interface MethodPanelProps {
  report: unknown;
  country: string | null;
  unit: string;
}

const METRIC_COLUMNS: { key: keyof ValidationMetrics; label: string; signed?: boolean }[] = [
  { key: 'wapeCountryYear', label: 'Country, per year' },
  { key: 'wapeCountryMonth', label: 'Country, per month' },
  { key: 'wapeTileYear', label: 'Grid cell, per year' },
  { key: 'wapeTileMonth', label: 'Grid cell, per month' },
  { key: 'bias', label: 'Overall bias', signed: true },
];

function seamSentence(name: string, side: SeamSide | null): string | null {
  if (!side || side.jumpRatio === null) return null;
  const amounts =
    side.before !== null && side.after !== null
      ? ` (${formatCount(side.before)} before, ${formatCount(side.after)} after)`
      : '';
  return `${name}: ${formatRatio(side.jumpRatio)}${amounts}`;
}

/** "About the method": validation numbers, the seam, the detection curve and caveats. */
export function MethodPanel({ report, country, unit }: MethodPanelProps) {
  // Charts cannot measure themselves inside a closed <details>, so draw them only when open.
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseCountryReport(report, country), [report, country]);
  const detection = useMemo(
    () => (parsed.detectionCurve.length > 0 ? buildDetectionOption(parsed.detectionCurve) : null),
    [parsed],
  );
  const own = parsed.validation.find((v) => !v.baseline);
  const rawSeam = seamSentence('Raw record', parsed.seam?.raw ?? null);
  const harmonizedSeam = seamSentence('Harmonized record', parsed.seam?.harmonized ?? null);

  return (
    <details className="card method" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <h2>About the method</h2>
        <span className="method__hint">
          How the two sensors are made comparable, and how well it works
        </span>
      </summary>

      <div className="method__body">
        <p>
          MODIS (about 1 km pixels, since 2000) and VIIRS (375 m pixels, since 2012) see the same
          fires differently: VIIRS reports several times more hotspots. Hotspot Harmony converts
          every period into one unit, <strong>{unit}</strong> as MODIS would have counted them: one
          grid cell of about 1 km with fire on one day. VIIRS detections are weighted by the chance
          that MODIS would also have seen that fire, and the early Terra-only years are scaled up to
          the two-satellite level.
        </p>

        <h3>Checked on years the model did not see{country ? `: ${country}` : ''}</h3>
        {parsed.note ? <p className="callout">{parsed.note}</p> : null}
        {parsed.calibration && parsed.calibration !== 'own' ? (
          <p className="note">
            Calibration for this country: {parsed.calibration} (borrowed from other data, not fitted
            here).
          </p>
        ) : null}

        {parsed.validation.length > 0 ? (
          <>
            <div className="table-scroll" role="region" aria-label="Validation errors" tabIndex={0}>
              <table className="metrics-table">
                <caption>
                  Error of the converted VIIRS record against real MODIS counts (WAPE; lower is
                  better). 0% would be a perfect match.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    {METRIC_COLUMNS.map((c) => (
                      <th key={c.key} scope="col">
                        {c.label}
                      </th>
                    ))}
                    <th scope="col">Months tested</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.validation.map((row) => (
                    <tr key={row.key} className={row.baseline ? 'is-baseline' : undefined}>
                      <th scope="row">{row.label}</th>
                      {METRIC_COLUMNS.map((c) => (
                        <td key={c.key}>
                          {formatPercent(row.metrics[c.key], { signed: c.signed ?? false })}
                        </td>
                      ))}
                      <td>{formatCount(row.metrics.nMonths)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {own && own.metrics.wapeCountryMonth !== null ? (
              <p className="note">
                Read it like this: for a whole country and a single month, the harmonized value is
                off by about {formatPercent(own.metrics.wapeCountryMonth)} on average. Small areas
                and single months are less certain than large areas and whole years.
              </p>
            ) : null}
            {parsed.metric ? <p className="note">Metric: {parsed.metric}.</p> : null}
          </>
        ) : (
          <p className="note">
            No validation numbers are available{country ? ` for ${country}` : ''}.
          </p>
        )}

        {rawSeam || harmonizedSeam ? (
          <>
            <h3>The jump where the sensors change</h3>
            <p>
              Level after the switch to VIIRS divided by the level before it. A value of 1.0x means
              no artificial jump.
            </p>
            <ul className="plain-list">
              {rawSeam ? <li>{rawSeam}</li> : null}
              {harmonizedSeam ? <li>{harmonizedSeam}</li> : null}
            </ul>
          </>
        ) : null}

        {detection ? (
          <>
            <h3>The stronger the fire, the more likely MODIS also sees it</h3>
            <p className="note">
              Share of VIIRS fire cell-days that MODIS also reported the same day, by fire radiative
              power. This curve is what turns VIIRS counts into MODIS-equivalent counts.
            </p>
            {open ? (
              <EChart
                option={detection}
                height={260}
                label="Line chart: the share of VIIRS detections also seen by MODIS rises with fire radiative power, for daytime and night detections."
              />
            ) : null}
          </>
        ) : null}

        {parsed.sensorGapMonths.length > 0 ? (
          <p className="note">
            Months with known sensor outages (values there are less certain):{' '}
            {parsed.sensorGapMonths.join(', ')}.
          </p>
        ) : null}

        <h3>What a hotspot is, and is not</h3>
        <p>
          A hotspot is a thermal anomaly seen from orbit. It is not a confirmed fire and it says
          nothing about burned area: a detection can come from another heat source, and clouds or
          smoke can hide real fires. Use the numbers to compare places and periods, not as a count
          of fires.
        </p>
        <p className="attribution">Data: {ATTRIBUTION}</p>
      </div>
    </details>
  );
}
