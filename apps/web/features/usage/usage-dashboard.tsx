'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Table, type TableColumnsType } from 'antd';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Coins, Database, Hash, Timer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useApi } from '@/components/api/api-provider';
import { Shell } from '@/components/layout/shell';
import { SimpleBarChart } from '@/components/ui/charts';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag, usageKindTone } from '@/components/ui/status-tag';
import { costFormat, dateTimeFormat } from '@/i18n/formats';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { queryKeys } from '@/lib/api/query-keys';
import type { MyUsage } from '@/lib/api/types';

type UsageRecord = MyUsage['records'][number];

export function UsageDashboard() {
  const { client, unwrap } = useApi();
  const t = useTranslations('usage');
  const enums = useEnumLabel();
  const format = useFormatter();
  const money = (value: unknown, currency = 'USD') => format.number(Number(value || 0), costFormat(currency, 4, 8));
  const number = (value: unknown) => format.number(Number(value || 0));
  const { data, error, isPending } = useQuery<MyUsage>({
    queryKey: queryKeys.myUsage,
    queryFn: async ({ signal }) => unwrap(await client.GET('/api/usage/me', { signal })),
  });
  const totals: Partial<MyUsage['totals']['_sum']> = data?.totals._sum ?? {};

  const columns: TableColumnsType<UsageRecord> = [
    {
      key: 'time',
      title: t('columns.time'),
      render: (_, record) => format.dateTime(new Date(record.createdAt), dateTimeFormat),
      className: 'whitespace-nowrap',
    },
    {
      key: 'model',
      title: t('columns.model'),
      render: (_, record) => <span className="font-medium">{record.model.displayName}</span>,
    },
    { key: 'provider', title: t('columns.provider'), dataIndex: 'provider' },
    {
      key: 'tokens',
      title: t('columns.tokens'),
      className: 'whitespace-nowrap',
      render: (_, record) => (
        <>
          {number(record.totalTokens)}{' '}
          <span className="text-xs text-fg-tertiary">
            {t('tokenSplit', { input: number(record.inputTokens), output: number(record.outputTokens) })}
          </span>
        </>
      ),
    },
    {
      key: 'duration',
      title: t('columns.duration'),
      className: 'whitespace-nowrap',
      render: (_, record) => (
        <>
          <Timer className="mr-1 inline" size={13} />
          {format.number(record.durationMs, { style: 'unit', unit: 'millisecond' })}
        </>
      ),
    },
    {
      key: 'usage',
      title: t('columns.usage'),
      render: (_, record) => (
        <StatusTag tone={usageKindTone(record.usageKind)}>{enums.label('usageKind', record.usageKind)}</StatusTag>
      ),
    },
    { key: 'status', title: t('columns.status'), render: (_, record) => enums.label('requestStatus', record.status) },
    {
      key: 'actualCost',
      title: t('columns.actualCost'),
      className: 'whitespace-nowrap',
      render: (_, record) => money(record.actualProviderCost, record.currency),
    },
    {
      key: 'simulatedCost',
      title: t('columns.simulatedCost'),
      className: 'whitespace-nowrap',
      render: (_, record) => money(record.simulatedProviderCost, record.currency),
    },
  ];

  return (
    <Shell active="usage">
      <div className="mx-auto max-w-7xl space-y-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div>
          <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
        </div>
        {error && <Alert type="error" showIcon title={error.message} />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard icon={<Activity />} label={t('requests')} value={number(data?.totals._count)} />
          <MetricCard icon={<ArrowDownToLine />} label={t('inputTokens')} value={number(totals.inputTokens)} />
          <MetricCard icon={<ArrowUpFromLine />} label={t('outputTokens')} value={number(totals.outputTokens)} />
          <MetricCard icon={<Hash />} label={t('totalTokens')} value={number(totals.totalTokens)} />
          <MetricCard icon={<Database />} label={t('actualCost')} value={money(totals.actualProviderCost)} />
          <MetricCard icon={<Coins />} label={t('simulatedCost')} value={money(totals.simulatedProviderCost)} />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard className="lg:col-span-2" title={t('tokensByModel')} description={t('tokensByModelNote')}>
            <SimpleBarChart
              data={data?.byModel || []}
              x="modelId"
              y="_sum.totalTokens"
              label={t('tokens')}
              height={256}
            />
          </SectionCard>
          <SectionCard title={t('costClassification')}>
            <div className="space-y-4">
              <Cost
                label={t('actualProviderCost')}
                value={money(totals.actualProviderCost)}
                note={t('actualProviderCostNote')}
              />
              <Cost label={t('customerCharge')} value={money(totals.customerCharge)} note={t('customerChargeNote')} />
              <Cost
                label={t('simulatedProviderCost')}
                value={money(totals.simulatedProviderCost)}
                note={t('simulatedProviderCostNote')}
              />
              <Cost
                label={t('simulatedCustomerCharge')}
                value={money(totals.simulatedCustomerCharge)}
                note={t('simulatedCustomerChargeNote')}
              />
            </div>
          </SectionCard>
        </div>
        <SectionCard flush title={t('history')} description={t('historyNote')}>
          <Table<UsageRecord>
            rowKey="id"
            columns={columns}
            dataSource={data?.records}
            loading={isPending}
            pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
          />
        </SectionCard>
      </div>
    </Shell>
  );
}
function Cost({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <div className="flex justify-between gap-4">
        <span className="text-sm text-fg-secondary">{label}</span>
        <span className="font-mono text-sm font-semibold">{value}</span>
      </div>
      <p className="text-[11px] text-fg-tertiary">{note}</p>
    </div>
  );
}
