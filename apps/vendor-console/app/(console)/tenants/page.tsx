import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/ui/page-placeholder';

export const metadata: Metadata = { title: 'Tenants' };

export default function TenantsPage() {
  return <PagePlaceholder description="Customer deployments, their credit and controls" />;
}
