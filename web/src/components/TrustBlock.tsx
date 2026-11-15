import type { Validation } from "../api";
import {
  CHECKS, CHECK_LABELS, SCALES, SCALE_LABELS, expectedError, percent, reportTime, scalesWhereFactorWins, signedPercent,
  validateCommand,
} from "../trust";

const REPOSITORY = "https://github.com/VitaliiFoX/hotspot-harmony/blob/main";

type Props = {
  validation: Validation;
  /** The region of the filters: the check was run per country. */
  region: string;
  /** Whether the area of interest is the region's whole box; anything smaller reads the 1-degree tile figure. */
  wholeRegion: boolean;
};

/**
 * How far to trust the harmonized record of this region: its error on years the method did not see, next to the
 * two baselines it has to beat. Every number comes from the report `make validate` wrote, through /api/validation.
 */
export function TrustBlock({ validation, region, wholeRegion }: Props) {
  const country = validation.countries[region];
  if (!country) return null;
  const { checks } = country;
  const expected = expectedError(country, wholeRegion);
  const factorWins = scalesWhereFactorWins(country);
  const years = validation.fit_period?.map((day) => day.slice(0, 4)).join("–") ?? "the overlap years";
  return (
    <section className="card trust" id="trust" aria-labelledby="trust-title">
      <div className="card-head">
        <div>
          <h2 id="trust-title">How far to trust this</h2>
          <p className="subtitle">
            {`Each year of ${years} was hidden in turn. The method was fitted on the other years, and its harmonized VIIRS for the hidden year was compared with what MODIS reported. The error is the sum of the misses over the sum of what MODIS reported.`}
          </p>
        </div>
      </div>

      <div className="trust-figures">
        <div className="tile tile-hero">
          <span className="tile-label">
            {wholeRegion ? `${region}, month by month` : `An area smaller than ${region}, month by month`}
          </span>
          <span className="hero">{percent(expected.share)}</span>
          <span className="tile-note">
            {wholeRegion
              ? "error on years the method did not see"
              : "error of a 1° tile on years the method did not see; a larger area errs less"}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">One scaling factor instead</span>
          <span className="tile-value">{percent(checks.single_factor[expected.scale])}</span>
          <span className="tile-note">the simplest correction, fitted on all years, the hidden one included</span>
        </div>
        <div className="tile">
          <span className="tile-label">No correction at all</span>
          <span className="tile-value">{percent(checks.raw_viirs[expected.scale])}</span>
          <span className="tile-note">VIIRS as delivered, against MODIS</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="trust-table">
          <caption>
            {`${region}: error as a share of what MODIS reported. The method is scored on years it did not see; the scaling factor has seen them all.`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Check</th>
              {SCALES.map((scale) => (
                <th scope="col" key={scale}>
                  {SCALE_LABELS[scale]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHECKS.map((check) => (
              <tr key={check} className={check === "harmonized" ? "trust-ours" : undefined}>
                <th scope="row">{CHECK_LABELS[check]}</th>
                {SCALES.map((scale) => (
                  <td key={scale}>{percent(checks[check][scale])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {factorWins.length > 0 && (
        <p className="trust-note">
          {`Where the method loses: one scaling factor does better for ${factorWins
            .map((scale) => `${SCALE_LABELS[scale].toLowerCase()} (${percent(checks.single_factor[scale])} against ${percent(checks.harmonized[scale])})`)
            .join(" and ")}.`}
        </p>
      )}

      <p className="trust-source">
        {`Method: ${country.method_name}, ${
          country.method_chosen_per_held_out_year
            ? "chosen again for every hidden year from the other years alone"
            : "chosen once on all years, so this check saw each hidden year in that one step and may flatter the method"
        }. Bias ${signedPercent(checks.harmonized.bias)} over ${country.held_out_months} months. From `}
        <code>{validation.source}</code>
        {", written by "}
        <code>{validateCommand(country)}</code>
        {` on ${reportTime(validation.generated_at_utc)}. `}
        <a href={`${REPOSITORY}/docs/VALIDATION.md`}>All checks</a>
        {" · "}
        <a href={`${REPOSITORY}/docs/METHOD.md`}>The method</a>
      </p>
    </section>
  );
}
