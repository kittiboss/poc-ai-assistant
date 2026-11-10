'use client';

import { Card, Table, Tabs, Tag, type TableColumnsType } from 'antd';
import { useBilling } from '@/components/api/queries';
import { QueryError } from '@/components/ui/query-error';
import type { LedgerRequest, Transaction } from '@/lib/api/types';
import { formatDateTime, formatNumber, formatUsd, nanoUsd } from '@/lib/format';
import { ledgerKinds, requestStates } from './status';

const transactionColumns: TableColumnsType<Transaction> = [
  { title: 'Receipt', dataIndex: 'id', render: (id: string) => <span className="whitespace-nowrap">{id}</span> },
  {
    title: 'Time',
    dataIndex: 'createdAt',
    render: (at: string) => <span className="whitespace-nowrap">{formatDateTime(at, { seconds: true })}</span>,
  },
  {
    title: 'Type',
    dataIndex: 'kind',
    render: (kind: Transaction['kind']) => (
      <Tag color={ledgerKinds[kind]?.color} className="me-0">
        {ledgerKinds[kind]?.label ?? kind}
      </Tag>
    ),
  },
  {
    title: 'Amount',
    dataIndex: 'amount',
    align: 'right',
    render: (amount: string) => (
      <span className={nanoUsd(amount) > 0n ? 'text-success' : undefined}>{formatUsd(amount, { sign: true })}</span>
    ),
  },
  {
    title: 'Reference',
    dataIndex: 'reference',
    render: (reference: string) => <code className="text-xs break-all text-fg-secondary">{reference}</code>,
  },
];

const requestColumns: TableColumnsType<LedgerRequest> = [
  {
    title: 'Request',
    dataIndex: 'request_id',
    render: (id: string) => <code className="text-xs break-all text-fg-secondary">{id}</code>,
  },
  {
    title: 'Time',
    dataIndex: 'created_at',
    render: (at: string) => <span className="whitespace-nowrap">{formatDateTime(at, { seconds: true })}</span>,
  },
  {
    title: 'Model',
    key: 'model',
    render: (_, r) => (
      <span className="whitespace-nowrap">
        <code>{r.model}</code>
        <span className="block text-xs text-fg-tertiary">{r.kind === 'EMBEDDING' ? 'Embedding' : 'Chat'}</span>
      </span>
    ),
  },
  {
    title: 'Status',
    dataIndex: 'state',
    render: (state: LedgerRequest['state']) => (
      <Tag color={requestStates[state]?.color} className="me-0">
        {requestStates[state]?.label ?? state}
      </Tag>
    ),
  },
  {
    title: 'Tokens in / out',
    key: 'tokens',
    align: 'right',
    render: (_, r) => (
      <span className="whitespace-nowrap">
        {r.input_tokens === null ? '—' : formatNumber(r.input_tokens)} /{' '}
        {r.output_tokens === null ? '—' : formatNumber(r.output_tokens)}
      </span>
    ),
  },
  {
    title: 'Charge',
    dataIndex: 'charge',
    align: 'right',
    render: (charge: string | null) =>
      charge === null ? <span className="text-fg-tertiary">Pending</span> : formatUsd(charge),
  },
  { title: 'Price', dataIndex: 'price_id', align: 'right', render: (id: string) => `v${id}` },
];

const pagination = { pageSize: 20, hideOnSinglePage: true, showSizeChanger: false } as const;

/** The tenant's credit transactions and requests, the latest 100 of each. */
export function TenantLedger({ id }: { id: string }) {
  const billing = useBilling(id);
  const loading = billing.isPending && !billing.error;
  return (
    <Card title="Ledger" styles={{ body: { paddingTop: 4 } }}>
      {billing.error && <QueryError error={billing.error} onRetry={() => void billing.refetch()} />}
      <Tabs
        items={[
          {
            key: 'transactions',
            label: 'Credit history',
            children: (
              <Table<Transaction>
                rowKey="id"
                size="small"
                columns={transactionColumns}
                dataSource={billing.data?.transactions}
                loading={loading}
                pagination={pagination}
                scroll={{ x: 'max-content' }}
                className="tabular-nums"
                locale={{ emptyText: 'No transactions' }}
              />
            ),
          },
          {
            key: 'requests',
            label: 'Requests',
            children: (
              <Table<LedgerRequest>
                rowKey="request_id"
                size="small"
                columns={requestColumns}
                dataSource={billing.data?.requests}
                loading={loading}
                pagination={pagination}
                scroll={{ x: 'max-content' }}
                className="tabular-nums"
                locale={{ emptyText: 'No requests' }}
              />
            ),
          },
        ]}
      />
      <p className="mt-3 text-xs text-fg-tertiary">
        The latest 100 of each. SIM receipts record test credit only: no payment was received and they are not tax
        invoices.
      </p>
    </Card>
  );
}
