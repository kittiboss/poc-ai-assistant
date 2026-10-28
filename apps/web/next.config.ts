import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Reads the request config from i18n/request.ts
const withNextIntl = createNextIntlPlugin();

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // The development-only indicator would cover the account menu at the bottom of the sidebar.
  devIndicators: { position: 'bottom-right' },
  // Only nudge coding agents about Next.js security upgrades.
  experimental: { agentUpgrade: 'security' },
};
export default withNextIntl(config);
