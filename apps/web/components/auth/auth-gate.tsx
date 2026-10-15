'use client';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { Button, Card } from '@/components/ui/primitives';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.isLoading || auth.activeNavigator)
    return (
      <main className="grid min-h-screen place-items-center">
        <LoaderCircle className="animate-spin text-brand" />
      </main>
    );
  if (auth.error)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <Card className="max-w-md p-8">
          <h1 className="text-xl font-semibold">Sign-in failed</h1>
          <p className="mt-2 text-sm text-red-600">{auth.error.message}</p>
          <Button className="mt-5" onClick={() => auth.signinRedirect()}>
            Try again
          </Button>
        </Card>
      </main>
    );
  if (!auth.isAuthenticated)
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-950 p-6 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(109,93,252,.35),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,.2),transparent_30%)]" />
        <Card className="relative w-full max-w-md border-white/10 bg-white/5 p-9 text-white backdrop-blur-xl">
          <div className="mb-6 inline-flex rounded-2xl bg-brand p-3">
            <LockKeyhole />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Enterprise AI</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            A private, locally hosted assistant. Sign in through the development company identity provider.
          </p>
          <Button className="mt-7 w-full" onClick={() => auth.signinRedirect()}>
            Continue with company SSO
          </Button>
          <p className="mt-4 text-center text-xs text-slate-400">No paid AI provider is enabled in this POC.</p>
        </Card>
      </main>
    );
  return children;
}
