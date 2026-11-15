import { type KeyboardEvent, type PointerEvent, useState } from "react";
import type { Climatology } from "../api";
import { useElementWidth } from "../hooks";
import { MONTHS, MONTHS_LONG, PEAK_SHARE, columnPath, formatValue, monthSpans, peakMonths } from "../scale";
import { type Tip, Tooltip } from "./Tooltip";

type Props = { climatology: Climatology[]; unit: string };

const HEIGHT = 180; // includes the axis band
const MARGIN = { left: 12, right: 12, top: 22, bottom: 26 };

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The headline of the card: which months, and how much of a typical year they hold. */
export function PeakMonthsSummary({ climatology }: { climatology: Climatology[] }) {
  const peak = peakMonths(climatology);
  if (peak.months.length === 0) {
    return (
      <p className="peak-summary">
        No month burns in a typical year here: every monthly median is zero. The seasonal chart shows the years that
        did burn.
      </p>
    );
  }
  return (
    <p className="peak-summary">
      <strong className="peak-months">{monthSpans(peak.months)}</strong>
      <span>
        {`${peak.months.length} ${peak.months.length === 1 ? "month holds" : "months hold"} ${percent(peak.held)} of the burning of a typical year`}
      </span>
    </p>
  );
}

/** Each calendar month's share of a typical year; the peak burning months stand out in the accent colour. */
export function PeakMonthsChart({ climatology, unit }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const peak = peakMonths(climatology);
  const byMonth = new Map(climatology.map((c) => [c.month, c]));
  const shares = MONTHS.map((_, i) => (peak.total > 0 ? (byMonth.get(i + 1)?.median ?? 0) / peak.total : 0));
  const top = Math.max(0.01, ...shares);
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = innerWidth / 12;
  const thickness = Math.max(1, Math.min(40, slot - 6));
  const baseline = MARGIN.top + innerHeight;
  const y = (share: number) => MARGIN.top + innerHeight * (1 - share / top);

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - MARGIN.left) / slot);
    setActive(index >= 0 && index < 12 ? index : null);
    setPointer({ x: event.clientX, y: event.clientY });
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = Math.max(0, Math.min(11, (active ?? -1) + (event.key === "ArrowRight" ? 1 : -1)));
    const box = event.currentTarget.getBoundingClientRect();
    setActive(index);
    setPointer({ x: box.left + MARGIN.left + (index + 0.5) * slot, y: box.top + y(shares[index]) });
  }

  const activeClimatology = active === null ? undefined : byMonth.get(active + 1);
  const tip: Tip | null =
    active === null
      ? null
      : {
          ...pointer,
          title: MONTHS_LONG[active],
          rows: [
            { value: percent(shares[active]), label: "of the burning of a typical year" },
            {
              value: formatValue(activeClimatology?.median ?? 0),
              label: `${unit}, median over ${activeClimatology?.years ?? 0} years`,
            },
            ...(peak.months.includes(active + 1) ? [{ value: "Peak", label: "one of the peak burning months" }] : []),
          ],
        };

  return (
    <div ref={ref}>
      <ul className="legend">
        <li>
          <span className="box-key" style={{ background: "var(--accent)" }} />
          {`Peak burning months: together at least ${percent(PEAK_SHARE)} of a typical year`}
        </li>
        <li>
          <span className="box-key" style={{ background: "var(--axis)" }} />
          Other months
        </li>
      </ul>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Share of a typical year's burning in each month; peak burning months: ${monthSpans(peak.months) || "none"}. Use the left and right arrow keys to read months.`}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <line className="axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={baseline} y2={baseline} />
          {MONTHS.map((name, index) => {
            const left = MARGIN.left + index * slot + (slot - thickness) / 2;
            const inPeak = peak.months.includes(index + 1);
            return (
              <g key={name}>
                <path
                  className={`column${inPeak ? "" : " is-quiet"}${index === active ? " is-active" : ""}`}
                  d={columnPath(left, baseline, thickness, baseline - y(shares[index]))}
                />
                {inPeak && (
                  <text className="tick peak-label" x={MARGIN.left + (index + 0.5) * slot} y={y(shares[index]) - 6} textAnchor="middle">
                    {percent(shares[index])}
                  </text>
                )}
                <text className="tick" x={MARGIN.left + (index + 0.5) * slot} y={HEIGHT - 8} textAnchor="middle">
                  {name}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function PeakMonthsTable({ climatology, unit }: Props) {
  const peak = peakMonths(climatology);
  const byMonth = new Map(climatology.map((c) => [c.month, c]));
  return (
    <table>
      <caption>{`Each month's median over the record, in ${unit}, and its share of a typical year`}</caption>
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Median</th>
          <th scope="col">Share of a typical year</th>
          <th scope="col">Peak burning month</th>
        </tr>
      </thead>
      <tbody>
        {MONTHS_LONG.map((name, index) => {
          const median = byMonth.get(index + 1)?.median ?? 0;
          return (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{formatValue(median)}</td>
              <td>{peak.total > 0 ? percent(median / peak.total) : "–"}</td>
              <td>{peak.months.includes(index + 1) ? "Yes" : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
