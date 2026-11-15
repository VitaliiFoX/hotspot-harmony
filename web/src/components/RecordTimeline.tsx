import type { Meta, SeriesName } from "../api";
import { t } from "../i18n";
import { monthLabel, monthRange, rawRecordParts, recordTimeline } from "../scale";

/** The part of the harmonized record the others are adjusted to: MODIS Terra + Aqua as reported. */
const REFERENCE_SENSOR = "modis";

type Props = {
  meta: Meta;
  series: SeriesName;
  /** The unit of the series on screen, as the API names it, already in the page's language. */
  unit: string;
  /** Whether the "How far to trust this" block is on the page, so the sentence can link to it. */
  trusted: boolean;
};

/**
 * What the record on screen is: one sentence, then its parts as a timeline, each segment as long as its months.
 * The strip is drawn for the eye and hidden from screen readers; the numbered list under it says the same in order.
 */
export function RecordTimeline({ meta, series, unit, trusted }: Props) {
  const first = meta.first_month;
  const last = meta.last_month;
  const harmonized = series === "harmonized";
  const source = harmonized
    ? meta.harmonized_record
    : first && last
      ? rawRecordParts(first, meta.raw_sensor_switch, last)
      : null;
  if (harmonized && !source) return null;
  const parts = source && last ? recordTimeline(source, last) : [];

  const sentence = harmonized
    ? t(
        "Values are {unit} (1 km cells with fire on a day), matched to the MODIS Terra + Aqua reference, so {first} and {last} compare.",
        { unit, first: parts[0]?.from.slice(0, 4) ?? "", last: last?.slice(0, 4) ?? "" },
      )
    : t("Raw {unit}, uncorrected: VIIRS sees small fires MODIS misses, so values jump at {month} and cannot be compared across it.", {
        unit,
        month: monthLabel(meta.raw_sensor_switch),
      });

  function role(sensor: string, index: number): "reference" | "adjusted" | "jump" | "plain" {
    if (harmonized) return sensor === REFERENCE_SENSOR ? "reference" : "adjusted";
    return index > 0 ? "jump" : "plain";
  }

  function note(sensor: string, index: number): string | null {
    const kind = role(sensor, index);
    if (kind === "reference") return t("as reported");
    if (kind === "adjusted") return t("adjusted to the reference");
    if (kind === "jump") return t("values jump at its start");
    return null;
  }

  return (
    <section className="notice record" aria-label={harmonized ? t("Harmonized record") : t("Raw record")}>
      <p className="record-sentence">
        {sentence}
        {trusted && (
          <>
            {" "}
            <a href="#trust">{t("How far to trust it")}</a>
          </>
        )}
      </p>
      {parts.length > 1 && (
        <>
          <div className="record-strip" aria-hidden="true">
            {parts.map((part, index) => (
              <span
                key={part.sensor}
                className={`record-segment is-${role(part.sensor, index)}`}
                style={{ flexGrow: part.months }}
              >
                <span className="record-number">{index + 1}</span>
              </span>
            ))}
          </div>
          <ol className="record-parts">
            {parts.map((part, index) => {
              const extra = note(part.sensor, index);
              return (
                <li key={part.sensor} className={`is-${role(part.sensor, index)}`}>
                  <span className={`record-swatch is-${role(part.sensor, index)}`} aria-hidden="true">
                    <span className="record-number">{index + 1}</span>
                  </span>
                  <span>
                    <span className="record-part-label">{t(part.label)}</span>
                    {" · "}
                    {monthRange(part.from, part.to)}
                    {extra && <span className="record-part-note">{` · ${extra}`}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
