import { AuthGate } from '@/components/auth/auth-gate';
import { AdminLayout } from '@/features/admin/admin-layout';

// The tabs share this layout, so switching tabs keeps the sidebar and the console's header mounted.
export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AdminLayout>{children}</AdminLayout>
    </AuthGate>
  );
}
