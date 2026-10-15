import { AuthGate } from '../../components/auth/auth-gate';
import { WorkspacePage } from '../../features/workspace/workspace-page';
export default function Page() { return <AuthGate><WorkspacePage/></AuthGate>; }
