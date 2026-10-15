'use client';

import { Activity, ArrowDownToLine, ArrowUpFromLine, Clock3, Radio, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { Badge, Card } from '@/components/ui/primitives';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';

type Totals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
type LiveRecord = {
  id: string;
  requestId: string;
  modelId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  status: string;
  usageKind: 'ACTUAL' | 'ESTIMATED' | 'SYNTHETIC';
  createdAt: string;
  model: { displayName: string };
};
type LiveUsage = {
  updatedAt: string;
  pollAfterMs: number;
  totals: Totals;
  today: Totals;
  active: { requests: number; reservedTokens: number };
  recent: LiveRecord[];
};

const format = (value: number) => new Intl.NumberFormat().format(value);

export function LiveUsagePage() {
  const api = useApi();
  const [data, setData] = useState<LiveUsage>();
  const [error, setError] = useState('');
  const [increase, setIncrease] = useState(0);
  const previousTotal = useRef<number | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let increaseTimer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const next = await api.request<LiveUsage>('/usage/me/live', {
          cache: 'no-store',
        });
        if (stopped) return;
        if (previousTotal.current !== undefined && next.totals.totalTokens > previousTotal.current) {
          setIncrease(next.totals.totalTokens - previousTotal.current);
          clearTimeout(increaseTimer);
          increaseTimer = setTimeout(() => setIncrease(0), 2400);
        }
        previousTotal.current = next.totals.totalTokens;
        setData(next);
        setError('');
        timer = setTimeout(update, Math.max(1000, next.pollAfterMs));
      } catch (cause) {
        if (stopped) return;
        setError((cause as Error).message);
        timer = setTimeout(update, 5000);
      }
    };
    void update();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(increaseTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const inputShare = data?.totals.totalTokens ? (data.totals.inputTokens / data.totals.totalTokens) * 100 : 0;
  return (
    <Shell active="live-usage">
      <div className="relative min-h-full overflow-hidden p-6 lg:p-8">
        <div className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-violet-300/20 blur-3xl dark:bg-violet-700/10" />
        <div className="pointer-events-none absolute -bottom-36 left-1/4 h-80 w-80 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-700/10" />
        <div className="relative mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </span>
                LIVE TOKEN METER
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight lg:text-4xl">Token usage in real time</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">
                Completed usage refreshes automatically. In-flight reservations are shown separately until the response
                settles.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-xs text-slate-500 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
              <RefreshCw className="animate-spin-slow" size={14} />
              {data ? `Synced ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Connecting…'}
            </div>
          </header>

          {error && (
            <Card className="border-red-200 p-4 text-sm text-red-600 dark:border-red-900">
              Live update paused: {error}. Retrying automatically.
            </Card>
          )}

          <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
            <Card className="live-hero relative overflow-hidden border-violet-200 bg-gradient-to-br from-violet-600 via-indigo-600 to-slate-900 p-6 text-white shadow-xl shadow-violet-500/10 lg:p-8 dark:border-violet-900">
              <div className="absolute top-6 right-6 opacity-15">
                <Sparkles size={110} strokeWidth={1} />
              </div>
              <p className="flex items-center gap-2 text-sm text-violet-100">
                <Zap size={16} /> All-time completed tokens
              </p>
              <div className="relative mt-5 flex flex-wrap items-end gap-4">
                <AnimatedNumber
                  value={data?.totals.totalTokens || 0}
                  className="text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl"
                />
                {increase > 0 && (
                  <span className="token-increase mb-2 rounded-full bg-emerald-400/20 px-3 py-1 text-sm font-semibold text-emerald-200">
                    +{format(increase)}
                  </span>
                )}
              </div>
              <div className="mt-7 h-2 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 transition-[width] duration-700 ease-out"
                  style={{ width: `${inputShare}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-violet-100">
                <span>{format(data?.totals.inputTokens || 0)} input</span>
                <span>{format(data?.totals.outputTokens || 0)} output</span>
                <span>{format(data?.totals.requests || 0)} requests</span>
              </div>
            </Card>

            <Card
              className={cn(
                'relative overflow-hidden p-6 transition duration-500',
                data?.active.requests
                  ? 'border-amber-300 bg-amber-50/80 shadow-lg shadow-amber-500/10 dark:border-amber-800 dark:bg-amber-950/30'
                  : 'bg-white/80 backdrop-blur dark:bg-slate-900/80',
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">In-flight reservation</p>
                  <AnimatedNumber
                    value={data?.active.reservedTokens || 0}
                    className="mt-3 block text-4xl font-semibold"
                  />
                  <p className="mt-1 text-xs text-slate-500">conservative maximum tokens</p>
                </div>
                <span
                  className={cn(
                    'grid h-12 w-12 place-items-center rounded-2xl',
                    data?.active.requests
                      ? 'token-glow bg-amber-200 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                      : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
                  )}
                >
                  <Radio size={23} />
                </span>
              </div>
              <div className="mt-8 flex items-center justify-between rounded-xl bg-white/70 p-3 text-sm dark:bg-slate-950/50">
                <span>Active requests</span>
                <span className="font-semibold">{data?.active.requests || 0}</span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                Reservations protect quotas while generation is running. They are removed and replaced by actual,
                estimated, or synthetic usage when the request finishes.
              </p>
            </Card>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <LiveMetric
              icon={<Activity />}
              label="Requests today (UTC)"
              value={data?.today.requests || 0}
              tone="violet"
            />
            <LiveMetric
              icon={<ArrowDownToLine />}
              label="Input tokens today"
              value={data?.today.inputTokens || 0}
              tone="cyan"
            />
            <LiveMetric
              icon={<ArrowUpFromLine />}
              label="Output tokens today"
              value={data?.today.outputTokens || 0}
              tone="emerald"
            />
            <LiveMetric icon={<Zap />} label="Total tokens today" value={data?.today.totalTokens || 0} tone="amber" />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1fr_.85fr]">
            <Card className="overflow-hidden bg-white/80 backdrop-blur dark:bg-slate-900/80">
              <div className="border-b border-slate-200 p-5 dark:border-slate-800">
                <h2 className="font-semibold">Recent token activity</h2>
                <p className="mt-1 text-xs text-slate-500">Latest completed requests · input and output stacked</p>
              </div>
              <LiveBars records={data?.recent || []} />
            </Card>

            <Card className="overflow-hidden bg-white/80 backdrop-blur dark:bg-slate-900/80">
              <div className="border-b border-slate-200 p-5 dark:border-slate-800">
                <h2 className="font-semibold">Live request feed</h2>
                <p className="mt-1 text-xs text-slate-500">No prompt or response content is exposed here</p>
              </div>
              <div className="max-h-[360px] divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
                {data?.recent.slice(0, 8).map((record, index) => (
                  <div key={record.id} className={cn('flex items-center gap-3 p-4', index === 0 && 'live-row')}>
                    <span className="text-brand grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 dark:bg-violet-950">
                      <Zap size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{record.model.displayName}</p>
                        <Badge tone={tone(record.usageKind)}>{record.usageKind}</Badge>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                        <Clock3 size={11} />
                        {new Date(record.createdAt).toLocaleTimeString()} · {record.durationMs} ms
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold">+{format(record.totalTokens)}</p>
                      <p className="text-[10px] text-slate-400">
                        {record.inputTokens} in / {record.outputTokens} out
                      </p>
                    </div>
                  </div>
                ))}
                {data && !data.recent.length && (
                  <div className="grid h-52 place-items-center text-sm text-slate-500">
                    Send a chat message to see token activity.
                  </div>
                )}
                {!data && (
                  <div className="grid h-52 place-items-center text-sm text-slate-500">Loading live activity…</div>
                )}
              </div>
            </Card>
          </section>
        </div>
      </div>
    </Shell>
  );
}

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const current = useRef(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const from = current.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 650);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (value - from) * eased);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className={className}>{format(display)}</span>;
}

