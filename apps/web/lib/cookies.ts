const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/** Client-side helpers for preference cookies that the server also reads. */
export function setCookie(name: string, value: string, maxAge = ONE_YEAR_IN_SECONDS) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function getCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
  return entry === undefined ? undefined : decodeURIComponent(entry.slice(prefix.length));
}
