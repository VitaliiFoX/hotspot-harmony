import { useId } from "react";

/** An id for the gradient of one chart, safe inside `url(#...)`: two charts on a page must not share one. */
export function useHeatId(): string {
  return `heat-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** The paint of a mark that takes the chart's gradient. */
export function heatPaint(id: string): string {
  return `url(#${id})`;
}

type Props = {
  id: string;
  /** Where the gradient starts, in the chart's own pixels: the baseline, the coolest end. */
  from: number;
  /** Where it ends: the top of the tallest mark, the hottest end. */
  to: number;
};

/**
 * The warm middle of the thermal ramp as the paint of a chart's marks: coral at the baseline, orange halfway,
 * amber at the top of the tallest mark. It runs over the chart, not over each mark, so a mark is as hot as it is
 * tall, the way a month of the calendar is as hot as it burned. The stops take their colours from `--heat-0` to
 * `--heat-2` (styles.css), so they follow the theme.
 */
export function HeatGradient({ id, from, to }: Props) {
  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={from} x2={0} y2={to}>
        <stop offset="0" className="heat-stop-0" />
        <stop offset="0.5" className="heat-stop-1" />
        <stop offset="1" className="heat-stop-2" />
      </linearGradient>
    </defs>
  );
}
