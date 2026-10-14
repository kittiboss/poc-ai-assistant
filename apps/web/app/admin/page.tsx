import { AuthGate } from '../../components/auth-gate';
import { AdminDashboard } from '../../components/admin-dashboard';
export default function AdminPage() { return <AuthGate><AdminDashboard/></AuthGate>; }

