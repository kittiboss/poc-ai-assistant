import type { BrandConfig } from '@/types/brand';

/** Fictional customer used to show that a brand changes everything it should. Build with NEXT_PUBLIC_BRAND=acme. */
export const acmeBrand: BrandConfig = {
  id: 'acme',
  name: 'ACME Assistant',
  organization: 'ACME Corporation',
  logo: { icon: '/brands/acme/icon.svg' },
  favicon: '/brands/acme/icon.svg',
  defaultLocale: 'th',
  theme: {
    defaultMode: 'system',
    colorPrimary: '#0d9488',
    borderRadius: 4,
    font: 'ibmPlexSansThai',
  },
};
