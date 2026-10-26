import { AuthGate } from '@/components/auth/auth-gate';
import { KnowledgePage } from '@/features/knowledge/knowledge-page';
export default function Page() {
  return (
    <AuthGate>
      <KnowledgePage />
    </AuthGate>
  );
}
