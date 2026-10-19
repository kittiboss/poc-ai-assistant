'use client';
import { Alert, Button, DatePicker, Progress, Select, Table, type TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Coins, ShieldAlert, Users, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { SimpleBarChart } from '@/components/ui/charts';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag, usageKindTone } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { AdminSummary } from '@/lib/api/types';
import { providers, useAdminData, type Filters } from './admin-queries';
import { AuditLog } from './audit-log';
import { ModelRegistry } from './model-registry';
import { PricingSection } from './pricing-section';
import { useAdminFormat } from './use-admin-format';
import { UserPermissions } from './user-permissions';
import { ValueTile } from './value-tile';
import { WorkspaceControls } from './workspace-controls';

type ModelBreakdown = AdminSummary['byModel'][number];

const noFilters: Filters = { from: '', to: '', provider: '', modelId: '' };

export function AdminDashboard() {
  const t = useTranslations('admin');
  const enums = useEnumLabel();
  const { money, number, day } = useAdminFormat();
  const [filters, setFilters] = useState<Filters>(noFilters);
  // The summary query follows the filters, so changing them is enough to reload it.
  const data = useAdminData(filters);
  const summary = data.summary.data;
  const models = data.models.data ?? [];
  const loadError = Object.values(data).find((query) => query.error)?.error?.message;
  const guard = summary?.externalToday;
  const costs = summary?.costs;
  // Like AntD's RangePicker, a reversed pair is swapped instead of refused. YYYY-MM-DD sorts as text.
  const setDates = (from: string, to: string) =>
    setFilters({ ...filters, ...(from && to && from > to ? { from: to, to: from } : { from, to }) });

  const breakdownColumns: TableColumnsType<ModelBreakdown> = [
    {
      key: 'model',
      title: t('breakdown.model'),
      render: (_, row) => <span className="font-medium">{row.displayName}</span>,
    },
    { key: 'requests', title: t('breakdown.requests'), render: (_, row) => number(row._count) },
    { key: 'tokens', title: t('breakdown.tokens'), render: (_, row) => number(row._sum.totalTokens) },
    ...(['actualProviderCost', 'customerCharge', 'simulatedProviderCost', 'simulatedCustomerCharge'] as const).map(
      (field) => ({
        key: field,
        title: t(`breakdown.${field}`),
        className: 'whitespace-nowrap',
        render: (_: unknown, row: ModelBreakdown) => (
          <span className="font-mono text-xs">{money(row._sum[field])}</span>
        ),
      }),
    ),
  ];

  return (
    <Shell active="admin">
      <div className="mx-auto max-w-7xl space-y-7 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div>
          <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
        </div>
        {loadError && <Alert type="error" showIcon title={loadError} />}

        <SectionCard>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('filters.from')}>
              <DatePicker
                value={filters.from ? dayjs(filters.from) : null}
                onChange={(date) => setDates(date?.format('YYYY-MM-DD') ?? '', filters.to)}
              />
            </Field>
            <Field label={t('filters.to')}>
              <DatePicker
                value={filters.to ? dayjs(filters.to) : null}
                onChange={(date) => setDates(filters.from, date?.format('YYYY-MM-DD') ?? '')}
              />
            </Field>
            <Field label={t('filters.provider')}>
              <Select
                className="min-w-44"
                value={filters.provider}
                onChange={(provider) => setFilters({ ...filters, provider })}
                options={[
                  { value: '', label: t('filters.allProviders') },
                  ...providers.map((provider) => ({ value: provider, label: provider })),
                ]}
              />
            </Field>
            <Field label={t('filters.model')}>
              <Select
                className="min-w-44"
                value={filters.modelId}
                onChange={(modelId) => setFilters({ ...filters, modelId })}
                options={[
                  { value: '', label: t('filters.allModels') },
                  ...models.map((model) => ({ value: model.id, label: model.displayName })),
                ]}
              />
            </Field>
            <Button type="text" onClick={() => setFilters(noFilters)}>
              {t('filters.reset')}
            </Button>
            <p className="ml-auto text-xs text-fg-secondary">{t('filters.note')}</p>
          </div>
        </SectionCard>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            icon={<Users />}
            label={t('metrics.users', { active: number(summary?.activeUsers) })}
            value={number(summary?.users)}
          />
          <MetricCard icon={<Zap />} label={t('metrics.requests')} value={number(summary?.requests)} />
          <MetricCard
            icon={<ArrowDownToLine />}
            label={t('metrics.inputTokens')}
            value={number(summary?.tokens.inputTokens)}
          />
          <MetricCard
            icon={<ArrowUpFromLine />}
            label={t('metrics.outputTokens')}
            value={number(summary?.tokens.outputTokens)}
          />
          <MetricCard
            icon={<Coins />}
            label={t('metrics.actualProviderCost')}
            value={money(costs?.actualProviderCost)}
          />
          <MetricCard
            icon={<BarChart3 />}
            label={t('metrics.simulatedCost')}
            value={money(costs?.simulatedProviderCost)}
          />
        </div>

        {guard && (
          <SectionCard>
            <div className="flex flex-wrap items-center gap-4">
              <ShieldAlert className="text-warning" />
              <div className="min-w-60 flex-1">
                <h2 className="font-semibold">{t('guard.title')}</h2>
                <p className="text-xs text-fg-secondary">{t('guard.description')}</p>
              </div>
              <GuardMeter label={t('guard.requests')} used={guard.used.requests} limit={guard.limits.requests} />
              <GuardMeter label={t('guard.tokens')} used={guard.used.tokens} limit={guard.limits.tokens} />
            </div>
          </SectionCard>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title={t('charts.perDay')} description={t('charts.perDayNote')}>
            <SimpleBarChart
              data={summary?.daily || []}
              x="day"
              y="requests"
              label={t('charts.requests')}
              formatX={day}
            />
          </SectionCard>
          <SectionCard title={t('charts.byProvider')} description={t('charts.byProviderNote')}>
            <SimpleBarChart data={summary?.byProvider || []} x="provider" y="_count" label={t('charts.requests')} />
          </SectionCard>
          <SectionCard title={t('charts.byModel')} description={t('charts.byModelNote')}>
            <SimpleBarChart data={summary?.byModel || []} x="displayName" y="_count" label={t('charts.requests')} />
          </SectionCard>
          <SectionCard title={t('snapshot.title')}>
            <div className="grid grid-cols-2 gap-4">
              <ValueTile label={t('snapshot.actualExternalCost')} value={money(costs?.actualProviderCost)} />
              <ValueTile label={t('snapshot.customerCharge')} value={money(costs?.customerCharge)} />
              <ValueTile label={t('snapshot.simulatedProviderCost')} value={money(costs?.simulatedProviderCost)} />
              <ValueTile label={t('snapshot.simulatedCustomerCharge')} value={money(costs?.simulatedCustomerCharge)} />
              <ValueTile
                label={t('snapshot.actualMargin')}
                value={money(Number(costs?.customerCharge || 0) - Number(costs?.actualProviderCost || 0))}
              />
              <ValueTile
                label={t('snapshot.simulatedMargin')}
                value={money(Number(costs?.simulatedCustomerCharge || 0) - Number(costs?.simulatedProviderCost || 0))}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {summary?.byKind.map((kind) => (
                <StatusTag key={kind.usageKind} tone={usageKindTone(kind.usageKind)}>
                  {t('snapshot.kind', {
                    kind: enums.label('usageKind', kind.usageKind),
                    requests: number(kind._count),
                    tokens: number(kind._sum.totalTokens),
                  })}
                </StatusTag>
              ))}
            </div>
            <p className="mt-4 text-xs text-fg-secondary">{t('snapshot.note')}</p>
          </SectionCard>
        </div>

        <SectionCard flush title={t('breakdown.title')} description={t('breakdown.note')}>
          <Table<ModelBreakdown>
            rowKey="modelId"
            columns={breakdownColumns}
            dataSource={summary?.byModel}
            loading={data.summary.isPending}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </SectionCard>

        <ModelRegistry models={models} loading={data.models.isPending} />
        <PricingSection models={models} pricing={data.pricing.data ?? []} loading={data.pricing.isPending} />
        <UserPermissions users={data.users.data ?? []} models={models} loading={data.users.isPending} />
        <AuditLog entries={data.audit.data ?? []} loading={data.audit.isPending} />
        <WorkspaceControls models={models} />
      </div>
    </Shell>
  );
}

function GuardMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const t = useTranslations('admin.guard');
  const { number } = useAdminFormat();
  const ratio = limit ? Math.min(1, used / limit) : 1;
  return (
    <div className="w-48">
      <div className="flex justify-between text-xs">
        <span className="text-fg-secondary">{label}</span>
        <span className="font-mono">
          {number(used)} / {number(limit)}
        </span>
      </div>
      <Progress
        percent={ratio * 100}
        showInfo={false}
        size="small"
        status={ratio >= 1 ? 'exception' : 'normal'}
        strokeColor={ratio >= 1 ? undefined : ratio >= 0.8 ? 'var(--app-color-warning)' : 'var(--app-color-success)'}
      />
      {ratio >= 1 && <p className="text-[11px] text-error">{t('reached')}</p>}
    </div>
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
