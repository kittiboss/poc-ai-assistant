import { AuthGate } from '@/components/auth/auth-gate';
import { BillingPage } from '@/features/billing/billing-page';
export default function Page() {
  return (
    <AuthGate>
      <BillingPage />
    </AuthGate>
  );
}
