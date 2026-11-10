import { ApiProvider } from '@/components/api/api-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { Shell } from '@/components/layout/shell';

/** Every page for signed-in staff: the sidebar and the page header. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <ApiProvider>
        <Shell>{children}</Shell>
      </ApiProvider>
    </AuthGate>
  );
}
