import { AuthGate } from '../../../components/auth/auth-gate';
import { LiveUsagePage } from '../../../features/usage/live-usage-page';

export default function LiveTokensPage() {
  return (
    <AuthGate>
      <LiveUsagePage />
    </AuthGate>
  );
}
