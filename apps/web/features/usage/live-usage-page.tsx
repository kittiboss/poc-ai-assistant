'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card } from 'antd';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Clock3, Radio, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/components/api/api-provider';
import { Shell } from '@/components/layout/shell';
import { StatusTag, usageKindTone } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { queryKeys } from '@/lib/api/query-keys';
import type { LiveUsage } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { ModelUsageList, ModelUsageNote, useModelUsage } from './model-usage';

type LiveRecord = LiveUsage['recent'][number];

export function LiveUsagePage() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  const t = useTranslations('liveUsage');
  const enums = useEnumLabel();
  const format = useFormatter();
  // How many tokens arrived with the last refresh; `at` restarts the badge's animation.
  const [increase, setIncrease] = useState<{ tokens: number; at: number } | null>(null);
  const { data, error } = useQuery({
    queryKey: queryKeys.liveUsage,
    queryFn: async ({ signal }) => {
      const next = unwrap(await client.GET('/api/usage/me/live', { signal, cache: 'no-store' }));
      const previous = queryClient.getQueryData<LiveUsage>(queryKeys.liveUsage)?.totals.totalTokens;
      if (previous !== undefined && next.totals.totalTokens > previous)
        setIncrease({ tokens: next.totals.totalTokens - previous, at: Date.now() });
      return next;
    },
    // The server says how soon to ask again; after an error it retries every 5 seconds.
    refetchInterval: (query) =>
      query.state.status === 'error' ? 5000 : Math.max(1000, query.state.data?.pollAfterMs ?? 5000),
  });
  const modelUsage = useModelUsage(true);
  const usageText = useTranslations('modelUsage');
  const number = (value: number | undefined) => format.number(value ?? 0);
  const inputShare = data?.totals.totalTokens ? (data.totals.inputTokens / data.totals.totalTokens) * 100 : 0;
  const active = Boolean(data?.active.requests);

  return (
    <Shell active="live-usage">
      <div className="relative min-h-full overflow-hidden p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 left-1/4 h-80 w-80 rounded-full bg-info/15 blur-3xl" />
        <div className="relative mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-success-text">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-success" />
                </span>
                {t('eyebrow')}
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight lg:text-4xl">{t('title')}</h1>
              <p className="mt-2 max-w-2xl text-sm text-fg-secondary">{t('intro')}</p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-line-secondary bg-surface/80 px-4 py-2 text-xs text-fg-secondary shadow-sm backdrop-blur">
              <RefreshCw className="animate-spin-slow" size={14} />
              {data
                ? t('synced', { time: format.dateTime(new Date(data.updatedAt), { timeStyle: 'medium' }) })
                : t('connecting')}
            </div>
          </header>

          {error && <Alert type="warning" showIcon title={t('paused', { error: error.message })} />}

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_.65fr]">
            <Card
              className="live-hero relative overflow-hidden border-primary-border bg-linear-to-br from-primary to-primary-active text-on-primary shadow-xl"
              styles={{ body: { padding: 28 } }}
            >
              <div className="absolute top-6 right-6 opacity-15">
                <Sparkles size={110} strokeWidth={1} />
              </div>
              <p className="flex items-center gap-2 text-sm opacity-85">
                <Zap size={16} /> {t('allTime')}
              </p>
              <div className="relative mt-5 flex flex-wrap items-end gap-4">
                <AnimatedNumber
                  value={data?.totals.totalTokens ?? 0}
                  className="text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl"
                />
                {increase && (
                  <span
                    key={increase.at}
                    className="token-increase mb-2 rounded-full bg-on-primary/20 px-3 py-1 text-sm font-semibold"
                  >
                    +{number(increase.tokens)}
                  </span>
                )}
              </div>
              <div className="mt-7 h-2 overflow-hidden rounded-full bg-on-primary/20">
                <div
                  className="h-full rounded-full bg-on-primary/80 transition-[width] duration-700 ease-out"
                  style={{ width: `${inputShare}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs opacity-85">
                <span>{t('input', { count: number(data?.totals.inputTokens) })}</span>
                <span>{t('output', { count: number(data?.totals.outputTokens) })}</span>
                <span>{t('requests', { count: number(data?.totals.requests) })}</span>
              </div>
            </Card>

            <Card
              className={cn(
                'relative overflow-hidden transition duration-500',
                active ? 'border-warning bg-warning-soft shadow-lg' : 'bg-surface/80 backdrop-blur',
              )}
              styles={{ body: { padding: 24 } }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-fg-secondary">{t('inFlight')}</p>
                  <AnimatedNumber
                    value={data?.active.reservedTokens ?? 0}
                    className="mt-3 block text-4xl font-semibold"
                  />
                  <p className="mt-1 text-xs text-fg-secondary">{t('inFlightNote')}</p>
                </div>
                <span
                  className={cn(
                    'grid h-12 w-12 place-items-center rounded-brand-lg',
                    active ? 'token-glow bg-warning text-on-primary' : 'bg-fill-tertiary text-fg-tertiary',
                  )}
                >
                  <Radio size={23} />
                </span>
              </div>
              <div className="mt-8 flex items-center justify-between rounded-brand bg-surface/70 p-3 text-sm">
                <span>{t('activeRequests')}</span>
                <span className="font-semibold">{number(data?.active.requests)}</span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-fg-secondary">{t('reservationNote')}</p>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <LiveMetric icon={<Activity />} label={t('todayRequests')} value={data?.today.requests} tone="primary" />
            <LiveMetric
              icon={<ArrowDownToLine />}
              label={t('todayInput')}
              value={data?.today.inputTokens}
              tone="info"
            />
            <LiveMetric
              icon={<ArrowUpFromLine />}
              label={t('todayOutput')}
              value={data?.today.outputTokens}
              tone="success"
            />
            <LiveMetric icon={<Zap />} label={t('todayTotal')} value={data?.today.totalTokens} tone="warning" />
          </section>

          <Card className="overflow-hidden bg-surface/80 backdrop-blur" styles={{ body: { padding: 0 } }}>
            <div className="border-b border-line-secondary p-5">
              <h2 className="font-semibold">{usageText('title')}</h2>
              <p className="mt-1 text-xs text-fg-secondary">
                <ModelUsageNote usage={modelUsage.data} />
              </p>
            </div>
            <div className="p-5">
              <ModelUsageList usage={modelUsage.data} />
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_.85fr]">
            <Card className="overflow-hidden bg-surface/80 backdrop-blur" styles={{ body: { padding: 0 } }}>
              <div className="border-b border-line-secondary p-5">
                <h2 className="font-semibold">{t('recentTitle')}</h2>
                <p className="mt-1 text-xs text-fg-secondary">{t('recentNote')}</p>
              </div>
              <LiveBars records={data?.recent ?? []} />
            </Card>

            <Card className="overflow-hidden bg-surface/80 backdrop-blur" styles={{ body: { padding: 0 } }}>
              <div className="border-b border-line-secondary p-5">
                <h2 className="font-semibold">{t('feedTitle')}</h2>
                <p className="mt-1 text-xs text-fg-secondary">{t('feedNote')}</p>
              </div>
              <div className="max-h-90 divide-y divide-line-secondary overflow-auto">
                {data?.recent.slice(0, 8).map((record, index) => (
                  <div key={record.id} className={cn('flex items-center gap-3 p-4', index === 0 && 'live-row')}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-brand bg-primary-soft text-primary">
                      <Zap size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium">{record.model.displayName}</p>
                        <StatusTag tone={usageKindTone(record.usageKind)}>
                          {enums.label('usageKind', record.usageKind)}
                        </StatusTag>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-secondary">
                        <Clock3 size={11} />
                        {format.dateTime(new Date(record.createdAt), { timeStyle: 'medium' })} ·{' '}
                        {t('duration', { ms: number(record.durationMs) })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold">+{number(record.totalTokens)}</p>
                      <p className="text-[10px] text-fg-tertiary">
                        {t('split', { input: number(record.inputTokens), output: number(record.outputTokens) })}
                      </p>
                    </div>
                  </div>
                ))}
                {data && !data.recent.length && (
                  <div className="grid h-52 place-items-center text-sm text-fg-secondary">{t('feedEmpty')}</div>
                )}
                {!data && <div className="grid h-52 place-items-center text-sm text-fg-secondary">{t('loading')}</div>}
              </div>
            </Card>
          </section>
        </div>
      </div>
    </Shell>
  );
}

/** Counts up to a new value; jumps straight there when the user prefers less motion. */
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const format = useFormatter();
  const current = useRef(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const from = current.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = still ? 1 : Math.min(1, (now - started) / 650);
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className={className}>{format.number(display)}</span>;
}

const toneClasses = {
  primary: 'bg-primary-soft text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
};

function LiveMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  tone: keyof typeof toneClasses;
}) {
  return (
    <Card className="live-metric bg-surface/80 shadow-sm backdrop-blur" styles={{ body: { padding: 20 } }}>
      <span className={cn('grid h-10 w-10 place-items-center rounded-brand', toneClasses[tone])}>{icon}</span>
      <AnimatedNumber value={value ?? 0} className="mt-5 block text-3xl font-semibold" />
      <p className="mt-1 text-xs text-fg-secondary">{label}</p>
    </Card>
  );
}

function LiveBars({ records }: { records: LiveRecord[] }) {
  const t = useTranslations('liveUsage');
  const format = useFormatter();
  const rows = records.slice(0, 12).reverse();
  const max = Math.max(1, ...rows.map((record) => record.totalTokens));
  return (
    <div className="p-5">
      <div className="flex h-64 items-stretch gap-2" role="img" aria-label={t('chartLabel')}>
        {rows.map((record, index) => {
          const height = Math.max(8, (record.totalTokens / max) * 100);
          const output = record.totalTokens ? (record.outputTokens / record.totalTokens) * 100 : 0;
          return (
            <div
              key={record.id}
              className="group flex h-full min-w-0 flex-1 flex-col items-center"
              title={t('barTitle', { model: record.model.displayName, tokens: format.number(record.totalTokens) })}
            >
              <span className="mb-1 h-4 text-[10px] font-medium opacity-0 transition group-hover:opacity-100">
                {format.number(record.totalTokens)}
              </span>
              <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                <div
                  className="live-token-bar relative w-full max-w-10 overflow-hidden rounded-t-md bg-primary/35 shadow-sm transition-[height] duration-700"
                  style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }}
                >
                  <div className="absolute bottom-0 w-full bg-primary" style={{ height: `${output}%` }} />
                </div>
              </div>
              <span className="mt-2 h-4 max-w-full truncate text-[9px] text-fg-tertiary">
                {format.dateTime(new Date(record.createdAt), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
              </span>
            </div>
          );
        })}
        {!rows.length && (
          <div className="grid h-full w-full place-items-center text-sm text-fg-secondary">{t('noRecords')}</div>
        )}
      </div>
      <div className="mt-4 flex justify-center gap-5 text-[11px] text-fg-secondary">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-primary/35" /> {t('inputLegend')}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-primary" /> {t('outputLegend')}
        </span>
      </div>
    </div>
  );
}
