import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/ui/page-placeholder';

export const metadata: Metadata = { title: 'Pricing' };

export default function PricingPage() {
  return <PagePlaceholder description="Sale prices per model and their versions" />;
}
