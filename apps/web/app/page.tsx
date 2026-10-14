import { AuthGate } from '../components/auth-gate';
import { ChatApp } from '../components/chat-app';
export default function Page() { return <AuthGate><ChatApp/></AuthGate>; }
