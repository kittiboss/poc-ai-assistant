import { AuthGate } from '@/components/auth/auth-gate';
import { SettingsPage } from '@/features/settings/settings-page';
export default function Page() {
  return (
    <AuthGate>
      <SettingsPage />
    </AuthGate>
  );
}
