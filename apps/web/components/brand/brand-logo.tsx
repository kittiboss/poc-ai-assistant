'use client';

import Image from 'next/image';
import { cn } from '@/lib/cn';
import { useBrand } from './brand-provider';

/** The brand's square mark. Pass `decorative` when the product name is shown next to it. */
export function BrandLogo({
  size = 36,
  decorative = false,
  className,
}: {
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  const brand = useBrand();
  return (
    <Image
      src={brand.logo.icon}
      alt={decorative ? '' : brand.name}
      width={size}
      height={size}
      // SVG marks are served as they are; a runtime brand may also point at another host.
      unoptimized
      className={cn('shrink-0', className)}
    />
  );
}
