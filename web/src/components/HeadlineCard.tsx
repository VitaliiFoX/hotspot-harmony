import { formatDecimal, monthName, monthTitle, ordinal, t, tn } from "../i18n";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import type { Anomaly, Climatology, MonthValue, SeriesName } from "../api";
import { useElementWidth } from "../hooks";
import { formatTick, formatValue, monthRank, niceTicks, stripLanes } from "../scale";
import { percent, verdictKind } from "../trust";
import { type Tip, Tooltip } from "./Tooltip";

type Props = {
  anomaly: Anomaly;
  climatology: Climatology[];
  /** Every month of the period: the strip plot and the rank read the headline's calendar month from it. */
  months: MonthValue[];
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
  /** The record on screen and the records the pipeline has produced; the switch drives the filters' "Record". */
  series: SeriesName;
  available: readonly SeriesName[];
  onSeries: (series: SeriesName) => void;
};

/**
 * The headline: how one month (the busiest of the last twelve, or the last) compares with the same month in every
 * year, as a verdict, a ratio, a place among the years and a strip of those years, with what the raw record would say.
 */
export function HeadlineCard({
  anomaly, climatology, months, unit, busiest = false, error = null, raw = null, recordEnd = null, series, available, onSeries,
}: Props) {
  const month = monthName(anomaly.month);
  const values = { month, year: anomaly.year, error: error?.share != null ? percent(error.share) : "" };
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
      ? anomaly.value > 0
        ? t("in a month whose median is zero, so there is no ratio to give", values)
        : t("no burning, and the {month} median is zero too: as usual", values)
      : error?.share != null
        ? kind === "within"
          ? t("the {month} median; the harmonized record can be off by about {error} in a month like this, so this is not unusual", values)
          : t("the {month} median; further from it than the method's error of about {error}", values)
        : error?.modis
          ? t("the {month} median; MODIS as reported, so no harmonization error", values)
          : t("the {month} median", values);
  const rank = monthRank(months, anomaly.year, anomaly.month);
  const rankText =
    rank && rank.of > 1 && anomaly.value > 0
      ? rank.rank === 1
        ? t("The busiest of {n} {month}s", { month, n: rank.of })
        : t("{rank} busiest of {n} {month}s", { month, n: rank.of, rank: ordinal(rank.rank) })
      : null;
  const recordEndYear = recordEnd ? Number(recordEnd.slice(0, 4)) : null;
  return (
    <section className="headline" aria-label={t("{month} {year} against its history", values)}>
      <div className="card headline-card">
        <div className="headline-top">
          <h2 className="headline-verdict">{verdict}</h2>
          {available.length > 1 && (
            <div className="segmented" role="group" aria-label={t("Record")}>
              {(["harmonized", "raw"] as SeriesName[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={series === name}
                  disabled={!available.includes(name)}
                  onClick={() => onSeries(name)}
                >
                  {name === "raw" ? t("Raw") : t("Harmonized")}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="headline-figures">
          <div className={kind === "within" ? "headline-ratio is-within" : "headline-ratio"}>
            <span className="hero">{anomaly.ratio === null ? (anomaly.value > 0 ? t("Unusual") : "0") : `${formatDecimal(anomaly.ratio, 2)}×`}</span>
            <span className="headline-note">{heroNote}</span>
          </div>
          {raw && anomaly.ratio !== null && (
            <div className="headline-raw">
              <span className="headline-raw-label">{t("Without harmonization")}</span>
              <span className="headline-raw-value">{formatDecimal(raw.ratio, 2)}×</span>
              <span className="headline-note">
                {t("The raw record sets VIIRS, which sees many more small fires, against a median that is partly MODIS.")}
              </span>
            </div>
          )}
        </div>
        <div className="headline-rank">
          {rankText && <strong>{rankText}</strong>}
          <span className="headline-note">
            {busiest
              ? t("{month} {year} is the busiest of the last 12 months of the period", values)
              : t("{month} {year} is the last month of the period", values)}
          </span>
        </div>
        <MonthStrip anomaly={anomaly} climatology={climatology} months={months} unit={unit} />
      </div>
      <p className="headline-caveats">
        {recordEndYear !== null &&
          `${t(
            "The record ends with {year}, the last year in the FIRMS country archive, so the latest month here is not the current one.",
            { year: recordEndYear },
          )} `}
        {t(
          "A hotspot is a fire the satellite detected: clouds, smoke and the time of the overpass hide some fires, so no hotspot does not prove there was no fire.",
        )}
      </p>
    </section>
  );
}

type StripProps = { anomaly: Anomaly; climatology: Climatology[]; months: MonthValue[]; unit: string };

const SIDE = 12; // room for a dot at either end of the axis
const DOT = 5;
const LANE = 9; // vertical step between dots that would cover each other
const LABEL = 22; // band over the dots for the headline year's label
const CHAR = 6.8; // rough width of a character of a 12-13 px label, to keep labels inside the strip

/** One dot per year for the headline's calendar month on a linear axis from zero, with the median and the year marked. */
function MonthStrip({ anomaly, climatology, months, unit }: StripProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [showTable, setShowTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  const month = monthName(anomaly.month);
  const years = months.filter((m) => m.month === anomaly.month).sort((a, b) => a.year - b.year);
  if (years.length === 0) return null;
  const onRecord = climatology.find((c) => c.month === anomaly.month)?.years ?? years.length;
  const first = years[0].year;
  const last = years[years.length - 1].year;
  const caption =
    onRecord > years.length
      ? tn(onRecord, "Each dot is one {month}, {first} to {last}; the median is over all {n} year on record", "Each dot is one {month}, {first} to {last}; the median is over all {n} years on record", { month, first, last })
      : t("Each dot is one {month}, {first} to {last}", { month, first, last });

  const ticks = niceTicks(Math.max(1, anomaly.median, ...years.map((m) => m.value)), width < 480 ? 3 : 4);
  const top = ticks[ticks.length - 1];
  const x = (value: number) => SIDE + (Math.max(0, width - 2 * SIDE) * value) / top;
  const lanes = stripLanes(years.map((m) => x(m.value)), 2 * DOT);
  const up = Math.max(0, ...lanes);
  const down = Math.max(0, ...lanes.map((lane) => -lane));
  const centre = LABEL + DOT + 4 + up * LANE;
  const axisY = centre + down * LANE + DOT + 8;
  const height = axisY + 22;
  const y = (i: number) => centre - lanes[i] * LANE;
  const own = years.findIndex((m) => m.year === anomaly.year);
  const order = years.map((_, i) => i).sort((a, b) => years[a].value - years[b].value || years[a].year - years[b].year);

  /** A label of `text` centred on `at` but kept inside the strip. */
  function labelX(text: string, at: number): number {
    const w = text.length * CHAR;
    return Math.max(0, Math.min(at - w / 2, width - w));
  }
  const ownText = own >= 0 ? t("{month} {year}: {value} {unit}", { month: monthTitle(anomaly.month), year: anomaly.year, value: formatValue(years[own].value), unit }) : "";
  // Over the dot the unit is left out where the strip is narrower than the whole text: the caption above names it.
  const ownLabel =
    own >= 0 && ownText.length * CHAR > width ? `${monthTitle(anomaly.month)} ${anomaly.year}: ${formatValue(years[own].value)}` : ownText;
  const medianText = t("median {value}", { value: formatValue(anomaly.median) });
  const medianX = x(anomaly.median);

  function tipFor(i: number): Tip {
    return { ...pointer, title: `${monthTitle(anomaly.month)} ${years[i].year}`, rows: [{ value: formatValue(years[i].value), label: unit }] };
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best = 0;
    years.forEach((m, i) => {
      if (Math.hypot(x(m.value) - px, y(i) - py) < Math.hypot(x(years[best].value) - px, y(best) - py)) best = i;
    });
    setActive(best);
    setPointer({ x: event.clientX, y: event.clientY });
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const at = order.indexOf(active ?? (own >= 0 ? own : order[0]));
    const next = active === null ? order[at] : order[Math.max(0, Math.min(order.length - 1, at + (event.key === "ArrowRight" ? 1 : -1)))];
    const box = event.currentTarget.getBoundingClientRect();
    setActive(next);
    setPointer({ x: box.left + x(years[next].value), y: box.top + y(next) });
  }

  return (
    <div className="strip" ref={ref}>
      <div className="strip-head">
        <span className="headline-note">{caption}</span>
        <button type="button" className="ghost" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
          {showTable ? t("Show chart") : t("Show table")}
        </button>
      </div>
      {showTable ? (
        <div className="table-wrap">
          <table>
            <caption>{t("{month} in every year, in {unit}", { month: monthTitle(anomaly.month), unit })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Year")}</th>
                <th scope="col">{unit}</th>
                <th scope="col">{t("Place")}</th>
              </tr>
            </thead>
            <tbody>
              {years.map((m) => (
                <tr key={m.year} className={m.year === anomaly.year ? "is-own" : undefined}>
                  <th scope="row">{m.year}</th>
                  <td>{formatValue(m.value)}</td>
                  <td>{ordinal(monthRank(years, m.year, m.month)!.rank)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {width > 0 && (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={t(
                "{month} in every year, in {unit}: {own}; {median}. Use the left and right arrow keys to read the years.",
                { month: monthTitle(anomaly.month), unit, own: ownText, median: medianText },
              )}
              tabIndex={0}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setActive(null)}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
            >
              <line className="axis" x1={SIDE} x2={width - SIDE} y1={axisY} y2={axisY} />
              {ticks.map((tick) =>
                Math.abs(x(tick) - medianX) < (medianText.length * CHAR) / 2 + 28 ? null : (
                  <text key={tick} className="tick" x={x(tick)} y={axisY + 16} textAnchor={tick === 0 ? "start" : tick === top ? "end" : "middle"}>
                    {formatTick(tick, top)}
                  </text>
                ),
              )}
              <line className="strip-median" x1={medianX} x2={medianX} y1={LABEL} y2={axisY + 4} />
              <text className="strip-median-label" x={labelX(medianText, medianX)} y={axisY + 16}>
                {medianText}
              </text>
              {years.map((m, i) =>
                i === own ? null : <circle key={m.year} className="strip-dot" cx={x(m.value)} cy={y(i)} r={DOT} />,
              )}
              {own >= 0 && (
                <>
                  <circle className="strip-dot is-own" cx={x(years[own].value)} cy={y(own)} r={DOT + 1.5} />
                  <text className="strip-label" x={labelX(ownLabel, x(years[own].value))} y={14}>
                    {ownLabel}
                  </text>
                </>
              )}
              {active !== null && <circle className="strip-ring" cx={x(years[active].value)} cy={y(active)} r={DOT + 4} />}
            </svg>
          )}
          <Tooltip tip={active === null ? null : tipFor(active)} />
        </div>
      )}
    </div>
  );
}
