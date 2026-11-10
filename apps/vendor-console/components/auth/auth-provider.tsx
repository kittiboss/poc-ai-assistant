'use client';

import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthProvider as OidcProvider, useAuth } from 'react-oidc-context';
import { consoleConfig } from '@/lib/runtime-config';

/**
 * Sign-in with the vendor realm (Authorization Code + PKCE, set up by scripts/platform/vendor-realm.mjs).
 * The token is renewed in the background while the console is open.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { keycloakUrl, keycloakRealm, oidcClientId } = consoleConfig();
  const home = typeof window === 'undefined' ? 'http://localhost:4070/' : `${window.location.origin}/`;
  return (
    <OidcProvider
      authority={`${keycloakUrl}/realms/${keycloakRealm}`}
      client_id={oidcClientId}
      redirect_uri={home}
      post_logout_redirect_uri={home}
      response_type="code"
      scope="openid profile email"
      automaticSilentRenew
      onSigninCallback={() => window.history.replaceState({}, document.title, window.location.pathname)}
    >
      <SessionProvider>{children}</SessionProvider>
    </OidcProvider>
  );
}

interface Session {
  /** The session ended while the console was open; the sign-in screen says so. */
  expired: boolean;
  /** Ends a session that can no longer be renewed: the user has to sign in again. */
  expire: () => void;
}

const SessionContext = createContext<Session | null>(null);

function SessionProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { removeUser } = auth;
  const [expired, setExpired] = useState(false);
  const expire = useCallback(() => {
    setExpired(true);
    void removeUser();
  }, [removeUser]);
  // Background renewal failed and the token has now run out (e.g. the session ended in Keycloak).
  useEffect(() => auth.events.addAccessTokenExpired(expire), [auth.events, expire]);
  const value = useMemo(() => ({ expired, expire }), [expired, expire]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession must be used inside <AuthProvider>');
  return session;
}
