import { type KeyboardEvent, type PointerEvent, useState } from "react";
import type { Climatology, MonthValue } from "../api";
import { useElementWidth } from "../hooks";
import { MONTHS, MONTHS_LONG, formatTick, formatValue, niceTicks } from "../scale";
import { type Tip, Tooltip } from "./Tooltip";

type Props = { months: MonthValue[]; climatology: Climatology[]; year: number; unit: string };

const HEIGHT = 260; // includes the axis band
const MARGIN = { left: 48, right: 12, top: 10, bottom: 26 };

/** One year against the usual season: the median of each calendar month and the middle half of years. */
export function SeasonalChart({ months, climatology, year, unit }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  const ofYear = new Map(months.filter((m) => m.year === year).map((m) => [m.month, m.value]));
  const clim = new Map(climatology.map((c) => [c.month, c]));
  const top = Math.max(1, ...climatology.map((c) => c.p75), ...ofYear.values());
  const ticks = niceTicks(top);
  const yMax = ticks[ticks.length - 1];
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (month: number) => MARGIN.left + ((month - 0.5) * innerWidth) / 12;
  const y = (value: number) => MARGIN.top + innerHeight * (1 - value / yMax);

  const present = climatology.map((c) => c.month).sort((a, b) => a - b);
  const band = [
    ...present.map((m) => `${x(m)},${y(clim.get(m)!.p75)}`),
    ...[...present].reverse().map((m) => `${x(m)},${y(clim.get(m)!.p25)}`),
  ].join(" ");
  const medianLine = present.map((m) => `${x(m)},${y(clim.get(m)!.median)}`).join(" ");
  const yearMonths = [...ofYear.keys()].sort((a, b) => a - b);
  const yearLine = yearMonths.map((m) => `${x(m)},${y(ofYear.get(m)!)}`).join(" ");
  const lastMonth = yearMonths[yearMonths.length - 1];

  function tipFor(month: number): Tip {
    const c = clim.get(month);
    const rows = [];
    if (ofYear.has(month)) rows.push({ value: formatValue(ofYear.get(month)!), label: String(year), swatch: "var(--accent)" });
    if (c) {
      rows.push({ value: formatValue(c.median), label: "median", swatch: "var(--muted)" });
      rows.push({ value: `${formatValue(c.p25)} to ${formatValue(c.p75)}`, label: "middle half of years" });
    }
    return { ...pointer, title: MONTHS_LONG[month - 1], rows };
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const month = Math.floor(((event.clientX - box.left - MARGIN.left) / innerWidth) * 12) + 1;
    setActive(Math.max(1, Math.min(12, month)));
    setPointer({ x: event.clientX, y: event.clientY });
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const month = Math.max(1, Math.min(12, (active ?? 0) + (event.key === "ArrowRight" ? 1 : -1)));
    const box = event.currentTarget.getBoundingClientRect();
    setActive(month);
    setPointer({ x: box.left + x(month), y: box.top + MARGIN.top + innerHeight / 3 });
  }

  return (
    <div ref={ref}>
      <ul className="legend">
        <li>
          <span className="line-key" style={{ background: "var(--accent)" }} />
          {year}
        </li>
        <li>
          <span className="line-key" style={{ background: "var(--muted)" }} />
          Median of all years
        </li>
        <li>
          <span className="band-key" />
          Middle half of years (25th to 75th percentile)
        </li>
      </ul>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Monthly ${unit} in ${year} against the median of all years. Use the left and right arrow keys to read months.`}
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
          {MONTHS.map((name, index) => (
            <text key={name} className="tick" x={x(index + 1)} y={HEIGHT - 8} textAnchor="middle">
              {name}
            </text>
          ))}
          <polygon className="band" points={band} />
          <polyline className="line line-muted" points={medianLine} />
          <polyline className="line line-accent" points={yearLine} />
          {active !== null && (
            <line className="crosshair" x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} />
          )}
          {lastMonth !== undefined && <circle className="end-dot" cx={x(lastMonth)} cy={y(ofYear.get(lastMonth)!)} r={4} />}
          {active !== null && ofYear.has(active) && (
            <circle className="end-dot" cx={x(active)} cy={y(ofYear.get(active)!)} r={4} />
          )}
        </svg>
      )}
      <Tooltip tip={active === null ? null : tipFor(active)} />
    </div>
  );
}

export function SeasonalTable({ months, climatology, year, unit }: Props) {
  const ofYear = new Map(months.filter((m) => m.year === year).map((m) => [m.month, m.value]));
  return (
    <table>
      <caption>{`Monthly ${unit}: ${year} against all years`}</caption>
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">{year}</th>
          <th scope="col">Median</th>
          <th scope="col">25th percentile</th>
          <th scope="col">75th percentile</th>
          <th scope="col">Years</th>
        </tr>
      </thead>
      <tbody>
        {climatology.map((c) => (
          <tr key={c.month}>
            <th scope="row">{MONTHS_LONG[c.month - 1]}</th>
            <td>{ofYear.has(c.month) ? formatValue(ofYear.get(c.month)!) : ""}</td>
            <td>{formatValue(c.median)}</td>
            <td>{formatValue(c.p25)}</td>
            <td>{formatValue(c.p75)}</td>
            <td>{c.years}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
