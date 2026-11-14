import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { Climatology, MonthValue } from "../api";
import { MONTHS, MONTHS_LONG, type ScaleMode, SEQUENTIAL, ZERO_FILL, cellColor, formatValue } from "../scale";
import { type Tip, Tooltip } from "./Tooltip";

type Props = {
  months: MonthValue[];
  climatology: Climatology[];
  unit: string;
  mode: ScaleMode;
  dark: boolean;
  highlightYear: number;
  onHighlightYear: (year: number) => void;
};

const SENSOR_NAMES: Record<string, string> = { modis: "MODIS", viirs_snpp: "VIIRS S-NPP", viirs_noaa20: "VIIRS NOAA-20" };

/** Years down, months across, one cell per month coloured by how much burned. */
export function CalendarHeatmap({ months, climatology, unit, mode, dark, highlightYear, onHighlightYear }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const { years, byKey, min, max } = useMemo(() => {
    const byKey = new Map(months.map((m) => [`${m.year}-${m.month}`, m]));
    const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
    const positive = months.map((m) => m.value).filter((v) => v > 0);
    return { years, byKey, min: positive.length ? Math.min(...positive) : 0, max: Math.max(0, ...positive) };
  }, [months]);
  const medians = useMemo(() => new Map(climatology.map((c) => [c.month, c.median])), [climatology]);

  function describe(cell: MonthValue): Omit<Tip, "x" | "y"> {
    const median = medians.get(cell.month) ?? 0;
    const rows = [{ value: formatValue(cell.value), label: unit }];
    rows.push({ value: formatValue(median), label: `median for ${MONTHS_LONG[cell.month - 1]}` });
    if (median > 0) rows.push({ value: `${(cell.value / median).toFixed(2)}×`, label: "of that median" });
    if (cell.sensor) rows.push({ value: SENSOR_NAMES[cell.sensor] ?? cell.sensor, label: "sensor" });
    return { title: `${MONTHS_LONG[cell.month - 1]} ${cell.year}`, rows };
  }

  function showAt(key: string, x: number, y: number) {
    const cell = byKey.get(key);
    setActive(cell ? key : null);
    setTip(cell ? { x, y, ...describe(cell) } : null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
    };
    const move = moves[event.key];
    if (!move || !months.length) return;
    event.preventDefault();
    const [year, month] = (active ?? `${months[0].year}-${months[0].month}`).split("-").map(Number);
    const moved = active ? (year + move[0]) * 12 + (month - 1) + move[1] : year * 12 + month - 1;
    const key = `${Math.floor(moved / 12)}-${(moved % 12) + 1}`;
    if (!byKey.has(key)) return;
    const box = grid.current?.querySelector(`[data-key="${key}"]`)?.getBoundingClientRect();
    if (box) showAt(key, box.left + box.width / 2, box.top + box.height / 2);
  }

  const steps = dark ? [...SEQUENTIAL].reverse() : SEQUENTIAL;
  return (
    <div className="calendar">
      <div
        ref={grid}
        className="calendar-grid"
        role="application"
        aria-label={`Burning activity calendar, ${years[0]} to ${years[years.length - 1]}. Use the arrow keys to read months, or switch to the table.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => showAt("", 0, 0)}
        onPointerLeave={() => showAt("", 0, 0)}
      >
        <span />
        {MONTHS.map((name) => (
          <span key={name} className="calendar-month">
            {name}
          </span>
        ))}
        {years.map((year) => (
          <div className="calendar-row" key={year}>
            <button
              type="button"
              tabIndex={-1}
              className={`calendar-year${year === highlightYear ? " is-selected" : ""}`}
              title={`Highlight ${year} in the seasonal chart`}
              onClick={() => onHighlightYear(year)}
            >
              {year}
            </button>
            {MONTHS.map((_, index) => {
              const key = `${year}-${index + 1}`;
              const cell = byKey.get(key);
              return (
                <span
                  key={key}
                  data-key={key}
                  className={`calendar-cell${cell ? "" : " is-empty"}${key === active ? " is-active" : ""}`}
                  style={cell ? { background: cellColor(cell.value, min, max, mode, dark) } : undefined}
                  onPointerMove={(event) => showAt(key, event.clientX, event.clientY)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="scale-legend" aria-hidden="true">
        <span className="scale-zero" style={{ background: dark ? ZERO_FILL.dark : ZERO_FILL.light }} />
        <span>0</span>
        <span className="scale-ramp">
          {steps.map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
        </span>
        <span>
          {mode === "log"
            ? `${formatValue(min)} to ${formatValue(max)} ${unit}, log scale`
            : `up to ${formatValue(max)} ${unit}`}
        </span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

export function CalendarTable({ months, unit }: { months: MonthValue[]; unit: string }) {
  const byKey = new Map(months.map((m) => [`${m.year}-${m.month}`, m.value]));
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
  return (
    <table>
      <caption>{`Monthly ${unit}`}</caption>
      <thead>
        <tr>
          <th scope="col">Year</th>
          {MONTHS.map((name) => (
            <th scope="col" key={name}>
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {years.map((year) => (
          <tr key={year}>
            <th scope="row">{year}</th>
            {MONTHS.map((name, index) => {
              const value = byKey.get(`${year}-${index + 1}`);
              return <td key={name}>{value === undefined ? "" : formatValue(value)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
