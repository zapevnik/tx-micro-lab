/** Обёртка Apache ECharts: модульный импорт (только нужные части), живое обновление, ресайз. */
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  TitleComponent,
  DatasetComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

echarts.use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, TitleComponent, DatasetComponent, CanvasRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

export interface ChartHandle {
  toPng(): string | null;
}

export const Chart = forwardRef<ChartHandle, { option: ChartOption; className?: string; notMerge?: boolean }>(
  function Chart({ option, className, notMerge }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const inst = useRef<echarts.ECharts | null>(null);

    useImperativeHandle(ref, () => ({
      toPng: () => inst.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#0b1020' }) ?? null,
    }));

    useEffect(() => {
      const chart = echarts.init(el.current!, undefined, { renderer: 'canvas' });
      inst.current = chart;
      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(el.current!);
      return () => {
        ro.disconnect();
        chart.dispose();
        inst.current = null;
      };
    }, []);

    useEffect(() => {
      inst.current?.setOption(option, { notMerge: notMerge ?? false, lazyUpdate: true });
    }, [option, notMerge]);

    return <div ref={el} className={className} />;
  },
);

/** Общая тёмная стилизация графиков. */
export const AXIS_STYLE = {
  axisLine: { lineStyle: { color: '#334155' } },
  axisLabel: { color: '#8b98ad', fontSize: 10 },
  splitLine: { lineStyle: { color: '#1e293b' } },
};

export const BASE_OPTION = {
  backgroundColor: 'transparent',
  animation: false,
  textStyle: { fontFamily: 'Inter, Segoe UI, sans-serif' },
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#141c2f',
    borderColor: '#243049',
    textStyle: { color: '#e2e8f0', fontSize: 11 },
  },
  legend: { top: 0, right: 0, textStyle: { color: '#8b98ad', fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
  grid: { left: 42, right: 10, top: 22, bottom: 20 },
};
