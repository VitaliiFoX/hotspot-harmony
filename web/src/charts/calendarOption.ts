import type {
  CustomSeriesRenderItem,
  CustomSeriesRenderItemReturn,
  EChartsOption,
  TooltipComponentFormatterCallbackParams,
} from 'echarts';
import type { RecordPeriod } from '../api/types';
import {
  DEVIATION_LIMIT,
  INK,
  PUOR_BELOW_TO_ABOVE,
  VIRIDIS_LOW_TO_HIGH,
  ZERO_COLOR,
} from '../lib/colors';
import { escapeHtml, formatCount, formatRange, formatRatio } from '../lib/format';
import {
  cellValue,
  colorValue,
  ratioToMedian,
  rawSourceLabel,
  sensorLabel,
  type ColorScale,
  type GridCell,
  type MonthGrid,
  type RecordMode,
  type SensorPeriod,
} from '../lib/monthGrid';
import { labelYM, monthName, monthShort, shortLabelYM } from '../lib/ym';
import { FONT_FAMILY } from './echarts';

export const ROW_HEIGHT = 18;
const TOP = 28;
const BOTTOM = 66;
const EXPORT_TITLE = 58;

export interface CalendarOptionInput {
  grid: MonthGrid;
  mode: RecordMode;
  scale: ColorScale;
  /** Sensor periods for the current mode, clipped to the visible range. */
  periods: SensorPeriod[];
  /** Full record description, to label `sensor_used` codes in tooltips. */
  record: readonly RecordPeriod[];
  unit: string;
  /** Narrow layout: one-letter month labels. */
  compact: boolean;
  /** When set, a title, the period legend and the attribution are drawn into the image. */
  exportInfo?: { title: string; subtitle: string; attribution: string };
}

export function calendarHeight(
  input: Pick<CalendarOptionInput, 'grid' | 'periods'>,
  forExport = false,
): number {
  const rows = Math.max(1, input.grid.years.length);
  const extra = forExport ? EXPORT_TITLE + 18 * (input.periods.length + 1) + 8 : 0;
  return TOP + rows * ROW_HEIGHT + BOTTOM + extra;
}

export function modeLabel(mode: RecordMode): string {
  return mode === 'raw' ? 'raw, uncorrected' : 'harmonized';
}

export function periodText(period: SensorPeriod): string {
  return `${period.letter}: ${period.label} (${shortLabelYM(period.from)} – ${shortLabelYM(period.to)})`;
}

/** Text for one cell, shared by the chart tooltip and the table view. */
export function cellTooltipLines(
  cell: GridCell,
  mode: RecordMode,
  record: readonly RecordPeriod[],
  unit: string,
): string[] {
  const value = cellValue(cell, mode);
  const lines: string[] = [];
  lines.push(`${formatCount(value)} ${unit} (${modeLabel(mode)})`);
  if (mode === 'harmonized') {
    if (cell.lo !== cell.hi) lines.push(`90% range: ${formatRange(cell.lo, cell.hi)}`);
    lines.push(`Source: ${sensorLabel(cell.sensor, record)}`);
  } else {
    lines.push(`Source: ${rawSourceLabel(cell)}`);
  }
  const month = monthName(cell.month);
  if (cell.median !== null) {
    const ratio = ratioToMedian(value, cell.median);
    const usual = `usual ${month}: ${formatCount(cell.median)}`;
    if (ratio === null) {
      lines.push(value > 0 ? `Above usual (${usual})` : `As usual (${usual})`);
    } else if (value === 0) {
      lines.push(`No hotspots (${usual})`);
    } else {
      lines.push(`${formatRatio(ratio)} the usual level (${usual})`);
    }
  }
  if (mode === 'raw') lines.push(`Harmonized value: ${formatCount(cell.harmonized)}`);
  else lines.push(`Raw count: ${formatCount(cell.raw)}`);
  return lines;
}

function tooltipHtml(
  cell: GridCell,
  mode: RecordMode,
  record: readonly RecordPeriod[],
  unit: string,
): string {
  const [first, ...rest] = cellTooltipLines(cell, mode, record, unit);
  return [
    `<strong>${escapeHtml(labelYM(cell))}</strong>`,
    `<span style="font-weight:600">${escapeHtml(first ?? '')}</span>`,
    ...rest.map((line) => escapeHtml(line)),
  ].join('<br/>');
}

interface ScaleSpec {
  min: number;
  max: number;
  range?: [number, number];
  colors: string[];
  text: [string, string];
}

function scaleSpec(grid: MonthGrid, mode: RecordMode, scale: ColorScale): ScaleSpec {
  if (scale === 'deviation') {
    return {
      min: -DEVIATION_LIMIT,
      max: DEVIATION_LIMIT,
      colors: [...PUOR_BELOW_TO_ABOVE],
      text: ['8x usual or more', '1/8 of usual or less'],
    };
  }
  const maxValue = mode === 'raw' ? grid.maxRaw : grid.maxHarmonized;
  const max = scale === 'log' ? Math.log10(1 + maxValue) : maxValue;
  const safeMax = max > 0 ? max : 1;
  return {
    min: 0,
    max: safeMax,
    // Months with no hotspots fall below the range and get the neutral "zero" colour.
    range: [safeMax * 1e-9, safeMax],
    colors: [...VIRIDIS_LOW_TO_HIGH],
    text: [formatCount(maxValue), '0'],
  };
}

