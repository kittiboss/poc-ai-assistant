import createClient from 'openapi-fetch';
import type { paths } from './schema';

/** The API including its global `/api` prefix, as configured for the other NEXT_PUBLIC_* values. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// Paths in the OpenAPI document already start with /api.
const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(fetch: (request: Request) => Promise<Response>) {
  return createClient<paths>({ baseUrl: API_ORIGIN, fetch });
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
