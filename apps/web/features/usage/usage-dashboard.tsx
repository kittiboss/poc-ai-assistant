'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Table, type TableColumnsType } from 'antd';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Coins, Database, FileDown, Hash, Timer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { download } from '@/lib/download';
import { runtimeConfig } from '@/lib/runtime-config';

type UsageRecord = MyUsage['records'][number];

export function UsageDashboard() {
  const vendor = runtimeConfig().vendorManaged;
  const { client, unwrap, request } = useApi();
  const { message: toast } = App.useApp();
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
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      // The CSV endpoint is not in the OpenAPI document yet, so it goes through `request`.
      const file = await request<{ filename: string; content: string }>('/workspace/usage.csv');
      download(file.filename, file.content, 'text/csv');
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setExporting(false);
    }
  };

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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
          </div>
          <Button icon={<FileDown size={16} />} loading={exporting} onClick={exportCsv}>
            {t('exportCsv')}
          </Button>
        </div>
        {error && <Alert type="error" showIcon title={error.message} />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard icon={<Activity />} label={t('requests')} value={number(data?.totals._count)} />
          <MetricCard icon={<ArrowDownToLine />} label={t('inputTokens')} value={number(totals.inputTokens)} />
          <MetricCard icon={<ArrowUpFromLine />} label={t('outputTokens')} value={number(totals.outputTokens)} />
          <MetricCard icon={<Hash />} label={t('totalTokens')} value={number(totals.totalTokens)} />
          {!vendor && (
            <MetricCard icon={<Database />} label={t('actualCost')} value={money(totals.actualProviderCost)} />
          )}
          {!vendor && (
            <MetricCard icon={<Coins />} label={t('simulatedCost')} value={money(totals.simulatedProviderCost)} />
          )}
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
              {!vendor && (
                <Cost
                  label={t('actualProviderCost')}
                  value={money(totals.actualProviderCost)}
                  note={t('actualProviderCostNote')}
                />
              )}
              <Cost label={t('customerCharge')} value={money(totals.customerCharge)} note={t('customerChargeNote')} />
              {!vendor && (
                <Cost
                  label={t('simulatedProviderCost')}
                  value={money(totals.simulatedProviderCost)}
                  note={t('simulatedProviderCostNote')}
                />
              )}
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
            columns={
              vendor
                ? columns.filter((column) => !['actualCost', 'simulatedCost'].includes(String(column.key)))
                : columns
            }
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
