interface AuthFetchOptions {
  /** The current access token */
  getToken: () => string | undefined;
  /** Gets a fresh token from the identity provider; rejects or resolves empty when the session is over */
  renew: () => Promise<string | undefined>;
  /** Called once a request is refused even after renewing: the user has to sign in again */
  onSessionExpired: () => void;
}

/**
 * fetch with the bearer token. On 401 it renews the token once (shared by concurrent requests)
 * and repeats the request; if that is refused too, the session is treated as expired.
 */
export function createAuthFetch({ getToken, renew, onSessionExpired }: AuthFetchOptions) {
  let renewing: Promise<string | undefined> | null = null;
  const renewOnce = () => {
    renewing ??= renew()
      .catch(() => undefined)
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };

  const send = (request: Request, token: string | undefined) => {
    const headers = new Headers(request.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(new Request(request, { headers }));
  };

  return async function authFetch(request: Request): Promise<Response> {
    // A copy with an unread body, in case the request has to be sent again.
    const retry = request.clone();
    const response = await send(request, getToken());
    if (response.status !== 401) return response;
    const token = await renewOnce();
    if (!token) {
      onSessionExpired();
      return response;
    }
    const second = await send(retry, token);
    if (second.status === 401) onSessionExpired();
    return second;
  };
}
