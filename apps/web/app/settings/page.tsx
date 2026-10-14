import { AuthGate } from '../../components/auth-gate';
import { SettingsPage } from '../../components/settings-page';
export default function Page() { return <AuthGate><SettingsPage/></AuthGate>; }

