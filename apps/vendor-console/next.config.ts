import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // The development-only indicator would cover the bottom of the sidebar.
  devIndicators: { position: 'bottom-right' },
  // Only nudge coding agents about Next.js security upgrades.
  experimental: { agentUpgrade: 'security' },
};
export default config;
