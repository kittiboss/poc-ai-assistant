'use client';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Coins, Database, Hash, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
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
const money = (value: unknown, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  }).format(Number(value || 0));
const number = (value: unknown) => new Intl.NumberFormat().format(Number(value || 0));

export function UsageDashboard() {
  const api = useApi();
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
          <p className="text-sm font-medium text-primary">YOUR ACCOUNT</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Usage dashboard</h1>
          <p className="mt-2 text-sm text-fg-secondary">Actual, estimated, and simulated amounts are kept separate.</p>
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
          <Metric icon={<Activity />} label="AI requests" value={number(data?.totals._count)} />
          <Metric icon={<ArrowDownToLine />} label="Input tokens" value={number(totals.inputTokens)} />
          <Metric icon={<ArrowUpFromLine />} label="Output tokens" value={number(totals.outputTokens)} />
          <Metric icon={<Hash />} label="Total tokens" value={number(totals.totalTokens)} />
          <Metric icon={<Database />} label="Actual external API cost" value={money(totals.actualProviderCost)} />
          <Metric icon={<Coins />} label="Simulated cost (not billed)" value={money(totals.simulatedProviderCost)} />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="font-semibold">Tokens by model</h2>
            <p className="mb-5 text-xs text-fg-secondary">Input and output combined</p>
            <SimpleBarChart data={data?.byModel || []} x="modelId" y="_sum.totalTokens" label="Tokens" height={256} />
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Cost classification</h2>
            <div className="mt-5 space-y-4">
              <Cost
                label="Actual provider cost"
                value={money(totals.actualProviderCost)}
                note="Externally payable amount"
              />
              <Cost label="Customer charge" value={money(totals.customerCharge)} note="Current non-simulated pricing" />
              <Cost
                label="Simulated provider cost"
                value={money(totals.simulatedProviderCost)}
                note="Scenario only, e.g. a free-tier model at paid-tier list price; not payable"
              />
              <Cost
                label="Simulated customer charge"
                value={money(totals.simulatedCustomerCharge)}
                note="Scenario only; never invoiced"
              />
            </div>
          </Card>
        </div>
        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">Request history</h2>
            <p className="text-xs text-fg-secondary">
              Latest 100 requests; prompt and response content are intentionally excluded.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-fill-quaternary text-xs text-fg-secondary uppercase">
                <tr>
                  {[
                    'Time',
                    'Model',
                    'Provider',
                    'Tokens',
                    'Duration',
                    'Usage',
                    'Status',
                    'Actual cost',
                    'Simulated cost',
                  ].map((item) => (
                    <th key={item} className="px-4 py-3 font-medium">
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {data?.records.map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(record.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 font-medium">{record.model.displayName}</td>
                    <td className="px-4 py-3">{record.provider}</td>
                    <td className="px-4 py-3">
                      {number(record.totalTokens)}{' '}
                      <span className="text-xs text-fg-tertiary">
                        ({record.inputTokens} in / {record.outputTokens} out)
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Timer className="mr-1 inline" size={13} />
                      {record.durationMs} ms
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
                        {record.usageKind}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{record.status}</td>
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
