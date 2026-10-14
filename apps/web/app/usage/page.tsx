import { AuthGate } from '../../components/auth-gate';
import { UsageDashboard } from '../../components/usage-dashboard';
export default function UsagePage() { return <AuthGate><UsageDashboard/></AuthGate>; }

