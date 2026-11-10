import { consoleConfig } from '@/lib/runtime-config';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** vendor-control's error body is `{ error: { type, message } }`. */
function errorMessage(body: unknown): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' ? message : undefined;
}

/**
 * A call to vendor-control's admin API (`/admin/*`) through `fetch`, which adds the staff token.
 * Resolves to the JSON body; a failed call rejects with an ApiError carrying vendor-control's message.
 */
export async function adminRequest<Data>(
  fetch: (request: Request) => Promise<Response>,
  path: string,
  init: RequestInit = {},
): Promise<Data> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(new Request(`${consoleConfig().vendorControlUrl}/admin${path}`, { ...init, headers }));
  } catch {
    throw new ApiError("vendor-control can't be reached. Check that the platform is running.", 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(errorMessage(body) ?? `Request failed (${response.status})`, response.status);
  return body as Data;
}
