import type { Metadata } from 'next';
import { PagePlaceholder } from '@/components/ui/page-placeholder';

export const metadata: Metadata = { title: 'Usage' };

export default function UsagePage() {
  return <PagePlaceholder description="Today's requests and tokens per customer and model" />;
}
