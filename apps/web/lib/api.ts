'use client';
import { useTranslations } from 'next-intl';
import { useAuth } from 'react-oidc-context';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export function useApi() {
  const auth = useAuth();
  const t = useTranslations('errors');
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.user?.access_token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      throw new Error(
        Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message || t('requestFailed', { status: response.status }),
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  return { request, accessToken: auth.user?.access_token, apiBase: API };
}
