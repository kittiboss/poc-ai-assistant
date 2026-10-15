import { getBrand } from '@/config/brands';

// Browsers still request /favicon.ico now and then (e.g. while the head is replaced during a
// refresh), even with a <link rel="icon">. Point them at the brand's icon; 307 so a later
// rebrand is not stuck in their cache. The Location is relative because behind a proxy or in
// the standalone server the request URL's host is not the one the browser used.
export function GET() {
  return new Response(null, { status: 307, headers: { Location: getBrand().favicon } });
}
