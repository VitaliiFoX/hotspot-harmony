import { formatDecimal, monthTitle, t } from "../i18n";
import type { Unusual } from "../insights";
import { UNUSUAL_Z } from "../insights";
import { formatValue } from "../scale";

type Props = {
  unusual: Unusual[];
  /** How many months stand out in all; the card lists the largest of them. */
  total: number;
  unit: string;
  /** The record on screen: on the raw one, months after the 2012 switch stand out for the sensor, not the fire. */
  raw: boolean;
  /** Show the month's year on the calendar. */
  onShow: (year: number) => void;
};

/** The months of the area that stand out from the same month of the other years, beyond the method's error. */
export function UnusualMonths({ unusual, total, unit, raw, onShow }: Props) {
  return (
    <section className="card unusual" id="unusual-months" aria-labelledby="unusual-title">
      <div className="card-head">
        <div>
          <h2 id="unusual-title">{t("Unusual months")}</h2>
          <p className="subtitle">
            {t(
              "Months that stand out from the same month of the other years of the period: a robust z of {z} or more (median and median absolute deviation), and further from the median than the method's error. Largest departure first.",
              { z: UNUSUAL_Z },
            )}
            {raw && ` ${t("On the raw record many months after 2012 stand out because VIIRS replaced MODIS, not because more burned.")}`}
            {total > unusual.length && ` ${t("The {shown} largest of {n}.", { shown: unusual.length, n: total })}`}
          </p>
        </div>
      </div>
      {unusual.length === 0 ? (
        <p className="subtitle">
          {raw
            ? t("No month of this area stands out from its own history.")
            : t("No month of this area stands out from its own history by more than the method's error.")}
        </p>
      ) : (
        <ul className="unusual-list">
          {unusual.map((m) => (
            <li key={`${m.year}-${m.month}`} className={m.direction === "above" ? "is-above" : "is-below"}>
              <button type="button" className="ghost" onClick={() => onShow(m.year)} title={t("Show this year on the calendar")}>
                <strong>{`${monthTitle(m.month)} ${m.year}`}</strong>
                <span>
                  {m.ratio === null
                    ? t("{value} {unit} in a month that usually has none", { value: formatValue(m.value), unit })
                    : t("{ratio}× its median: {value} against {median} {unit}", {
                        ratio: formatDecimal(m.ratio, 2), value: formatValue(m.value), median: formatValue(m.median), unit,
                      })}
                </span>
                <span className="unusual-z">
                  {m.direction === "above"
                    ? t("more than usual, z {z}", { z: formatDecimal(m.z, 1) })
                    : t("less than usual, z {z}", { z: formatDecimal(m.z, 1) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
