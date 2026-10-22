import createClient from 'openapi-fetch';
import { runtimeConfig } from '@/lib/runtime-config';
import type { paths } from './schema';

/** The API including its global `/api` prefix, as configured for this deployment (see runtime-config.ts). */
export const apiUrl = () => runtimeConfig().apiUrl;

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(fetch: (request: Request) => Promise<Response>) {
  // Paths in the OpenAPI document already start with /api.
  return createClient<paths>({ baseUrl: apiUrl().replace(/\/api\/?$/, ''), fetch });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API's error body is `{ message: string | string[] }`. */
export function errorMessage(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : undefined;
}
