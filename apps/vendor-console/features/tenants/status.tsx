import { Tag } from 'antd';
import type { Credit, LedgerKind, RequestState, Tenant } from '@/lib/api/types';

/** Suspended tenants are refused by the gateway; unprovisioned ones wait for `tenant:create`. */
export function TenantStatus({ tenant }: { tenant: Pick<Tenant, 'enabled' | 'provisioned'> }) {
  if (!tenant.enabled)
    return (
      <Tag variant="filled" color="error" className="me-0">
        Suspended
      </Tag>
    );
  if (!tenant.provisioned)
    return (
      <Tag variant="filled" color="warning" className="me-0">
        Awaiting activation
      </Tag>
    );
  return (
    <Tag variant="filled" color="success" className="me-0">
      Active
    </Tag>
  );
}

/** Out of credit, or below $0.10: new requests are refused or soon will be. */
export function CreditFlag({ credit }: { credit: Pick<Credit, 'exhausted' | 'lowCredit'> }) {
  if (credit.exhausted)
    return (
      <Tag variant="filled" color="error" className="me-0">
        No credit
      </Tag>
    );
  if (credit.lowCredit)
    return (
      <Tag variant="filled" color="warning" className="me-0">
        Low
      </Tag>
    );
  return null;
}

export const ledgerKinds: Record<LedgerKind, { label: string; color?: string }> = {
  OPENING: { label: 'Opening credit', color: 'processing' },
  TOPUP: { label: 'Top-up', color: 'success' },
  DEBIT: { label: 'Charge' },
  ESTIMATED_DEBIT: { label: 'Estimated charge', color: 'warning' },
  REJECTED: { label: 'Rejected' },
};

export const requestStates: Record<RequestState, { label: string; color?: string }> = {
  PENDING: { label: 'Running', color: 'processing' },
  COMPLETED: { label: 'Completed', color: 'success' },
  // Charged the reserved maximum: the provider reported no usage, or the request was settled as stale.
  ESTIMATED: { label: 'Estimated', color: 'warning' },
  REJECTED: { label: 'Rejected' },
};