/** Thin stepped line between two sensor periods, following the month where the new one starts. */
const renderSeparator: CustomSeriesRenderItem = (params, api) => {
  const month = Number(api.value(0));
  const row = Number(api.value(1));
  const size = api.size ? api.size([1, 1]) : [0, 0];
  const [w, h] = Array.isArray(size) ? (size as [number, number]) : [0, 0];
  const centre = api.coord([month, row]) as [number, number];
  const sys = params.coordSys as unknown as { x: number; width: number };
  const left = centre[0] - w / 2;
  const top = centre[1] - h / 2;
  const x0 = sys.x;
  const x1 = sys.x + sys.width;
  const points: [number, number][] =
    month === 0
      ? [
          [x0, top],
          [x1, top],
        ]
      : [
          [x0, top + h],
          [left, top + h],
          [left, top],
          [x1, top],
        ];
  const line = (stroke: string, lineWidth: number) => ({
    type: 'polyline' as const,
    shape: { points },
    style: { stroke, lineWidth, fill: 'none' },
    silent: true,
  });
  return {
    type: 'group',
    children: [line('#ffffff', 4), line(INK.text, 1.5)],
  } as CustomSeriesRenderItemReturn;
};

/** Period letter in the right margin, on the row where the period starts. */
const renderLetter: CustomSeriesRenderItem = (params, api) => {
  const row = Number(api.value(1));
  const letter = String(api.value(2));
  const centre = api.coord([11, row]) as [number, number];
  const sys = params.coordSys as unknown as { x: number; width: number };
  return {
    type: 'text',
    silent: true,
    style: {
      text: letter,
      x: sys.x + sys.width + 8,
      y: centre[1],
      fill: INK.text,
      font: `700 12px ${FONT_FAMILY}`,
      textVerticalAlign: 'middle',
    },
  } as CustomSeriesRenderItemReturn;
};

export function buildCalendarOption(input: CalendarOptionInput): EChartsOption {
  const { grid, mode, scale, periods, record, unit, compact, exportInfo } = input;
  const firstYear = grid.years[0] ?? 0;
  const spec = scaleSpec(grid, mode, scale);
  const top = TOP + (exportInfo ? EXPORT_TITLE : 0);
  const footer = exportInfo ? 18 * (periods.length + 1) + 8 : 0;

  const data = grid.cells.map((cell) => ({
    value: [cell.month - 1, cell.year - firstYear, colorValue(cell, mode, scale)],
  }));

  const firstCell = grid.first;
  const separators = periods
    .filter(
      (p) => !(firstCell && p.from.year === firstCell.year && p.from.month === firstCell.month),
    )
    .map((p) => [p.from.month - 1, p.from.year - firstYear]);
  const letters = periods.map((p) => [11, p.from.year - firstYear, p.letter]);

  const option: EChartsOption = {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    aria: { enabled: false },
    grid: { left: 44, right: 26, top, bottom: BOTTOM + footer },
    xAxis: {
      type: 'category',
      position: 'top',
      data: Array.from({ length: 12 }, (_, i) => monthShort(i + 1)),
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        interval: 0,
        color: INK.muted,
        fontSize: 11,
        formatter: (value: string) => (compact ? value.charAt(0) : value),
      },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: grid.years.map(String),
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { interval: 0, color: INK.muted, fontSize: 11 },
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: '#ffffff',
      borderColor: INK.axis,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: INK.text, fontSize: 12, fontFamily: FONT_FAMILY },
      extraCssText: 'max-width: 280px; white-space: normal; line-height: 1.45;',
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p || p.seriesIndex !== 0) return '';
        const cell = grid.cells[p.dataIndex];
        return cell ? tooltipHtml(cell, mode, record, unit) : '';
      },
    },
    visualMap: {
      type: 'continuous',
      seriesIndex: 0,
      dimension: 2,
      min: spec.min,
      max: spec.max,
      ...(spec.range ? { range: spec.range } : {}),
      inRange: { color: spec.colors },
      outOfRange: { color: [ZERO_COLOR] },
      calculable: false,
      hoverLink: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 10 + footer,
      itemWidth: 12,
      itemHeight: compact ? 110 : 200,
      text: spec.text,
      textGap: 8,
      textStyle: { color: INK.muted, fontSize: 11 },
    },
    series: [
      {
        type: 'heatmap',
        name: 'calendar',
        data,
        itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK.text, borderWidth: 2 } },
        progressive: 0,
      },
      {
        type: 'custom',
        name: 'sensor-separators',
        renderItem: renderSeparator,
        data: separators,
        silent: true,
        tooltip: { show: false },
        z: 5,
      },
      {
        type: 'custom',
        name: 'sensor-letters',
        renderItem: renderLetter,
        data: letters,
        silent: true,
        clip: false,
        tooltip: { show: false },
        z: 5,
      },
    ],
  };

  if (exportInfo) {
    option.backgroundColor = '#ffffff';
    option.title = {
      text: exportInfo.title,
      subtext: exportInfo.subtitle,
      left: 12,
      top: 10,
      textStyle: { color: INK.text, fontSize: 16, fontWeight: 600, fontFamily: FONT_FAMILY },
      subtextStyle: { color: INK.muted, fontSize: 12, fontFamily: FONT_FAMILY },
    };
    const lines = [
      ...periods.map(periodText),
      `Data: ${exportInfo.attribution}. Hotspots are thermal anomalies, not confirmed fires.`,
    ];
    option.graphic = lines.map((text, i) => ({
      type: 'text' as const,
      left: 12,
      bottom: 8 + 18 * (lines.length - 1 - i),
      style: { text, fill: INK.muted, font: `12px ${FONT_FAMILY}` },
    }));
  }

  return option;
}
