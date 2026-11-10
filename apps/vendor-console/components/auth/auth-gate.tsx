'use client';

import { Button } from 'antd';
import { LoaderCircle, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Brand } from '@/components/layout/brand';
import { STAFF_ROLE, useRoles } from '@/lib/auth/roles';
import { useSession } from './auth-provider';

/**
 * Shows the page to signed-in staff only. Everyone else gets the sign-in screen, which sends them
 * to the vendor realm's sign-in page and back to the page they asked for.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const session = useSession();
  const roles = useRoles();
  const signIn = () =>
    void auth.signinRedirect({ redirect_uri: `${window.location.origin}${window.location.pathname}` });

  // react-oidc-context also reports isLoading during a background token renewal (signinSilent);
  // that must not replace, and so remount, the page.
  const busy = auth.activeNavigator ? auth.activeNavigator !== 'signinSilent' : auth.isLoading;
  if (busy)
    return (
      <main className="grid min-h-dvh place-items-center" role="status">
        <LoaderCircle className="animate-spin text-primary" aria-label="Loading" />
      </main>
    );

  // A failed background renewal must not hide a session that is still valid.
  if (auth.isAuthenticated) {
    if (roles.includes(STAFF_ROLE)) return children;
    const profile = auth.user?.profile;
    return (
      <AuthScreen>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldAlert size={22} className="text-warning" aria-hidden />
          No access
        </h1>
        <p className="mt-3 text-sm leading-6 text-fg-secondary">
          You are signed in as{' '}
          <span className="font-medium text-fg">{profile?.preferred_username ?? profile?.sub}</span>, but this account
          does not have the <code className="text-fg">{STAFF_ROLE}</code> role, so it cannot use the vendor console. Ask
          a vendor administrator to grant it, or sign in with another account.
        </p>
        <Button
          size="large"
          block
          className="mt-7"
          icon={<LogOut size={16} />}
          onClick={() => void auth.signoutRedirect()}
        >
          Sign out
        </Button>
      </AuthScreen>
    );
  }

  if (auth.error && !session.expired && !['renewSilent', 'signinSilent'].includes(auth.error.source))
    return (
      <AuthScreen>
        <h1 className="text-xl font-semibold">Sign-in failed</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-error">
          {describeError(auth.error)}
        </p>
        <Button type="primary" size="large" block className="mt-7" onClick={signIn}>
          Try again
        </Button>
      </AuthScreen>
    );

  return (
    <AuthScreen>
      {session.expired && (
        <p role="status" className="mb-5 rounded-brand bg-warning/15 px-3 py-2 text-sm text-warning">
          Your session has ended. Sign in again to continue.
        </p>
      )}
      <p className="text-sm leading-6 text-fg-secondary">
        Manage customer credits, deployments and model pricing. Sign in with your vendor staff account.
      </p>
      <Button type="primary" size="large" block className="mt-7" icon={<LogIn size={16} />} onClick={signIn}>
        Sign in
      </Button>
    </AuthScreen>
  );
}

function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-layout p-4 sm:p-6">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,color-mix(in_srgb,var(--app-color-primary)_22%,transparent),transparent_40%)]"
      />
      <section className="relative w-full max-w-sm rounded-brand-lg border border-line-secondary bg-surface p-6 shadow-2xl sm:p-8">
        <div className="mb-7">
          <Brand size="lg" />
        </div>
        {children}
      </section>
    </main>
  );
}

/** A readable reason, most often that Keycloak could not be reached. */
function describeError(error: Error): string {
  if (/failed to fetch|networkerror|load failed|network error/i.test(error.message))
    return "The sign-in service can't be reached. Check that the platform is running, then try again.";
  return error.message;
}
