import localFont from 'next/font/local';
import type { BrandFontKey } from './font-families';

// Font files are committed (SIL OFL, see theme/fonts/*/OFL.txt) so builds at a customer site
// need no internet access. Each face is limited to its script with unicode-range, and the
// metric-adjusted Arial fallback is disabled so uncovered characters use the system font.
// next/font only accepts literal option values, so the ranges are written out in each call.
const notoSansThai = localFont({
  src: './fonts/noto-sans-thai/noto-sans-thai-thai-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-noto-sans-thai',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0E01-0E5B, U+200C-200D, U+25CC' }],
});

const ibmPlexSansThai = localFont({
  src: [
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-thai-400-normal.woff2', weight: '400' },
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-thai-500-normal.woff2', weight: '500' },
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-thai-600-normal.woff2', weight: '600' },
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-thai-700-normal.woff2', weight: '700' },
  ],
  variable: '--font-ibm-plex-sans-thai',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0E01-0E5B, U+200C-200D, U+25CC' }],
});

const ibmPlexSansThaiLatin = localFont({
  src: [
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-latin-400-normal.woff2', weight: '400' },
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-latin-500-normal.woff2', weight: '500' },
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-latin-600-normal.woff2', weight: '600' },
    { path: './fonts/ibm-plex-sans-thai/ibm-plex-sans-thai-latin-700-normal.woff2', weight: '700' },
  ],
  variable: '--font-ibm-plex-sans-thai-latin',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

/** Class names that define each brand font's CSS variables; only the active brand's are applied. */
export const brandFontClassNames: Record<BrandFontKey, string> = {
  notoSansThai: notoSansThai.variable,
  ibmPlexSansThai: `${ibmPlexSansThai.variable} ${ibmPlexSansThaiLatin.variable}`,
};
