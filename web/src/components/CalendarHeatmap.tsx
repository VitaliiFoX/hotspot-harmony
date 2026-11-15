import { formatDecimal, monthName, monthShort, monthTitle, t } from "../i18n";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { Climatology, MonthValue } from "../api";
import { MONTHS, type ScaleMode, ZERO_FILL, cellColor, formatValue, monthTick, rampGradient } from "../scale";
import { type Tip, Tooltip } from "./Tooltip";

type Props = {
  months: MonthValue[];
  climatology: Climatology[];
  unit: string;
  mode: ScaleMode;
  highlightYear: number;
  onHighlightYear: (year: number) => void;
  /** The months the map at the top of the page is on, "YYYY-MM", outlined here; none while it shows the whole period. */
  shownMonths?: string[];
  /** Called with a month, "YYYY-MM", clicked here (or chosen with Enter): the map shows where it burned in it. */
  onShowMonth?: (month: string) => void;
};

/** The "YYYY-MM" of a cell key, "2020-8". */
function monthOfKey(key: string): string {
  const [year, month] = key.split("-");
  return `${year}-${month.padStart(2, "0")}`;
}

const SENSOR_NAMES: Record<string, string> = {
  modis_terra: "MODIS Terra, scaled",
  modis: "MODIS",
  viirs_snpp: "VIIRS S-NPP",
  viirs_noaa20: "VIIRS NOAA-20, harmonized",
};

/** Years down, months across, one cell per month coloured by how much burned. */
export function CalendarHeatmap({
  months, climatology, unit, mode, highlightYear, onHighlightYear, shownMonths = [], onShowMonth,
}: Props) {
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
    rows.push({ value: formatValue(median), label: t("median for {month}", { month: monthName(cell.month) }) });
    if (median > 0) rows.push({ value: `${formatDecimal(cell.value / median, 2)}×`, label: t("of that median") });
    if (cell.sensor) rows.push({ value: t(SENSOR_NAMES[cell.sensor] ?? cell.sensor), label: t("sensor") });
    if (onShowMonth) rows.push({ value: "↑", label: t("click to see its hotspots on the map") });
    return { title: `${monthTitle(cell.month)} ${cell.year}`, rows };
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
    if ((event.key === "Enter" || event.key === " ") && active && onShowMonth) {
      event.preventDefault();
      onShowMonth(monthOfKey(active));
      return;
    }
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

  // The outlined months the calendar holds, in order.
  const outlined = shownMonths.filter((m) => byKey.has(`${Number(m.slice(0, 4))}-${Number(m.slice(5, 7))}`)).sort();
  const readMonth = (m: string) => `${monthTitle(Number(m.slice(5, 7)))} ${m.slice(0, 4)}`;
  return (
    <div className="calendar">
      {/* A dark plate under the grid and its legend, whatever the theme: see .calendar-plate. */}
      <div className="calendar-plate">
        <div
          ref={grid}
          className="calendar-grid"
          role="application"
          aria-label={[
            t("Burning activity calendar, {first} to {last}. Use the arrow keys to read months, or switch to the table.", {
              first: years[0],
              last: years[years.length - 1],
            }),
            onShowMonth ? t("Press Enter to see the hotspots of that month on the map.") : "",
          ].filter(Boolean).join(" ")}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => showAt("", 0, 0)}
          onPointerLeave={() => showAt("", 0, 0)}
        >
          <span />
          {MONTHS.map((name, index) => (
            <span key={name} className="calendar-month">
              <span className="calendar-month-short">{monthShort(index + 1)}</span>
              <span className="calendar-month-letter">{monthTick(index + 1, 0)}</span>
            </span>
          ))}
          {years.map((year) => (
            <div className="calendar-row" key={year}>
              <button
                type="button"
                tabIndex={-1}
                className={`calendar-year${year === highlightYear ? " is-selected" : ""}`}
                title={t("Highlight {year} in the seasonal chart", { year })}
                onClick={() => onHighlightYear(year)}
              >
                {year}
              </button>
              {MONTHS.map((_, index) => {
                const key = `${year}-${index + 1}`;
                const cell = byKey.get(key);
                const shown = shownMonths.includes(monthOfKey(key));
                return (
                  <span
                    key={key}
                    data-key={key}
                    className={`calendar-cell${cell ? "" : " is-empty"}${key === active ? " is-active" : ""}${shown ? " is-shown" : ""}${
                      cell && onShowMonth ? " is-pickable" : ""
                    }`}
                    style={cell ? { background: cellColor(cell.value, min, max, mode) } : undefined}
                    onPointerMove={(event) => showAt(key, event.clientX, event.clientY)}
                    onClick={cell && onShowMonth ? () => onShowMonth(monthOfKey(key)) : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="scale-legend" aria-hidden="true">
          <span className="scale-zero" style={{ background: ZERO_FILL }} />
          <span>0</span>
          <span className="scale-ramp" style={{ background: rampGradient() }} />
          <span>
            {mode === "log"
              ? t("{min} to {max} {unit}, log scale", { min: formatValue(min), max: formatValue(max), unit })
              : t("up to {max} {unit}", { max: formatValue(max), unit })}
          </span>
        </div>
      </div>
      {onShowMonth && (
        <p className="calendar-note">
          {outlined.length === 0
            ? t("Click a month to see its hotspots on the map above.")
            : outlined.length === 1
              ? t("Outlined: {month}, the month on the map above. Click any month to see its hotspots.", {
                  month: readMonth(outlined[0]),
                })
              : t("Outlined: {from} to {to}, the months on the map above. Click any month to see its hotspots.", {
                  from: readMonth(outlined[0]),
                  to: readMonth(outlined[outlined.length - 1]),
                })}
        </p>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function CalendarTable({ months, unit }: { months: MonthValue[]; unit: string }) {
  const byKey = new Map(months.map((m) => [`${m.year}-${m.month}`, m.value]));
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => a - b);
  return (
    <table>
      <caption>{t("Monthly {unit}", { unit })}</caption>
      <thead>
        <tr>
          <th scope="col">{t("Year")}</th>
          {MONTHS.map((name, index) => (
            <th scope="col" key={name}>
              {monthShort(index + 1)}
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
