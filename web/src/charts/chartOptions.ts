import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts';
import type { ClimatologyMonth, YearValue } from '../api/types';
import { INK, SERIES } from '../lib/colors';
import { escapeHtml, formatCompact, formatCount, formatPercent } from '../lib/format';
import { RAW_SPLICE, type MonthGrid, type RecordMode } from '../lib/monthGrid';
import { frpBinLabel, type DetectionPoint } from '../lib/report';
import { monthName, monthShort } from '../lib/ym';
import { FONT_FAMILY } from './echarts';

const AXIS_LABEL = { color: INK.muted, fontSize: 11 };
const SPLIT_LINE = { lineStyle: { color: INK.grid } };

function baseTooltip() {
  return {
    confine: true,
    backgroundColor: '#ffffff',
    borderColor: INK.axis,
    borderWidth: 1,
    padding: [8, 10] as [number, number],
    textStyle: { color: INK.text, fontSize: 12, fontFamily: FONT_FAMILY },
    extraCssText: 'max-width: 280px; white-space: normal; line-height: 1.45;',
  };
}

function swatch(color: string, dashed = false): string {
  const style = dashed
    ? `border-top:2px dashed ${color};width:14px;height:0`
    : `background:${color};width:14px;height:3px;border-radius:2px`;
  return `<span style="display:inline-block;vertical-align:middle;margin-right:6px;${style}"></span>`;
}

function firstIndex(params: TooltipComponentFormatterCallbackParams): number | null {
  const p = Array.isArray(params) ? params[0] : params;
  return p ? p.dataIndex : null;
}

const LEGEND = {
  bottom: 0,
  left: 'center',
  itemWidth: 18,
  itemHeight: 8,
  itemGap: 14,
  textStyle: { color: INK.text, fontSize: 12, fontFamily: FONT_FAMILY },
} as const;

export interface YearlyOptionInput {
  yearly: readonly YearValue[];
  mode: RecordMode;
  unit: string;
}

/** Yearly totals: harmonized and raw side by side, with a marker where VIIRS takes over. */
export function buildYearlyOption({ yearly, mode, unit }: YearlyOptionInput): EChartsOption {
  const years = yearly.map((y) => String(y.year));
  const hasSplice = yearly.some((y) => y.year === RAW_SPLICE.year);
  const point = (value: number, complete: boolean, color: string) =>
    complete
      ? { value }
      : { value, itemStyle: { color: '#ffffff', borderColor: color, borderWidth: 2 } };

  const lineFor = (key: RecordMode) => {
    const color = key === 'raw' ? SERIES.raw : SERIES.harmonized;
    const active = key === mode;
    return {
      type: 'line' as const,
      name: key === 'raw' ? 'Raw (uncorrected)' : 'Harmonized',
      data: yearly.map((y) => point(key === 'raw' ? y.n_raw : y.n_harmonized, y.complete, color)),
      symbol: 'circle',
      symbolSize: active ? 7 : 5,
      lineStyle: {
        color,
        width: active ? 2.5 : 1.5,
        type: key === 'raw' ? ('dashed' as const) : ('solid' as const),
      },
      itemStyle: { color },
      z: active ? 3 : 2,
      emphasis: { focus: 'none' as const },
    };
  };

  const harmonized = lineFor('harmonized');
  const raw = lineFor('raw');

  return {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    grid: { left: 48, right: 16, top: 28, bottom: 58 },
    legend: { ...LEGEND, data: [harmonized.name, raw.name] },
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: INK.axis } },
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const index = firstIndex(params);
        const y = index === null ? undefined : yearly[index];
        if (!y) return '';
        return [
          `<strong>${y.year}</strong>${y.complete ? '' : ' (incomplete year)'}`,
          `${swatch(SERIES.harmonized)}Harmonized: ${formatCount(y.n_harmonized)}`,
          `${swatch(SERIES.raw, true)}Raw: ${formatCount(y.n_raw)}`,
          `<span style="color:${INK.muted}">${escapeHtml(unit)} per year</span>`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: years,
      boundaryGap: false,
      axisLine: { lineStyle: { color: INK.axis } },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatCompact(v) },
      splitLine: SPLIT_LINE,
    },
    series: [
      {
        ...harmonized,
        markLine: hasSplice
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: INK.text, type: 'dotted', width: 1.5 },
              label: {
                formatter: 'VIIRS begins (2012)',
                position: 'insideEndTop',
                color: INK.text,
                fontSize: 11,
              },
              data: [{ xAxis: String(RAW_SPLICE.year) }],
            }
          : undefined,
      },
      raw,
    ],
  };
}

export interface SeasonalOptionInput {
  climatology: readonly ClimatologyMonth[];
  grid: MonthGrid;
  unit: string;
}

/** Year shown on top of the seasonal profile: the last one in the range. */
export function latestYear(grid: MonthGrid): number | null {
  return grid.last ? grid.last.year : null;
}

