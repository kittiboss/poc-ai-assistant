'use client';

import { Card, Table, type TableColumnsType } from 'antd';
import { usePriceHistory, usePrices } from '@/components/api/queries';
import { Page } from '@/components/ui/page';
import { QueryError } from '@/components/ui/query-error';
import type { Price } from '@/lib/api/types';
import { formatDateTime, formatUsd } from '@/lib/format';

const strategy = (p: Price) => (p.strategy === 'FIXED_RATE' ? 'Fixed rate' : `Markup +${p.markupPercent}%`);
const pair = (input: string, output: string) => (
  <span className="whitespace-nowrap">
    {formatUsd(input)} / {formatUsd(output)}
  </span>
);

const model = { title: 'Model', dataIndex: 'model', render: (m: string) => <code>{m}</code> };
const version = { title: 'Version', dataIndex: 'id', render: (id: string) => `v${id}` };

const currentColumns: TableColumnsType<Price> = [
  model,
  version,
  { title: 'Sale input / output', key: 'sale', align: 'right', render: (_, p) => pair(p.inputRate, p.outputRate) },
  { title: 'Sim. cost input / output', key: 'cost', align: 'right', render: (_, p) => pair(p.inputCost, p.outputCost) },
  { title: 'Strategy', key: 'strategy', render: (_, p) => strategy(p) },
  {
    title: 'Since',
    dataIndex: 'createdAt',
    render: (at: string) => <span className="whitespace-nowrap">{formatDateTime(at)}</span>,
  },
];

const historyColumns: TableColumnsType<Price> = [
  version,
  model,
  {
    title: 'Saved',
    dataIndex: 'createdAt',
    render: (at: string) => <span className="whitespace-nowrap">{formatDateTime(at)}</span>,
  },
  { title: 'Sale input / output', key: 'sale', align: 'right', render: (_, p) => pair(p.inputRate, p.outputRate) },
  { title: 'Sim. cost input / output', key: 'cost', align: 'right', render: (_, p) => pair(p.inputCost, p.outputCost) },
  { title: 'Strategy', key: 'strategy', render: (_, p) => strategy(p) },
];

export function PricingPage() {
  const prices = usePrices();
  const history = usePriceHistory();
  return (
    <Page intro="Sale prices in USD per 1 million tokens. Each change saves a new version; requests already running keep the price they started with. Costs are simulated estimates for the vendor only: actual provider billing is outside this POC.">
      <Card title="Current prices" styles={{ body: { padding: 0 } }}>
        {prices.error && (
          <div className="p-4">
            <QueryError error={prices.error} onRetry={() => void prices.refetch()} />
          </div>
        )}
        <Table<Price>
          rowKey="id"
          columns={currentColumns}
          dataSource={prices.data}
          loading={prices.isPending && !prices.error}
          pagination={false}
          scroll={{ x: 'max-content' }}
          className="tabular-nums"
          locale={{ emptyText: 'No prices' }}
        />
      </Card>
      <Card
        title="Version history"
        extra={<span className="text-xs text-fg-tertiary">Latest 100</span>}
        styles={{ body: { padding: 0 } }}
      >
        {history.error && (
          <div className="p-4">
            <QueryError error={history.error} onRetry={() => void history.refetch()} />
          </div>
        )}
        <Table<Price>
          rowKey="id"
          size="small"
          columns={historyColumns}
          dataSource={history.data}
          loading={history.isPending && !history.error}
          pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
          className="tabular-nums"
          locale={{ emptyText: 'No versions' }}
        />
      </Card>
    </Page>
  );
}
