'use client';

import { Table, type TableColumnsType } from 'antd';
import Link from 'next/link';
import { useTenants } from '@/components/api/queries';
import { Page } from '@/components/ui/page';
import { QueryError } from '@/components/ui/query-error';
import type { Tenant } from '@/lib/api/types';
import { formatNumber, formatUsd, nanoUsd } from '@/lib/format';
import { CreditFlag, TenantStatus } from './status';

const columns: TableColumnsType<Tenant> = [
  {
    title: 'Tenant',
    key: 'tenant',
    render: (_, t) => (
      <Link href={`/tenants/${t.id}`} className="font-medium text-fg! hover:text-primary!">
        {t.name}
        <span className="block text-xs font-normal text-fg-tertiary">{t.id}</span>
      </Link>
    ),
  },
  { title: 'Status', key: 'status', render: (_, t) => <TenantStatus tenant={t} /> },
  {
    title: 'Available credit',
    key: 'available',
    align: 'right',
    render: (_, { credit }) => (
      <>
        <span className="inline-flex items-center gap-2">
          <CreditFlag credit={credit} />
          {formatUsd(credit.remaining)}
        </span>
        {credit.reserved > 0 && (
          <span className="block text-xs text-fg-tertiary">{formatUsd(credit.reserved)} held</span>
        )}
      </>
    ),
  },
  {
    title: 'Consumed',
    key: 'consumed',
    align: 'right',
    render: (_, { credit }) => (
      <>
        {formatUsd(credit.spent)}
        <span className="block text-xs text-fg-tertiary">of {formatUsd(credit.limit)} granted</span>
      </>
    ),
  },
  {
    title: 'Sim. provider cost',
    key: 'cost',
    align: 'right',
    render: (_, t) => formatUsd(t.simulatedProviderCost),
  },
  {
    title: 'Sim. margin',
    key: 'margin',
    align: 'right',
    render: (_, t) => formatUsd(nanoUsd(t.credit.spent) - nanoUsd(t.simulatedProviderCost)),
  },
  {
    title: 'Requests',
    key: 'requests',
    align: 'right',
    render: (_, t) => (
      <>
        {formatNumber(t.requests)}
        {Number(t.pending) > 0 && (
          <span className="block text-xs text-fg-tertiary">{formatNumber(t.pending)} running</span>
        )}
      </>
    ),
  },
];

export function TenantsPage() {
  const tenants = useTenants();
  return (
    <Page intro="Customer deployments on the vendor platform, with their test credit and requests. Credit is simulated: no payment is collected, and USD values are not money owed.">
      {tenants.error && <QueryError error={tenants.error} onRetry={() => void tenants.refetch()} />}
      <Table<Tenant>
        rowKey="id"
        columns={columns}
        dataSource={tenants.data}
        loading={tenants.isPending && !tenants.error}
        pagination={false}
        scroll={{ x: 'max-content' }}
        className="tabular-nums"
        locale={{ emptyText: tenants.error ? 'Tenants could not be loaded' : 'No customer deployments yet' }}
      />
    </Page>
  );
}
