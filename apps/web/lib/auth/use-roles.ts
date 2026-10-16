'use client';

import { useMemo } from 'react';
import { useAuth } from 'react-oidc-context';

/**
 * Realm roles from the access token. Keycloak puts `realm_access` in the access token only, not in
 * the ID token profile. Used for showing UI; the API checks roles itself.
 */
export function useRoles(): string[] {
  const token = useAuth().user?.access_token;
  return useMemo(() => {
    if (!token) return [];
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
      const claims = JSON.parse(new TextDecoder().decode(bytes)) as { realm_access?: { roles?: string[] } };
      return claims.realm_access?.roles ?? [];
    } catch {
      return [];
    }
  }, [token]);
}
