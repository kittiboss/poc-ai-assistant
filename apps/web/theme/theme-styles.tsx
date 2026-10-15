'use client';

import { useMemo } from 'react';
import { useBrand } from '@/components/brand/brand-provider';
import { buildThemeCss } from './css-vars';

/** Emits the --app-* variables of both modes for the active brand. */
export function ThemeStyles() {
  const brand = useBrand();
  const css = useMemo(() => buildThemeCss(brand), [brand]);
  return (
    <style href={`app-theme-${brand.id}`} precedence="default">
      {css}
    </style>
  );
}
