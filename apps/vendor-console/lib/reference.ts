/**
 * An idempotency reference for a credit grant: vendor-control records a grant once per reference,
 * so sending the same one again (a retry, a double click) cannot add the credit twice.
 * getRandomValues also works outside a secure context, unlike crypto.randomUUID.
 */
export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `console-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
