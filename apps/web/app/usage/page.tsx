import { AuthGate } from '@/components/auth/auth-gate';
import { UsageDashboard } from '@/features/usage/usage-dashboard';
export default function UsagePage() { return <AuthGate><UsageDashboard/></AuthGate>; }

