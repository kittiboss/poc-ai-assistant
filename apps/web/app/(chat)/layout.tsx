import { AuthGate } from '@/components/auth/auth-gate';
import { ChatApp } from '@/features/chat/chat-app';

// `/` (new chat) and `/c/[id]` share this layout, so switching chats keeps the page mounted,
// including a reply that is still streaming. ChatApp reads the id from the URL.
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <ChatApp />
      {children}
    </AuthGate>
  );
}
