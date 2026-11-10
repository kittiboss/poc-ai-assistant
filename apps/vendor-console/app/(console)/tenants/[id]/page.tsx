import type { Metadata } from 'next';
import { TenantDetail } from '@/features/tenants/tenant-detail';

export async function generateMetadata({ params }: PageProps<'/tenants/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Tenant ${id}` };
}

export default async function Page({ params }: PageProps<'/tenants/[id]'>) {
  const { id } = await params;
  return <TenantDetail id={id} />;
}
