/** ECharts with only the pieces this app uses (keeps the bundle small). */
import { CustomChart, HeatmapChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  HeatmapChart,
  LineChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  GraphicComponent,
  AriaComponent,
  CanvasRenderer,
]);

export { echarts };
export type { EChartsOption, EChartsType } from 'echarts';

export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
