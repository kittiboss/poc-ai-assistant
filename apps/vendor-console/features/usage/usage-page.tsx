'use client';

import { Card, Empty, Skeleton, Table, Tag, type TableColumnsType } from 'antd';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useUsageToday } from '@/components/api/queries';
import { Meter } from '@/components/ui/meter';
import { Page } from '@/components/ui/page';
import { QueryError } from '@/components/ui/query-error';
import type { UsageToday } from '@/lib/api/types';
import { formatDateTime, formatNumber } from '@/lib/format';

type TenantUsage = UsageToday['tenants'][number];
type Row = { key: string; model: ReactNode; requests: ReactNode; tokens: ReactNode };

const columns: TableColumnsType<Row> = [
  { title: 'Model', dataIndex: 'model', width: '34%' },
  { title: 'Requests', dataIndex: 'requests', width: '33%' },
  { title: 'Tokens', dataIndex: 'tokens', width: '33%' },
];

export function UsagePage() {
  const usage = useUsageToday();
  const reset = usage.data && formatDateTime(usage.data.resetsAt);
  return (
    <Page
      intro={
        <>
          Requests and provider-reported tokens per customer and model since 00:00 UTC
          {reset && <> (next reset {reset})</>}, from the credit ledger. Rejected calls are not counted. A
          customer&apos;s external models share one daily limit, which its own deployment enforces with conservative
          estimates, so it can stop a little before these bars are full.
        </>
      }
    >
      {usage.error && <QueryError error={usage.error} onRetry={() => void usage.refetch()} />}
      {usage.isPending && !usage.error && <Skeleton active paragraph={{ rows: 6 }} />}
      {usage.data?.tenants.length === 0 && <Empty description="No customer deployments yet" />}
      {usage.data?.tenants.map((tenant) => (
        <TenantUsageCard key={tenant.tenant} usage={tenant} />
      ))}
    </Page>
  );
}

function TenantUsageCard({ usage }: { usage: TenantUsage }) {
  const { limits } = usage;
  // An external model's bars are its share of the shared limit; local models have no limit.
  const rows: Row[] = [
    {
      key: 'external',
      model: (
        <span className="font-medium">
          All external models
          <span className="block text-xs font-normal text-fg-tertiary">Shared daily limit</span>
        </span>
      ),
      requests: limits ? (
        <Meter used={usage.external.requests} limit={limits.requests} label="External requests today" />
      ) : (
        formatNumber(usage.external.requests)
      ),
      tokens: limits ? (
        <Meter used={usage.external.tokens} limit={limits.tokens} label="External tokens today" />
      ) : (
        formatNumber(usage.external.tokens)
      ),
    },
    ...usage.models.map((m) => {
      const running = m.running ? ` · ${formatNumber(m.running)} running` : '';
      const metered = m.external && limits;
      return {
        key: m.model,
        model: (
          <span className="flex items-center gap-2">
            <code>{m.model}</code>
            {!m.external && <Tag className="me-0">local</Tag>}
          </span>
        ),
        requests: metered ? (
          <Meter used={m.requests} limit={limits.requests} note={running} label={`${m.model} requests today`} />
        ) : (
          `${formatNumber(m.requests)}${running}`
        ),
        tokens: metered ? (
          <Meter used={m.tokens} limit={limits.tokens} label={`${m.model} tokens today`} />
        ) : (
          formatNumber(m.tokens)
        ),
      };
    }),
  ];
  return (
    <Card
      title={
        <Link href={`/tenants/${usage.tenant}`} className="text-fg! hover:text-primary!">
          {usage.name} <span className="font-normal text-fg-tertiary">· {usage.tenant}</span>
        </Link>
      }
      styles={{ body: { padding: 0 } }}
    >
      <Table<Row>
        rowKey="key"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        className="tabular-nums"
      />
    </Card>
  );
}
