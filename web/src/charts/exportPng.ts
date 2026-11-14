import { downloadDataUrl } from '../lib/download';
import { buildCalendarOption, calendarHeight, type CalendarOptionInput } from './calendarOption';
import { echarts } from './echarts';

const EXPORT_WIDTH = 1000;

/**
 * Render the calendar off-screen at a fixed width, with a title and the data
 * credit drawn into the image, and save it as a PNG.
 */
export async function exportCalendarPng(
  input: Omit<CalendarOptionInput, 'compact' | 'exportInfo'> & {
    exportInfo: NonNullable<CalendarOptionInput['exportInfo']>;
  },
  filename: string,
): Promise<void> {
  const height = calendarHeight(input, true);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${EXPORT_WIDTH}px;height:${height}px;`;
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const chart = echarts.init(host, undefined, {
    renderer: 'canvas',
    width: EXPORT_WIDTH,
    height,
  });
  try {
    chart.setOption(buildCalendarOption({ ...input, compact: false }));
    // Wait one frame so the canvas is painted before it is read back
    // (with a timer as a fallback: background tabs do not get animation frames).
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 150);
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    downloadDataUrl(dataUrl, filename);
  } finally {
    chart.dispose();
    host.remove();
  }
}
