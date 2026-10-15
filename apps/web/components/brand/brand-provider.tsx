'use client';

import { createContext, use, type ReactNode } from 'react';
import type { BrandConfig } from '@/types/brand';

const BrandContext = createContext<BrandConfig | null>(null);

/** Receives the brand from the root layout (getBrand()), so components never import a brand directly. */
export function BrandProvider({ brand, children }: { brand: BrandConfig; children: ReactNode }) {
  return <BrandContext value={brand}>{children}</BrandContext>;
}

export function useBrand(): BrandConfig {
  const brand = use(BrandContext);
  if (!brand) throw new Error('useBrand must be used inside <BrandProvider>');
  return brand;
}
