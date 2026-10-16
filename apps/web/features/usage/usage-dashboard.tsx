'use client';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Coins, Database, Hash, Timer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { costFormat, dateTimeFormat } from '@/i18n/formats';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { useApi } from '@/lib/api';
import { SimpleBarChart } from '@/components/ui/charts';
import { Shell } from '@/components/layout/shell';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { download } from '@/lib/download';

type UsageRecord = {
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
  currency: string;
  actualProviderCost: string;
  customerCharge: string;
  simulatedProviderCost: string;
  simulatedCustomerCharge: string;
  createdAt: string;
  model: { displayName: string };
};
type UsageData = {
  totals: { _count: number; _sum: Record<string, number | string | null> };
  byModel: Array<{ modelId: string; _count: number; _sum: { totalTokens: number | null } }>;
  records: UsageRecord[];
};
export function UsageDashboard() {
  const api = useApi();
  const t = useTranslations('usage');
  const enums = useEnumLabel();
  const format = useFormatter();
  const money = (value: unknown, currency = 'USD') => format.number(Number(value || 0), costFormat(currency, 4, 8));
  const number = (value: unknown) => format.number(Number(value || 0));
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .request<UsageData>('/usage/me')
      .then(setData)
      .catch((cause) => setError(cause.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = data?.totals._sum || {};
  return (
    <Shell active="usage">
      <div className="mx-auto max-w-7xl space-y-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div>
          <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
        </div>
        {error && <Card className="border-error-border p-4 text-error">{error}</Card>}
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              const file = await api.request<{ filename: string; content: string }>('/workspace/usage.csv');
              download(file.filename, file.content, 'text/csv');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Export usage CSV
        </Button>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metric icon={<Activity />} label={t('requests')} value={number(data?.totals._count)} />
          <Metric icon={<ArrowDownToLine />} label={t('inputTokens')} value={number(totals.inputTokens)} />
          <Metric icon={<ArrowUpFromLine />} label={t('outputTokens')} value={number(totals.outputTokens)} />
          <Metric icon={<Hash />} label={t('totalTokens')} value={number(totals.totalTokens)} />
          <Metric icon={<Database />} label={t('actualCost')} value={money(totals.actualProviderCost)} />
          <Metric icon={<Coins />} label={t('simulatedCost')} value={money(totals.simulatedProviderCost)} />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="font-semibold">{t('tokensByModel')}</h2>
            <p className="mb-5 text-xs text-fg-secondary">{t('tokensByModelNote')}</p>
            <SimpleBarChart
              data={data?.byModel || []}
              x="modelId"
              y="_sum.totalTokens"
              label={t('tokens')}
              height={256}
            />
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">{t('costClassification')}</h2>
            <div className="mt-5 space-y-4">
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
          </Card>
        </div>
        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">{t('history')}</h2>
            <p className="text-xs text-fg-secondary">{t('historyNote')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-fill-quaternary text-xs text-fg-secondary uppercase">
                <tr>
                  {(
                    [
                      'time',
                      'model',
                      'provider',
                      'tokens',
                      'duration',
                      'usage',
                      'status',
                      'actualCost',
                      'simulatedCost',
                    ] as const
                  ).map((column) => (
                    <th key={column} className="px-4 py-3 font-medium">
                      {t(`columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {data?.records.map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {format.dateTime(new Date(record.createdAt), dateTimeFormat)}
                    </td>
                    <td className="px-4 py-3 font-medium">{record.model.displayName}</td>
                    <td className="px-4 py-3">{record.provider}</td>
                    <td className="px-4 py-3">
                      {number(record.totalTokens)}{' '}
                      <span className="text-xs text-fg-tertiary">
                        {t('tokenSplit', { input: number(record.inputTokens), output: number(record.outputTokens) })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Timer className="mr-1 inline" size={13} />
                      {format.number(record.durationMs, { style: 'unit', unit: 'millisecond' })}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          record.usageKind === 'ACTUAL'
                            ? 'success'
                            : record.usageKind === 'SYNTHETIC'
                              ? 'primary'
                              : 'warning'
                        }
                      >
                        {enums.label('usageKind', record.usageKind)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{enums.label('requestStatus', record.status)}</td>
                    <td className="px-4 py-3">{money(record.actualProviderCost, record.currency)}</td>
                    <td className="px-4 py-3">{money(record.simulatedProviderCost, record.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="mb-4 inline-flex rounded-brand bg-primary-soft p-2 text-primary">{icon}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-fg-secondary">{label}</div>
    </Card>
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
