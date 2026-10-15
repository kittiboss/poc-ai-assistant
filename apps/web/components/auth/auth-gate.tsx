'use client';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { useBrand } from '@/components/brand/brand-provider';
import { Button, Card } from '@/components/ui/primitives';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const brand = useBrand();
  if (auth.isLoading || auth.activeNavigator)
    return (
      <main className="grid min-h-screen place-items-center">
        <LoaderCircle className="animate-spin text-primary" />
      </main>
    );
  if (auth.error)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <Card className="max-w-md p-8">
          <h1 className="text-xl font-semibold">Sign-in failed</h1>
          <p className="mt-2 text-sm text-error">{auth.error.message}</p>
          <Button className="mt-5" onClick={() => auth.signinRedirect()}>
            Try again
          </Button>
        </Card>
      </main>
    );
  if (!auth.isAuthenticated)
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-layout p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--app-color-primary)_35%,transparent),transparent_35%),radial-gradient(circle_at_80%_70%,color-mix(in_srgb,var(--app-color-info)_20%,transparent),transparent_30%)]" />
        <Card className="relative w-full max-w-md bg-surface/70 p-9 backdrop-blur-xl">
          <div className="mb-6 inline-flex rounded-brand-lg bg-primary p-3 text-on-primary">
            <LockKeyhole />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{brand.name}</h1>
          <p className="mt-3 text-sm leading-6 text-fg-secondary">
            A private, locally hosted assistant. Sign in through the development company identity provider.
          </p>
          <Button className="mt-7 w-full" onClick={() => auth.signinRedirect()}>
            Continue with company SSO
          </Button>
          <p className="mt-4 text-center text-xs text-fg-tertiary">No paid AI provider is enabled in this POC.</p>
        </Card>
      </main>
    );
  return children;
}
