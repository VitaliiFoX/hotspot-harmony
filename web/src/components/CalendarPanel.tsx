import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordPeriod } from '../api/types';
import {
  buildCalendarOption,
  calendarHeight,
  cellTooltipLines,
  modeLabel,
  periodText,
} from '../charts/calendarOption';
import type { EChartsType } from '../charts/echarts';
import { formatCount } from '../lib/format';
import {
  cellValue,
  type ColorScale,
  type MonthGrid,
  type RecordMode,
  type SensorPeriod,
} from '../lib/monthGrid';
import { MONTH_SHORT, labelYM, type YM } from '../lib/ym';
import { EChart } from './EChart';
import { Segmented } from './Segmented';
import { useElementWidth } from './useElementWidth';

type View = 'chart' | 'table';

interface CalendarPanelProps {
  grid: MonthGrid;
  mode: RecordMode;
  scale: ColorScale;
  onScale: (scale: ColorScale) => void;
  periods: SensorPeriod[];
  record: readonly RecordPeriod[];
  unit: string;
  highlight: YM | null;
}

const SCALE_NOTE: Record<ColorScale, string> = {
  linear: 'Colour: light yellow = few, dark purple = many (linear scale). Grey = no hotspots.',
  log: 'Colour: light yellow = few, dark purple = many (logarithmic scale, so quiet months stay visible). Grey = no hotspots.',
  deviation:
    'Colour: compared with the usual level for that calendar month. Orange = above usual, purple = below usual, near white = as usual. One is added to both numbers before dividing, so months with tiny counts do not look extreme.',
};

/** The burning activity calendar: years down, months across, with a table alternative. */
export function CalendarPanel({
  grid,
  mode,
  scale,
  onScale,
  periods,
  record,
  unit,
  highlight,
}: CalendarPanelProps) {
  const [view, setView] = useState<View>('chart');
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const chartRef = useRef<EChartsType | null>(null);
  const compact = width > 0 && width < 460;

  const option = useMemo(
    () => buildCalendarOption({ grid, mode, scale, periods, record, unit, compact }),
    [grid, mode, scale, periods, record, unit, compact],
  );
  const height = calendarHeight({ grid, periods });

  const highlightIndex = highlight
    ? grid.cells.findIndex((c) => c.year === highlight.year && c.month === highlight.month)
    : -1;

  const handleChart = useCallback((chart: EChartsType | null) => {
    chartRef.current = chart;
  }, []);

  // Point at the month picked in the "most unusual months" list.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || view !== 'chart') return;
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    if (highlightIndex >= 0) {
      chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: highlightIndex });
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: highlightIndex });
    } else {
      chart.dispatchAction({ type: 'hideTip' });
    }
  }, [highlightIndex, option, view]);

  const range =
    grid.first && grid.last ? `${labelYM(grid.first)} to ${labelYM(grid.last)}` : 'no months';
  const chartLabel = `Calendar heatmap of ${unit} per month, ${modeLabel(mode)}, ${range}. Rows are years, columns are months. Use "View as table" for the numbers.`;

  return (
    <div className="calendar">
      <div className="calendar__controls">
        <Segmented
          legend="Colour scale"
          value={scale}
          onChange={onScale}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'log', label: 'Log' },
            { value: 'deviation', label: 'Vs usual' },
          ]}
        />
        <Segmented
          legend="View as"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Calendar' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>

      <div ref={wrapRef}>
        {view === 'chart' ? (
          <EChart option={option} height={height} label={chartLabel} onChart={handleChart} />
        ) : (
          <div className="table-scroll" role="region" aria-label="Calendar as a table" tabIndex={0}>
            <table className="calendar-table">
              <caption>
                {unit} per month, {modeLabel(mode)}. A dash marks months outside the selected range.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {MONTH_SHORT.map((name) => (
                    <th key={name} scope="col">
                      {name}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {grid.years.map((year, rowIndex) => {
                  const row = grid.rows[rowIndex] ?? [];
                  const total = row.reduce((sum, c) => sum + (c ? cellValue(c, mode) : 0), 0);
                  return (
                    <tr key={year}>
                      <th scope="row">{year}</th>
                      {row.map((cell, monthIndex) => {
                        const marked =
                          highlight?.year === year && highlight.month === monthIndex + 1;
                        return (
                          <td
                            key={monthIndex}
                            className={marked ? 'is-marked' : undefined}
                            title={
                              cell
                                ? `${labelYM(cell)}: ${cellTooltipLines(cell, mode, record, unit).join('; ')}`
                                : undefined
                            }
                          >
                            {cell ? formatCount(cellValue(cell, mode)) : '–'}
                          </td>
                        );
                      })}
                      <td className="is-total">{formatCount(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {view === 'chart' ? <p className="note">{SCALE_NOTE[scale]}</p> : null}

      {periods.length > 0 ? (
        <div className="sensor-legend">
          <h4 className="mini-heading">
            {mode === 'raw' ? 'Where the raw numbers come from' : 'Which sensor measured what'}
          </h4>
          <ul>
            {periods.map((period) => (
              <li key={period.letter}>
                <span className="sensor-legend__letter" aria-hidden="true">
                  {period.letter}
                </span>
                <span>{periodText(period).slice(3)}</span>
              </li>
            ))}
          </ul>
          <p className="note">
            Letters on the right of the calendar mark the row where each period starts; the thin
            dark line is the exact month.
          </p>
        </div>
      ) : null}
    </div>
  );
}
