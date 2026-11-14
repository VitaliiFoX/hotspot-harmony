import { useEffect, useRef } from 'react';
import { echarts, type EChartsOption, type EChartsType } from '../charts/echarts';

interface EChartProps {
  option: EChartsOption;
  height: number;
  /** Text alternative for screen readers. */
  label: string;
  /** Called with the chart instance once it exists, and with null when it is gone. */
  onChart?: (chart: EChartsType | null) => void;
}

/** Thin React wrapper around one ECharts instance. */
export function EChart({ option, height, label, onChart }: EChartProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const onChartRef = useRef(onChart);

  useEffect(() => {
    onChartRef.current = onChart;
  }, [onChart]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    onChartRef.current?.(chart);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      onChartRef.current?.(null);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    chartRef.current?.resize();
  }, [height]);

  return (
    <div ref={elementRef} className="chart" role="img" aria-label={label} style={{ height }} />
  );
}
