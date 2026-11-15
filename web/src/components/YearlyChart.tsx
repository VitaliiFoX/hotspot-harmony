import { type KeyboardEvent, type PointerEvent, useState } from "react";
import type { YearTotal } from "../api";
import { useElementWidth } from "../hooks";
import { brokenLinePath, columnPath, formatTick, formatValue, niceTicks, valuesByYear } from "../scale";
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
};

const HEIGHT = 260; // includes the axis band
const MARGIN = { left: 48, right: 12, top: 24, bottom: 26 };

/** One column per year. Years that are not fully covered are drawn lighter. */
export function YearlyChart({ yearly, unit, sensorSwitch, line }: Props) {
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
            ...(yearly[active].complete ? [] : [{ value: "Partial", label: "not all 12 months are covered" }]),
          ],
        };

  return (
    <div ref={ref}>
      {(hasPartial || line) && (
        <ul className="legend">
          <li>
            <span className="box-key" style={{ background: "var(--accent)" }} />
            {line ? (hasPartial ? `${line.columns}, full year` : line.columns) : "Full year"}
          </li>
          {hasPartial && (
            <li>
              <span className="box-key" style={{ background: "var(--accent-soft)" }} />
              Partial year
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
          aria-label={`${unit} per year${line ? `, with the ${line.label.toLowerCase()} as a line` : ""}. Use the left and right arrow keys to read years.`}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
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

export function YearlyTable({ yearly, unit, line }: Props) {
  const lineValues = line ? valuesByYear(yearly, line.yearly) : [];
  return (
    <table>
      <caption>{line ? `Per year: ${line.columns.toLowerCase()} in ${unit}, ${line.label.toLowerCase()} in ${line.unit}` : `${unit} per year`}</caption>
      <thead>
        <tr>
          <th scope="col">Year</th>
          <th scope="col">{line ? line.columns : "Total"}</th>
          {line && <th scope="col">{line.label}</th>}
          <th scope="col">Coverage</th>
        </tr>
      </thead>
      <tbody>
        {yearly.map((item, index) => (
          <tr key={item.year}>
            <th scope="row">{item.year}</th>
            <td>{formatValue(item.value)}</td>
            {line && <td>{lineValues[index] === null ? "" : formatValue(lineValues[index]!)}</td>}
            <td>{item.complete ? "Full year" : "Partial year"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
