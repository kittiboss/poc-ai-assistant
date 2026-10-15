import { AuthGate } from '@/components/auth/auth-gate';
import { ChatApp } from '@/features/chat/chat-app';
export default function Page() {
  return (
    <AuthGate>
      <ChatApp />
    </AuthGate>
  );
}
