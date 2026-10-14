'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Single-series bar chart: the card title names the series, so there is no legend. Colors come from theme tokens in globals.css. */
export function SimpleBarChart({ data, x, y, label, height = 224 }: { data: object[]; x: string; y: string; label: string; height?: number }) {
  if (!data.length) return <div className="grid place-items-center text-xs text-slate-500" style={{ height }}>No usage in this range</div>;
  return <div style={{ height }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} accessibilityLayer margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)"/>
    <XAxis dataKey={x} tick={{ fontSize: 11, fill: 'var(--chart-ink)' }} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }}/>
    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--chart-ink)' }} tickLine={false} axisLine={false}/>
    <Tooltip cursor={{ fill: 'var(--chart-cursor)' }} formatter={(value) => [Number(value).toLocaleString(), label]} contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-grid)', borderRadius: 10, fontSize: 12 }} labelStyle={{ color: 'var(--chart-ink-strong)' }} itemStyle={{ color: 'var(--chart-ink-strong)' }}/>
    <Bar dataKey={y} name={label} fill="var(--chart-bar)" radius={[4, 4, 0, 0]} maxBarSize={48}/>
  </BarChart></ResponsiveContainer></div>;
}
