'use client';
import { AuthProvider as OidcProvider } from 'react-oidc-context';
import { runtimeConfig } from '@/lib/runtime-config';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { keycloakUrl, keycloakRealm, oidcClientId } = runtimeConfig();
  const authority = `${keycloakUrl}/realms/${keycloakRealm}`;
  const redirectUri = typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin;
  return (
    <OidcProvider
      authority={authority}
      client_id={oidcClientId}
      redirect_uri={redirectUri}
      post_logout_redirect_uri={redirectUri}
      response_type="code"
      scope="openid profile email"
      automaticSilentRenew
      onSigninCallback={() => {
        if (typeof window !== 'undefined') window.history.replaceState({}, document.title, window.location.pathname);
      }}
    >
      {children}
    </OidcProvider>
  );
}
