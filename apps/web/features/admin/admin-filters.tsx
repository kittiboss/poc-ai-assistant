'use client';
import { Button, DatePicker, Drawer, Segmented, Select } from 'antd';
import dayjs from 'dayjs';
import { SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AdminModel } from '@/lib/api/types';
import { providers, type Filters, type Provider } from './admin-queries';

const ranges = ['7d', '30d', 'month', 'custom'] as const;
type Range = (typeof ranges)[number];
const DEFAULT_RANGE: Range = '30d';
const DAY = 'YYYY-MM-DD';

const isRange = (value: string | null): value is Range => ranges.includes(value as Range);
const isProvider = (value: string | null): value is Provider => providers.includes(value as Provider);

/**
 * The overview's filters, kept in the URL so a reload, a shared link or Back shows the same numbers:
 * `?range=7d|month|custom&from=&to=&provider=&model=`. No range means the last 30 days. A preset is
 * kept by name, so a saved link keeps meaning "the last 7 days".
 */
export function useAdminFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rangeParam = params.get('range');
  const providerParam = params.get('provider');
  const range = isRange(rangeParam) ? rangeParam : DEFAULT_RANGE;
  const provider = isProvider(providerParam) ? providerParam : '';
  const modelId = params.get('model') ?? '';
  // Days in the user's time zone, like the date pickers.
  const today = dayjs();
  const start = { '7d': today.subtract(6, 'day'), '30d': today.subtract(29, 'day'), month: today.startOf('month') };
  const from = range === 'custom' ? (params.get('from') ?? '') : start[range].format(DAY);
  const to = range === 'custom' ? (params.get('to') ?? '') : today.format(DAY);
  const filters: Filters = { from, to, provider, modelId };

  const navigate = (next: { range: Range; from: string; to: string; provider: string; modelId: string }) => {
    const query = new URLSearchParams();
    if (next.range !== DEFAULT_RANGE) query.set('range', next.range);
    if (next.range === 'custom' && next.from) query.set('from', next.from);
    if (next.range === 'custom' && next.to) query.set('to', next.to);
    if (next.provider) query.set('provider', next.provider);
    if (next.modelId) query.set('model', next.modelId);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  const current = { range, ...filters };

  return {
    range,
    filters,
    /** Filters changed from the default, counted on the phone's filter button */
    changed: Number(range !== DEFAULT_RANGE) + Number(Boolean(provider)) + Number(Boolean(modelId)),
    // Switching to "Custom" starts from the dates the preset showed.
    setRange: (next: Range) => navigate({ ...current, range: next }),
    // Like AntD's RangePicker, a reversed pair is swapped instead of refused. YYYY-MM-DD sorts as text.
    setDates: (from: string, to: string) =>
      navigate({ ...current, range: 'custom', ...(from && to && from > to ? { from: to, to: from } : { from, to }) }),
    setProvider: (next: string) => navigate({ ...current, provider: next }),
    setModel: (next: string) => navigate({ ...current, modelId: next }),
    reset: () => router.push(pathname, { scroll: false }),
  };
}

type AdminFilters = ReturnType<typeof useAdminFilters>;

/**
 * Sticks to the top of the overview while it scrolls, and filters everything below it. The summary
 * line always says what is shown; on a phone the fields move into a drawer behind one button.
 */
export function FilterBar({ filters, models }: { filters: AdminFilters; models: AdminModel[] }) {
  const t = useTranslations('admin.filters');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const { from, to, provider, modelId } = filters.filters;
  const date = (day: string) => new Date(`${day}T00:00:00`);
  const period =
    from && to
      ? format.dateTimeRange(date(from), date(to), { dateStyle: 'medium' })
      : from
        ? t('since', { date: format.dateTime(date(from), { dateStyle: 'medium' }) })
        : to
          ? t('until', { date: format.dateTime(date(to), { dateStyle: 'medium' }) })
          : t('allTime');
  const summary = t('summary', {
    period,
    provider: provider || t('allProviders'),
    model: models.find((model) => model.id === modelId)?.displayName ?? (modelId || t('allModels')),
  });
  const reset = filters.changed > 0 && (
    <Button type="text" onClick={filters.reset}>
      {t('reset')}
    </Button>
  );

  return (
    <div className="sticky top-0 z-10 -mx-4 bg-layout px-4 py-3 md:-mx-8 md:px-8">
      <div className="rounded-brand-lg border border-line-secondary bg-surface p-4 shadow-sm">
        <div className="hidden flex-wrap items-end gap-3 md:flex">
          <FilterFields filters={filters} models={models} />
        </div>
        <div className="flex items-center gap-3 md:mt-3">
          <p className="min-w-0 flex-1 text-xs text-fg-secondary">{summary}</p>
          <div className="hidden md:block">{reset}</div>
          <Button className="md:hidden" icon={<SlidersHorizontal size={16} />} onClick={() => setOpen(true)}>
            {filters.changed ? t('buttonCount', { count: filters.changed }) : t('button')}
          </Button>
        </div>
      </div>
      <Drawer
        placement="bottom"
        size="auto"
        title={t('title')}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <div className="flex justify-end gap-2 pb-[env(safe-area-inset-bottom)]">
            {reset}
            <Button type="primary" onClick={() => setOpen(false)}>
              {t('done')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <FilterFields filters={filters} models={models} stacked />
        </div>
      </Drawer>
    </div>
  );
}

function FilterFields({
  filters,
  models,
  stacked = false,
}: {
  filters: AdminFilters;
  models: AdminModel[];
  stacked?: boolean;
}) {
  const t = useTranslations('admin.filters');
  const { from, to, provider, modelId } = filters.filters;
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-secondary">{t('range')}</span>
        <Segmented<Range>
          aria-label={t('range')}
          block={stacked}
          value={filters.range}
          onChange={filters.setRange}
          options={ranges.map((range) => ({ value: range, label: t(`ranges.${range}`) }))}
        />
      </div>
      {filters.range === 'custom' && (
        <>
          <Field label={t('from')}>
            <DatePicker
              className="w-full"
              value={from ? dayjs(from) : null}
              onChange={(day) => filters.setDates(day?.format(DAY) ?? '', to)}
            />
          </Field>
          <Field label={t('to')}>
            <DatePicker
              className="w-full"
              value={to ? dayjs(to) : null}
              onChange={(day) => filters.setDates(from, day?.format(DAY) ?? '')}
            />
          </Field>
        </>
      )}
      <Field label={t('provider')}>
        <Select
          className="w-full min-w-44"
          value={provider}
          onChange={filters.setProvider}
          options={[
            { value: '', label: t('allProviders') },
            ...providers.map((name) => ({ value: name, label: name })),
          ]}
        />
      </Field>
      <Field label={t('model')}>
        <Select
          className="w-full min-w-44"
          value={modelId}
          onChange={filters.setModel}
          options={[
            { value: '', label: t('allModels') },
            ...models.map((model) => ({ value: model.id, label: model.displayName })),
          ]}
        />
      </Field>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}
