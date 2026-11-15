import { formatDecimal, t } from "../i18n";
import type { Validation } from "../api";
import {
  CHECKS, CHECK_LABELS, SCALES, SCALE_LABELS, change, expectedError, percent, reportTime, scalesWhereFactorWins,
  signedPercent, validateCommand,
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
  const years = validation.fit_period?.map((day) => day.slice(0, 4)).join("–") ?? t("the overlap years");
  const name = t(region);
  return (
    <section className="card trust" id="trust" aria-labelledby="trust-title">
      <div className="card-head">
        <div>
          <h2 id="trust-title">{t("How far to trust this")}</h2>
          <p className="subtitle">
            {t(
              "Each year of {years} was hidden in turn. The method was fitted on the other years, and its harmonized VIIRS for the hidden year was compared with what MODIS reported. The error is the sum of the misses over the sum of what MODIS reported.",
              { years },
            )}
          </p>
        </div>
      </div>

      <div className="trust-figures">
        <div className="tile tile-hero">
          <span className="tile-label">
            {wholeRegion
              ? t("{region}, month by month", { region: name })
              : t("An area smaller than {region}, month by month", { region: name })}
          </span>
          <span className="hero">{percent(expected.share)}</span>
          <span className="tile-note">
            {wholeRegion
              ? t("error on years the method did not see")
              : t("error of a 1° tile on years the method did not see; a larger area errs less")}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">{t("One scaling factor instead")}</span>
          <span className="tile-value">{percent(checks.single_factor[expected.scale])}</span>
          <span className="tile-note">{t("the simplest correction, fitted on all years, the hidden one included")}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t("No correction at all")}</span>
          <span className="tile-value">{percent(checks.raw_viirs[expected.scale])}</span>
          <span className="tile-note">{t("VIIRS as delivered, against MODIS")}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="trust-table">
          <caption>
            {t(
              "{region}: error as a share of what MODIS reported. The method is scored on years it did not see; the scaling factor has seen them all.",
              { region: name },
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("Check")}</th>
              {SCALES.map((scale) => (
                <th scope="col" key={scale}>
                  {t(SCALE_LABELS[scale])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHECKS.map((check) => (
              <tr key={check} className={check === "harmonized" ? "trust-ours" : undefined}>
                <th scope="row">{t(CHECK_LABELS[check])}</th>
                {SCALES.map((scale) => (
                  <td key={scale}>{percent(checks[check][scale])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {country.sensor_jump && (
        <div className="trust-jump">
          <h3>{t("What the sensor switch does to {region}", { region: name })}</h3>
          <p className="subtitle">
            {t(
              "Mean yearly burning in {after} against {before}, for the whole country. The raw record switches from MODIS to VIIRS in 2012; the harmonized one does not jump there.",
              { after: country.sensor_jump.after.replace("-", "–"), before: country.sensor_jump.before.replace("-", "–") },
            )}
          </p>
          <dl className="trust-jump-figures">
            <div>
              <dt>{t("Raw record")}</dt>
              <dd>
                <strong>{change(country.sensor_jump.raw)}</strong>
                {` (${formatDecimal(country.sensor_jump.raw, 2)}×)`}
              </dd>
            </div>
            <div>
              <dt>{t("Harmonized record")}</dt>
              <dd>
                <strong>{change(country.sensor_jump.harmonized)}</strong>
                {` (${formatDecimal(country.sensor_jump.harmonized, 2)}×)`}
              </dd>
            </div>
          </dl>
          <p className="trust-note">
            {t(
              "The difference between the two is the sensor, not the fire. Up to 2021 the harmonized record is MODIS as reported, so its change is what MODIS itself saw.",
            )}
          </p>
        </div>
      )}

      {factorWins.length > 0 && (
        <p className="trust-note">
          {t("Where the method loses: one scaling factor does better for {scales}.", {
            scales: factorWins
              .map((scale) =>
                t("{scale} ({factor} against {method})", {
                  scale: t(SCALE_LABELS[scale]).toLowerCase(),
                  factor: percent(checks.single_factor[scale]),
                  method: percent(checks.harmonized[scale]),
                }),
              )
              .join(t(" and ")),
          })}
        </p>
      )}

      <p className="trust-source">
        {t("Method: {method}, {how}. Bias {bias} over {months} months. From ", {
          method: country.method_name,
          how: country.method_chosen_per_held_out_year
            ? t("chosen again for every hidden year from the other years alone")
            : t("chosen once on all years, so this check saw each hidden year in that one step and may flatter the method"),
          bias: signedPercent(checks.harmonized.bias),
          months: country.held_out_months,
        })}
        <code>{validation.source}</code>
        {t(", written by ")}
        <code>{validateCommand(country)}</code>
        {t(" on {time}. ", { time: reportTime(validation.generated_at_utc) })}
        <a href={`${REPOSITORY}/docs/VALIDATION.md`}>{t("All checks")}</a>
        {" · "}
        <a href={`${REPOSITORY}/docs/METHOD.md`}>{t("The method")}</a>
      </p>
    </section>
  );
}
