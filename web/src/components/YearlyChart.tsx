import { t } from "../i18n";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import type { RecordPart, YearTotal } from "../api";
import { useElementWidth } from "../hooks";
import { HeatGradient, heatPaint, useHeatId } from "./HeatGradient";
import { brokenLinePath, columnPath, formatTick, formatValue, niceTicks, partsOfYear, recordSpans, valuesByYear } from "../scale";
import { type Tip, Tooltip } from "./Tooltip";

type Props = {
  yearly: YearTotal[];
  unit: string;
  /** Year in which the raw record changes sensor; draws a marker before that year's column. */
  sensorSwitch?: { year: number; label: string };
  /**
   * A second record drawn as a thin line with a dot per year over the columns: the raw record over the harmonized
   * one, so the sensor jump shows without switching. `columns` names what the columns are.
   */
  line?: { yearly: YearTotal[]; label: string; unit: string; columns: string };
  /**
   * The parts of the harmonized record (/api/meta `harmonized_record`): drawn as a strip over the columns, so it reads
   * that up to 2021 the columns are MODIS as reported and only from 2022 VIIRS harmonized to it.
   */
  record?: RecordPart[];
};

// Short names for the strip when the full label does not fit its span.
const SHORT: Record<string, string> = { modis_terra: "Terra", modis: "MODIS", viirs_noaa20: "NOAA-20" };
const CHAR_WIDTH = 6.2; // px per character of an 11 px label, near enough to decide whether it fits

const HEIGHT = 260; // includes the axis band
const RIBBON = 24; // extra room on top for the strip of record parts

