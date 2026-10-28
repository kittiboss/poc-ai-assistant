'use client';
import { Alert, Progress, Table, type TableColumnsType } from 'antd';
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Coins, ShieldAlert, Users, Wallet, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SimpleBarChart } from '@/components/ui/charts';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag, usageKindTone } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { AdminSummary, CreditStatus } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { runtimeConfig } from '@/lib/runtime-config';
import { FilterBar, useAdminFilters } from './admin-filters';
import { useAdminCredit, useAdminModels, useAdminSummary } from './admin-queries';
import { useAdminFormat } from './use-admin-format';
import { ValueTile } from './value-tile';

type ModelBreakdown = AdminSummary['byModel'][number];

/**
 * What is happening right now, then the usage report. The filters sit between the two and apply to
 * everything below them.
 */
export function OverviewTab() {
  const t = useTranslations('admin');
  const vendor = runtimeConfig().vendorManaged;
  const enums = useEnumLabel();
  const { money, number, day } = useAdminFormat();
  const filters = useAdminFilters();
  // The summary query follows the filters, so changing them is enough to reload it.
  const summaryQuery = useAdminSummary(filters.filters);
  const modelsQuery = useAdminModels();
  const credit = useAdminCredit();
  const summary = summaryQuery.data;
  const loadError = [summaryQuery, modelsQuery, credit].find((query) => query.error)?.error?.message;
  // Today's external-provider ceiling comes with the summary but does not depend on its filters.
  const guard = summary?.externalToday;
  const creditStatus = credit.data?.vendorManaged ? credit.data : undefined;
  const costs = summary?.costs;

  const breakdownColumns: TableColumnsType<ModelBreakdown> = [
    {
      key: 'model',
      title: t('breakdown.model'),
      render: (_, row) => <span className="font-medium">{row.displayName}</span>,
    },
    { key: 'requests', title: t('breakdown.requests'), render: (_, row) => number(row._count) },
    { key: 'tokens', title: t('breakdown.tokens'), render: (_, row) => number(row._sum.totalTokens) },
    ...(['actualProviderCost', 'customerCharge', 'simulatedProviderCost', 'simulatedCustomerCharge'] as const)
      .filter((field) => !vendor || field === 'simulatedCustomerCharge')
      .map((field) => ({
        key: field,
        title: t(`breakdown.${field}`),
        className: 'whitespace-nowrap',
        render: (_: unknown, row: ModelBreakdown) => (
          <span className="font-mono text-xs">{money(row._sum[field])}</span>
        ),
      })),
  ];

  return (
    <>
      {loadError && <Alert type="error" showIcon title={loadError} />}

      {(creditStatus || guard) && (
        <section aria-labelledby="admin-status" className="space-y-3">
          <h2 id="admin-status" className="text-sm font-semibold">
            {t('status.title')} <span className="font-normal text-fg-secondary">· {t('status.note')}</span>
          </h2>
          <div className={cn('grid gap-4', creditStatus && guard && 'xl:grid-cols-2')}>
            {creditStatus && <CreditCard status={creditStatus} />}
            {guard && (
              <SectionCard>
                <div className="flex flex-wrap items-center gap-4">
                  <ShieldAlert className="text-warning" />
                  <div className="min-w-60 flex-1">
                    <h3 className="font-semibold">{t('guard.title')}</h3>
                    <p className="text-xs text-fg-secondary">{t('guard.description')}</p>
                  </div>
                  <GuardMeter label={t('guard.requests')} used={guard.used.requests} limit={guard.limits.requests} />
                  <GuardMeter label={t('guard.tokens')} used={guard.used.tokens} limit={guard.limits.tokens} />
                </div>
              </SectionCard>
            )}
          </div>
        </section>
      )}

      <section aria-label={t('report')} className="space-y-6">
        <FilterBar filters={filters} models={modelsQuery.data ?? []} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard icon={<Users />} label={t('metrics.activeUsers')} value={number(summary?.activeUsers)} />
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
          {!vendor && (
            <MetricCard
              icon={<Coins />}
              label={t('metrics.actualProviderCost')}
              value={money(costs?.actualProviderCost)}
            />
          )}
          {!vendor && (
            <MetricCard
              icon={<BarChart3 />}
              label={t('metrics.simulatedCost')}
              value={money(costs?.simulatedProviderCost)}
            />
          )}
        </div>

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
          {!vendor && (
            <SectionCard title={t('snapshot.title')}>
              <div className="grid grid-cols-2 gap-4">
                <ValueTile label={t('snapshot.actualExternalCost')} value={money(costs?.actualProviderCost)} />
                <ValueTile label={t('snapshot.customerCharge')} value={money(costs?.customerCharge)} />
                <ValueTile label={t('snapshot.simulatedProviderCost')} value={money(costs?.simulatedProviderCost)} />
                <ValueTile
                  label={t('snapshot.simulatedCustomerCharge')}
                  value={money(costs?.simulatedCustomerCharge)}
                />
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
          )}
        </div>

        <SectionCard flush title={t('breakdown.title')} description={t('breakdown.note')}>
          <Table<ModelBreakdown>
            rowKey="modelId"
            columns={breakdownColumns}
            dataSource={summary?.byModel}
            loading={summaryQuery.isPending}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </SectionCard>
      </section>
    </>
  );
}

/** The organization's prepaid credit on the platform gateway; AI requests stop when it runs out. */
function CreditCard({ status }: { status: CreditStatus }) {
  const t = useTranslations('admin.credit');
  const { money } = useAdminFormat();
  const credit = status.credit;
  const ratio = credit?.limit ? Math.min(1, credit.spent / credit.limit) : 1;
  return (
    <SectionCard>
      <div className="flex flex-wrap items-center gap-4">
        <Wallet className="text-primary" />
        <div className="min-w-60 flex-1">
          <h3 className="font-semibold">{t('title')}</h3>
          <p className="text-xs text-fg-secondary">{t('description')}</p>
        </div>
        {credit ? (
          <div className="w-64">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-fg-secondary">{t('remaining')}</span>
              <span className="font-mono text-lg font-semibold">{money(credit.remaining)}</span>
            </div>
            <Progress
              percent={ratio * 100}
              showInfo={false}
              size="small"
              status={credit.exhausted ? 'exception' : 'normal'}
              strokeColor={
                credit.exhausted ? undefined : ratio >= 0.8 ? 'var(--app-color-warning)' : 'var(--app-color-primary)'
              }
            />
            <p className="text-[11px] text-fg-secondary">
              {t('spentOf', { spent: money(credit.spent), limit: money(credit.limit) })}
            </p>
          </div>
        ) : (
          <p className="text-xs text-fg-secondary">{t('unavailable')}</p>
        )}
      </div>
      {credit?.exhausted && <Alert className="mt-4" type="error" showIcon message={t('exhausted')} />}
    </SectionCard>
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
