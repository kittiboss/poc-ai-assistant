import { AuthGate } from '@/components/auth/auth-gate';
import { AdminDashboard } from '@/features/admin/admin-dashboard';
export default function AdminPage() {
  return (
    <AuthGate>
      <AdminDashboard />
    </AuthGate>
  );
}
