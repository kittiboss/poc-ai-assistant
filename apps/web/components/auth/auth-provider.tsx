'use client';
import { AuthProvider as OidcProvider } from 'react-oidc-context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authority = `${process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080'}/realms/${process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'enterprise-ai'}`;
  const redirectUri = typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin;
  return (
    <OidcProvider
      authority={authority}
      client_id={process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'enterprise-ai-web'}
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
