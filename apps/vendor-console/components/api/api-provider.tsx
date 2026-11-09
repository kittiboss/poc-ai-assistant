'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, use, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { useSession } from '@/components/auth/auth-provider';
import { createAuthFetch } from '@/lib/api/auth-fetch';
import { adminRequest, ApiError } from '@/lib/api/client';

type AdminRequest = <Data>(path: string, init?: RequestInit) => Promise<Data>;

const ApiContext = createContext<AdminRequest | null>(null);

/**
 * Calls to vendor-control's admin API as the signed-in staff member. A refused token is renewed
 * once; when that fails too, the session ends and the sign-in screen says so.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { expire } = useSession();
  const { signinSilent } = auth;
  const token = auth.user?.access_token;

  // Recreated when the token changes; requests in flight keep theirs.
  const request = useMemo<AdminRequest>(() => {
    const fetch = createAuthFetch({
      getToken: () => token,
      renew: async () => (await signinSilent())?.access_token,
      onSessionExpired: expire,
    });
    return (path, init) => adminRequest(fetch, path, init);
  }, [token, signinSilent, expire]);

  return (
    <ApiContext value={request}>
      {/* A new cache per account, so nothing from one session shows up in the next. */}
      <QueryProvider key={auth.user?.profile.sub ?? 'signed-out'}>{children}</QueryProvider>
    </ApiContext>
  );
}

function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            // Refused or unknown requests (4xx) won't succeed on retry; an outage might.
            retry: (failures, error) =>
              !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** `request(path, init)` for `/admin${path}` on vendor-control. */
export function useAdminRequest(): AdminRequest {
  const request = use(ApiContext);
  if (!request) throw new Error('useAdminRequest must be used inside <ApiProvider>');
  return request;
}