function LiveMetric({
  icon,
  label,
  value,
  tone: color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'violet' | 'cyan' | 'emerald' | 'amber';
}) {
  const styles = {
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300',
    cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
  };
  return (
    <Card className="live-metric bg-white/80 p-5 backdrop-blur dark:bg-slate-900/80">
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', styles[color])}>{icon}</span>
      <AnimatedNumber value={value} className="mt-5 block text-3xl font-semibold" />
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </Card>
  );
}

function LiveBars({ records }: { records: LiveRecord[] }) {
  const rows = records.slice(0, 12).reverse();
  const max = Math.max(1, ...rows.map((record) => record.totalTokens));
  return (
    <div className="p-5">
      <div className="flex h-64 items-stretch gap-2" aria-label="Recent token activity chart">
        {rows.map((record, index) => {
          const height = Math.max(8, (record.totalTokens / max) * 100);
          const output = record.totalTokens ? (record.outputTokens / record.totalTokens) * 100 : 0;
          return (
            <div
              key={record.id}
              className="group flex h-full min-w-0 flex-1 flex-col items-center"
              title={`${record.model.displayName}: ${record.totalTokens} tokens`}
            >
              <span className="mb-1 h-4 text-[10px] font-medium opacity-0 transition group-hover:opacity-100">
                {format(record.totalTokens)}
              </span>
              <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                <div
                  className="live-token-bar relative w-full max-w-10 overflow-hidden rounded-t-md bg-cyan-400 shadow-sm transition-[height] duration-700"
                  style={{
                    height: `${height}%`,
                    animationDelay: `${index * 45}ms`,
                  }}
                >
                  <div className="absolute bottom-0 w-full bg-violet-500" style={{ height: `${output}%` }} />
                </div>
              </div>
              <span className="mt-2 h-4 max-w-full truncate text-[9px] text-slate-400">
                {new Date(record.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </span>
            </div>
          );
        })}
        {!rows.length && (
          <div className="grid h-full w-full place-items-center text-sm text-slate-500">No completed requests yet</div>
        )}
      </div>
      <div className="mt-4 flex justify-center gap-5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-cyan-400" /> Input
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> Output
        </span>
      </div>
    </div>
  );
}

function tone(kind: LiveRecord['usageKind']): 'success' | 'primary' | 'warning' {
  return kind === 'ACTUAL' ? 'success' : kind === 'SYNTHETIC' ? 'primary' : 'warning';
}