/** One column per year. Years that are not fully covered are drawn lighter. */
export function YearlyChart({ yearly, unit, sensorSwitch, line, record }: Props) {
  const MARGIN = { left: 48, right: 12, top: record ? 24 + RIBBON : 24, bottom: 26 };
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  const lineValues = line ? valuesByYear(yearly, line.yearly) : [];
  const ticks = niceTicks(Math.max(1, ...yearly.map((y) => y.value), ...lineValues.map((v) => v ?? 0)));
  const yMax = ticks[ticks.length - 1];
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = yearly.length ? innerWidth / yearly.length : 0;
  const thickness = Math.max(1, Math.min(24, slot - 2));
  const baseline = MARGIN.top + innerHeight;
  const y = (value: number) => MARGIN.top + innerHeight * (1 - value / yMax);
  const labelEvery = slot >= 34 ? 1 : slot >= 17 ? 2 : 5;
  const switchIndex = sensorSwitch ? yearly.findIndex((item) => item.year === sensorSwitch.year) : -1;
  const hasPartial = yearly.some((item) => !item.complete);
  // The columns share one gradient, from the baseline to the top of the tallest of them.
  const heat = useHeatId();
  const tallest = Math.max(0, ...yearly.map((item) => item.value));
  const spans =
    record && yearly.length ? recordSpans(record, yearly[0].year, yearly[yearly.length - 1].year) : [];
  const linePoints = lineValues.map((value, index): [number, number] | null =>
    value === null ? null : [MARGIN.left + (index + 0.5) * slot, y(value)],
  );

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - MARGIN.left) / slot);
    setActive(index >= 0 && index < yearly.length ? index : null);
    setPointer({ x: event.clientX, y: event.clientY });
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = Math.max(0, Math.min(yearly.length - 1, (active ?? -1) + (event.key === "ArrowRight" ? 1 : -1)));
    const box = event.currentTarget.getBoundingClientRect();
    setActive(index);
    setPointer({ x: box.left + MARGIN.left + (index + 0.5) * slot, y: box.top + y(yearly[index].value) });
  }

  const tip: Tip | null =
    active === null
      ? null
      : {
          ...pointer,
          title: String(yearly[active].year),
          rows: [
            { value: formatValue(yearly[active].value), label: line ? `${line.columns}, ${unit}` : unit },
            ...(line && lineValues[active] !== null
              ? [{ value: formatValue(lineValues[active]!), label: `${line.label}, ${line.unit}` }]
              : []),
            ...(record ? [{ value: t("From"), label: partsOfYear(record, yearly[active].year).map((part) => t(part)).join(t(" and ")) }] : []),
            ...(yearly[active].complete ? [] : [{ value: t("Partial"), label: t("not all 12 months are covered") }]),
          ],
        };

  return (
    <div ref={ref}>
      {(hasPartial || line) && (
        <ul className="legend">
          <li>
            <span className="box-key heat-key" />
            {line ? (hasPartial ? t("{columns}, full year", { columns: line.columns }) : line.columns) : t("Full year")}
          </li>
          {hasPartial && (
            <li>
              <span className="box-key heat-key is-partial" />
              {t("Partial year")}
            </li>
          )}
          {line && (
            <li>
              <span className="line-key" style={{ background: "var(--ink)" }} />
              {line.label}
            </li>
          )}
        </ul>
      )}
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={
            line
              ? t("{unit} per year, with the {line} as a line. Use the left and right arrow keys to read years.", { unit, line: line.label.toLowerCase() })
              : t("{unit} per year. Use the left and right arrow keys to read years.", { unit })
          }
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <HeatGradient id={heat} from={baseline} to={y(tallest)} />
          {ticks.map((tick) => (
            <g key={tick}>
              <line className={tick === 0 ? "axis" : "gridline"} x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatTick(tick, yMax)}
              </text>
            </g>
          ))}
          {yearly.map((item, index) => {
            const left = MARGIN.left + index * slot + (slot - thickness) / 2;
            return (
              <g key={item.year}>
                <path
                  className={`column${item.complete ? "" : " is-partial"}${index === active ? " is-active" : ""}`}
                  style={{ fill: heatPaint(heat) }}
                  d={columnPath(left, baseline, thickness, baseline - y(item.value))}
                />
                {item.year % labelEvery === 0 && (
                  <text className="tick" x={MARGIN.left + (index + 0.5) * slot} y={HEIGHT - 8} textAnchor="middle">
                    {item.year}
                  </text>
                )}
              </g>
            );
          })}
          {line && (
            <g>
              <path className="overlay-line" d={brokenLinePath(linePoints)} />
              {linePoints.map((point, index) =>
                point ? (
                  <circle
                    key={yearly[index].year}
                    className="overlay-dot"
                    cx={point[0]}
                    cy={point[1]}
                    r={index === active ? 4 : 2.5}
                  />
                ) : null,
              )}
            </g>
          )}
          {spans.map((span, i) => {
            const x1 = MARGIN.left + span.start * slot;
            const x2 = MARGIN.left + span.end * slot;
            const room = x2 - x1 - 8;
            const label = t(span.label);
            const text = label.length * CHAR_WIDTH <= room ? label
              : (SHORT[span.sensor] ?? "").length * CHAR_WIDTH <= room ? SHORT[span.sensor] : "";
            return (
              <g key={span.sensor}>
                <line className="record-span" x1={x1 + 2} x2={x2 - 2} y1={RIBBON} y2={RIBBON} />
                {i > 0 && <line className="record-edge" x1={x1} x2={x1} y1={RIBBON - 5} y2={MARGIN.top + innerHeight} />}
                {text && (
                  <text className="record-label" x={(x1 + x2) / 2} y={RIBBON - 7} textAnchor="middle">
                    {text}
                  </text>
                )}
              </g>
            );
          })}
          {sensorSwitch && switchIndex > 0 && (
            <g>
              <line
                className="marker"
                x1={MARGIN.left + switchIndex * slot}
                x2={MARGIN.left + switchIndex * slot}
                y1={MARGIN.top - 6}
                y2={baseline}
              />
              <text
                className="marker-label"
                x={MARGIN.left + switchIndex * slot + (switchIndex < yearly.length / 2 ? 6 : -6)}
                y={MARGIN.top - 10}
                textAnchor={switchIndex < yearly.length / 2 ? "start" : "end"}
              >
                {sensorSwitch.label}
              </text>
            </g>
          )}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function YearlyTable({ yearly, unit, line, record }: Props) {
  const lineValues = line ? valuesByYear(yearly, line.yearly) : [];
  return (
    <table>
      <caption>
        {line
          ? t("Per year: {columns} in {unit}, {line} in {lineUnit}", {
              columns: line.columns.toLowerCase(), unit, line: line.label.toLowerCase(), lineUnit: line.unit,
            })
          : t("{unit} per year", { unit })}
      </caption>
      <thead>
        <tr>
          <th scope="col">{t("Year")}</th>
          <th scope="col">{line ? line.columns : t("Total")}</th>
          {line && <th scope="col">{line.label}</th>}
          <th scope="col">{t("Coverage")}</th>
          {record && <th scope="col">{t("From")}</th>}
        </tr>
      </thead>
      <tbody>
        {yearly.map((item, index) => (
          <tr key={item.year}>
            <th scope="row">{item.year}</th>
            <td>{formatValue(item.value)}</td>
            {line && <td>{lineValues[index] === null ? "" : formatValue(lineValues[index]!)}</td>}
            <td>{item.complete ? t("Full year") : t("Partial year")}</td>
            {record && <td className="text-cell">{partsOfYear(record, item.year).map((part) => t(part)).join(t(" and "))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
