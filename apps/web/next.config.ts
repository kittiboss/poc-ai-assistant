import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Reads the request config from i18n/request.ts
const withNextIntl = createNextIntlPlugin();

const config: NextConfig = { output: 'standalone', poweredByHeader: false };
export default withNextIntl(config);
