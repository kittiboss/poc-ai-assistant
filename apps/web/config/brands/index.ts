import type { BrandConfig } from '@/types/brand';
import { acmeBrand } from './acme';
import { defaultBrand } from './default';

const brands = {
  default: defaultBrand,
  acme: acmeBrand,
} satisfies Record<string, BrandConfig>;

type BrandId = keyof typeof brands;

const requested = process.env.NEXT_PUBLIC_BRAND || 'default';

function isBrandId(value: string): value is BrandId {
  return Object.hasOwn(brands, value);
}

// Fail the build instead of silently shipping another customer's brand.
if (!isBrandId(requested)) {
  throw new Error(`Unknown NEXT_PUBLIC_BRAND "${requested}". Available: ${Object.keys(brands).join(', ')}.`);
}

const brand: BrandConfig = brands[requested];

/**
 * The brand of this installation, chosen at build time with NEXT_PUBLIC_BRAND.
 * The only way to read it: the root layout calls this and hands the result to <BrandProvider>,
 * client components use useBrand(). Loading it at runtime later only changes this function.
 */
export function getBrand(): BrandConfig {
  return brand;
}
