'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Single-series bar chart: the card title names the series, so there is no legend. Colors come from the --chart-* variables in globals.css, which follow the theme tokens. */
export function SimpleBarChart({
  data,
  x,
  y,
  label,
  height = 224,
  formatX,
}: {
  data: object[];
  x: string;
  y: string;
  label: string;
  height?: number;
  /** Formats x values, e.g. dates, for the axis and the tooltip title */
  formatX?: (value: string) => string;
}) {
  const t = useTranslations('charts');
  const format = useFormatter();
  if (!data.length)
    return (
      <div className="grid place-items-center text-xs text-fg-secondary" style={{ height }}>
        {t('empty')}
      </div>
    );
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} accessibilityLayer margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey={x}
            tick={{ fontSize: 11, fill: 'var(--chart-ink)' }}
            tickFormatter={formatX}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid)' }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--chart-ink)' }}
            tickFormatter={(value: number) => format.number(value)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--chart-cursor)' }}
            formatter={(value) => [format.number(Number(value)), label]}
            labelFormatter={formatX ? (value) => formatX(String(value)) : undefined}
            contentStyle={{
              background: 'var(--chart-tooltip-bg)',
              border: '1px solid var(--chart-grid)',
              borderRadius: 'var(--app-radius)',
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--chart-ink-strong)' }}
            itemStyle={{ color: 'var(--chart-ink-strong)' }}
          />
          <Bar dataKey={y} name={label} fill="var(--chart-bar)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