/** Seasonal profile: median line, p25-p75 band, and the latest year on top. */
export function buildSeasonalOption({
  climatology,
  grid,
  unit,
}: SeasonalOptionInput): EChartsOption {
  const byMonth = new Map<number, ClimatologyMonth>();
  for (const c of climatology) byMonth.set(c.month, c);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const year = latestYear(grid);
  const row = year === null ? undefined : grid.rows[grid.years.indexOf(year)];
  const latest = months.map((m) => row?.[m - 1]?.harmonized ?? null);
  const median = months.map((m) => byMonth.get(m)?.median ?? null);
  const p25 = months.map((m) => byMonth.get(m)?.p25 ?? null);
  const p75 = months.map((m) => byMonth.get(m)?.p75 ?? null);
  const bandName = 'Middle half of years';
  const latestName = year === null ? 'Latest year' : String(year);

  return {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    grid: { left: 48, right: 16, top: 16, bottom: 62 },
    legend: { ...LEGEND, data: ['Median', bandName, latestName] },
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: INK.axis } },
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const i = firstIndex(params);
        if (i === null) return '';
        const lines = [`<strong>${monthName(i + 1)}</strong>`];
        if (latest[i] !== null && latest[i] !== undefined) {
          lines.push(`${swatch(SERIES.latest)}${latestName}: ${formatCount(latest[i])}`);
        }
        lines.push(`${swatch(SERIES.median)}Median: ${formatCount(median[i])}`);
        lines.push(
          `${swatch(SERIES.band)}Middle half of years (25th to 75th percentile): ${formatCount(p25[i])}–${formatCount(p75[i])}`,
        );
        lines.push(
          `<span style="color:${INK.muted}">${escapeHtml(unit)} per month, harmonized</span>`,
        );
        return lines.join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: months.map(monthShort),
      boundaryGap: false,
      axisLine: { lineStyle: { color: INK.axis } },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, interval: 0, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatCompact(v) },
      splitLine: SPLIT_LINE,
    },
    series: [
      {
        // Invisible base of the band: the band is stacked on top of the 25th percentile.
        type: 'line',
        name: 'p25',
        data: p25,
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        silent: true,
        tooltip: { show: false },
      },
      {
        type: 'line',
        name: bandName,
        data: months.map((_, i) => {
          const lo = p25[i];
          const hi = p75[i];
          return lo === null || lo === undefined || hi === null || hi === undefined
            ? null
            : Math.max(0, hi - lo);
        }),
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: SERIES.band, opacity: 0.9 },
        itemStyle: { color: SERIES.band },
        silent: true,
      },
      {
        type: 'line',
        name: 'Median',
        data: median,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: SERIES.median, width: 2 },
        itemStyle: { color: SERIES.median },
        z: 3,
      },
      {
        type: 'line',
        name: latestName,
        data: latest,
        symbol: 'diamond',
        symbolSize: 7,
        connectNulls: false,
        lineStyle: { color: SERIES.latest, width: 2.5 },
        itemStyle: { color: SERIES.latest },
        z: 4,
      },
    ],
  };
}

/** Detection curve: chance that MODIS also sees a fire that VIIRS detected, by fire power. */
export function buildDetectionOption(curve: readonly DetectionPoint[]): EChartsOption {
  const bins: DetectionPoint[] = [];
  for (const point of curve) {
    if (!bins.some((b) => b.frpFrom === point.frpFrom && b.frpTo === point.frpTo)) bins.push(point);
  }
  const labels = bins.map(frpBinLabel);
  const valuesFor = (day: boolean) =>
    bins.map(
      (bin) =>
        curve.find((p) => p.day === day && p.frpFrom === bin.frpFrom && p.frpTo === bin.frpTo)?.p ??
        null,
    );
  const day = valuesFor(true);
  const night = valuesFor(false);
  const series = [
    { name: 'Daytime', values: day, color: SERIES.day, dashed: false },
    { name: 'Night only', values: night, color: SERIES.night, dashed: true },
  ].filter((s) => s.values.some((v) => v !== null));

  return {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    grid: { left: 44, right: 16, top: 16, bottom: 74 },
    legend: { ...LEGEND, data: series.map((s) => s.name) },
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: INK.axis } },
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const i = firstIndex(params);
        if (i === null) return '';
        const lines = [`<strong>Fire power ${escapeHtml(labels[i] ?? '')} MW</strong>`];
        for (const s of series) {
          lines.push(
            `${swatch(s.color, s.dashed)}${s.name}: ${formatPercent(s.values[i], { digits: 0 })} also seen by MODIS`,
          );
        }
        return lines.join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      name: 'Fire radiative power of the VIIRS cell-day, MW',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: INK.muted, fontSize: 11 },
      axisLine: { lineStyle: { color: INK.axis } },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL, interval: 0, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatPercent(v, { digits: 0 }) },
      splitLine: SPLIT_LINE,
    },
    series: series.map((s) => ({
      type: 'line' as const,
      name: s.name,
      data: s.values,
      symbol: s.dashed ? 'diamond' : 'circle',
      symbolSize: 7,
      lineStyle: {
        color: s.color,
        width: 2,
        type: s.dashed ? ('dashed' as const) : ('solid' as const),
      },
      itemStyle: { color: s.color },
    })),
  };
}
