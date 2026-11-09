'use client';

import { Button, Card, Table, type TableColumnsType } from 'antd';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { usePriceHistory, usePrices } from '@/components/api/queries';
import { useDialog } from '@/components/ui/use-dialog';
import { Page } from '@/components/ui/page';
import { QueryError } from '@/components/ui/query-error';
import type { Price } from '@/lib/api/types';
import { formatDateTime, formatUsd } from '@/lib/format';
import { PriceDialog } from './price-dialog';
import { strategyLabel } from './strategy';

const pair = (input: string, output: string) => (
  <span className="whitespace-nowrap">
    {formatUsd(input)} / {formatUsd(output)}
  </span>
);

const model = { title: 'Model', dataIndex: 'model', render: (m: string) => <code>{m}</code> };
const version = { title: 'Version', dataIndex: 'id', render: (id: string) => `v${id}` };

const currentColumns = (change: (model: string) => void): TableColumnsType<Price> => [
  model,
  version,
  { title: 'Sale input / output', key: 'sale', align: 'right', render: (_, p) => pair(p.inputRate, p.outputRate) },
  { title: 'Sim. cost input / output', key: 'cost', align: 'right', render: (_, p) => pair(p.inputCost, p.outputCost) },
  { title: 'Strategy', key: 'strategy', render: (_, p) => strategyLabel(p) },
  {
    title: 'Since',
    dataIndex: 'createdAt',
    render: (at: string) => <span className="whitespace-nowrap">{formatDateTime(at)}</span>,
  },
  {
    title: <span className="sr-only">Actions</span>,
    key: 'actions',
    align: 'right',
    render: (_, p) => (
      <Button size="small" type="link" onClick={() => change(p.model)} aria-label={`New price version of ${p.model}`}>
        Change
      </Button>
    ),
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
  { title: 'Strategy', key: 'strategy', render: (_, p) => strategyLabel(p) },
];

export function PricingPage() {
  const prices = usePrices();
  const history = usePriceHistory();
  const dialog = useDialog();
  // The model the new-version dialog starts with; the first one when none is picked.
  const [model, setModel] = useState<string>();
  const change = (picked?: string) => {
    setModel(picked);
    dialog.show();
  };
  return (
    <Page
      intro="Sale prices in USD per 1 million tokens. Each change saves a new version; requests already running keep the price they started with. Costs are simulated estimates for the vendor only: actual provider billing is outside this POC."
      actions={
        <Button type="primary" icon={<Plus size={16} />} disabled={!prices.data?.length} onClick={() => change()}>
          New price version
        </Button>
      }
    >
      <Card title="Current prices" styles={{ body: { padding: 0 } }}>
        {prices.error && (
          <div className="p-4">
            <QueryError error={prices.error} onRetry={() => void prices.refetch()} />
          </div>
        )}
        <Table<Price>
          rowKey="id"
          columns={currentColumns(change)}
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
      {prices.data && (
        <PriceDialog key={dialog.key} prices={prices.data} model={model} open={dialog.open} onClose={dialog.hide} />
      )}
    </Page>
  );
}
