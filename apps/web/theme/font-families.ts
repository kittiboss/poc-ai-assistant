/** Used for every character a brand font does not cover; the app's original font stack. */
const SYSTEM_SANS =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";

/**
 * CSS families of the fonts bundled in fonts.ts, by the key a brand config names.
 * Kept apart from fonts.ts so client code can build the stack without loading font files.
 */
const brandFontFamilies = {
  // Thai glyphs only; Latin text keeps the system font.
  notoSansThai: 'var(--font-noto-sans-thai)',
  ibmPlexSansThai: 'var(--font-ibm-plex-sans-thai), var(--font-ibm-plex-sans-thai-latin)',
} as const;

export type BrandFontKey = keyof typeof brandFontFamilies;

export function fontStack(font: BrandFontKey): string {
  return `${brandFontFamilies[font]}, ${SYSTEM_SANS}`;
}
