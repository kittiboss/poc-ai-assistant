'use client';

import { Alert, Button, Result, Skeleton } from 'antd';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRagUsage, useTenants } from '@/components/api/queries';
import { Page } from '@/components/ui/page';
import { QueryError } from '@/components/ui/query-error';
import { TenantStatus } from './status';
import { CreditCard, ImagesCard, KnowledgeCard, PlanCard } from './tenant-cards';
import { TenantLedger } from './tenant-ledger';

/** One customer deployment: its credit, plan, limits and ledger. */
export function TenantDetail({ id }: { id: string }) {
  const router = useRouter();
  // The list is small and already polled; vendor-control has no single-tenant endpoint.
  const tenants = useTenants();
  const knowledge = useRagUsage();
  const tenant = tenants.data?.find((t) => t.id === id);

  if (tenants.data && !tenant)
    return (
      <Page>
        <Result
          status="404"
          title="No such tenant"
          subTitle={`There is no customer deployment with the ID “${id}”.`}
          extra={
            <Button type="primary" onClick={() => router.push('/tenants')}>
              All tenants
            </Button>
          }
        />
      </Page>
    );

  return (
    <Page>
      <div>
        <Link href="/tenants" className="inline-flex items-center gap-1.5 text-sm text-fg-secondary! hover:text-fg!">
          <ArrowLeft size={16} aria-hidden />
          All tenants
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-2xl font-semibold">{tenant?.name ?? id}</h2>
          {tenant && <TenantStatus tenant={tenant} />}
        </div>
        <p className="mt-1 text-sm text-fg-tertiary">
          Tenant ID <code className="text-fg-secondary">{id}</code>
        </p>
      </div>

      {tenants.error && <QueryError error={tenants.error} onRetry={() => void tenants.refetch()} />}
      {tenant && !tenant.enabled && (
        <Alert
          type="warning"
          showIcon
          title="Suspended"
          description="The gateway refuses this tenant's requests until it is resumed."
        />
      )}
      {tenant && !tenant.provisioned && (
        <Alert
          type="info"
          showIcon
          title="Awaiting activation on the vendor host"
          description={
            <>
              Run <code>npm run tenant:create -- {id}</code> on the vendor host to deploy it. Its gateway credential
              stays on the server.
            </>
          }
        />
      )}

      {tenant ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CreditCard tenant={tenant} />
          <PlanCard tenant={tenant} />
          <KnowledgeCard tenant={tenant} usage={knowledge.data} usageError={knowledge.error} />
          <ImagesCard tenant={tenant} />
        </div>
      ) : (
        !tenants.error && <Skeleton active paragraph={{ rows: 6 }} />
      )}

      {/* Only for a tenant that exists, so an unknown ID does not ask for its ledger. */}
      {tenant && <TenantLedger id={id} />}
    </Page>
  );
}
