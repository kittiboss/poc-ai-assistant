'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { createAuthFetch } from '@/lib/api/auth-fetch';
import { API_URL, ApiError, createApiClient, errorMessage, type ApiClient } from '@/lib/api/client';
import { useUIStore } from '@/stores/ui-store-provider';

interface ApiContextValue {
  client: ApiClient;
  /** fetch with the same token handling, for the streaming endpoint */
  fetch: (request: Request) => Promise<Response>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

/**
 * One API client for the signed-in user. Requests carry the current token; a refused token is
 * renewed once, and when that fails the user is signed out and the sign-in screen explains why.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const setSessionExpired = useUIStore((state) => state.setSessionExpired);
  const { removeUser, signinSilent } = auth;
  const token = auth.user?.access_token;

  const expireSession = useCallback(() => {
    setSessionExpired(true);
    void removeUser();
  }, [removeUser, setSessionExpired]);

  // Recreated when the token changes; creating a client is cheap and requests in flight keep theirs.
  const value = useMemo<ApiContextValue>(() => {
    const fetch = createAuthFetch({
      getToken: () => token,
      renew: async () => (await signinSilent())?.access_token,
      onSessionExpired: expireSession,
    });
    return { client: createApiClient(fetch), fetch };
  }, [token, signinSilent, expireSession]);

  // Automatic renewal failed and the token has now run out (e.g. after a long idle period).
  useEffect(() => auth.events.addAccessTokenExpired(expireSession), [auth.events, expireSession]);

  return (
    <ApiContext value={value}>
      {/* A new cache per user, so nothing from one session shows up in the next. */}
      <QueryProvider key={auth.user?.profile.sub ?? 'signed-out'}>{children}</QueryProvider>
    </ApiContext>
  );
}

function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Client errors (bad id, no permission, expired session) won't succeed on retry.
            retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * The typed API client plus `unwrap`, which turns an error response into an ApiError, and
 * `request` for the workspace endpoints whose responses the OpenAPI document does not describe yet.
 */
export function useApi() {
  const context = use(ApiContext);
  if (!context) throw new Error('useApi must be used inside <ApiProvider>');
  const t = useTranslations('errors');
  const unwrap = useCallback(
    <Data,>(result: { data?: Data; error?: unknown; response: Response }): Data => {
      if (result.error !== undefined || !result.response.ok) {
        const { status } = result.response;
        throw new ApiError(errorMessage(result.error) ?? t('requestFailed', { status }), status);
      }
      return result.data as Data;
    },
    [t],
  );
  const { fetch } = context;
  const request = useCallback(
    async <Data,>(path: string, init: RequestInit = {}): Promise<Data> => {
      const headers = new Headers(init.headers);
      if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
      const response = await fetch(new Request(`${API_URL}${path}`, { ...init, headers }));
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new ApiError(errorMessage(body) ?? t('requestFailed', { status: response.status }), response.status);
      }
      return (response.status === 204 ? undefined : await response.json()) as Data;
    },
    [fetch, t],
  );
  return { ...context, unwrap, request };
}
