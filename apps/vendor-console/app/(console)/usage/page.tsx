import type { Metadata } from 'next';
import { UsagePage } from '@/features/usage/usage-page';

export const metadata: Metadata = { title: 'Usage' };

export default function Page() {
  return <UsagePage />;
}
