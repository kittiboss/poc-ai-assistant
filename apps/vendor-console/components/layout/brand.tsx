import { Tag } from 'antd';
import { cn } from '@/lib/cn';

/** The console's logo and name, with a reminder that credits and invoices here are simulated. */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <div className={cn('flex min-w-0 items-center', lg ? 'gap-3' : 'gap-2.5')}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small SVG needs no optimization */}
      <img src="/icon.svg" alt="" width={lg ? 40 : 28} height={lg ? 40 : 28} />
      <div className="min-w-0 leading-tight">
        <div className={cn('truncate font-semibold', lg && 'text-lg')}>Vendor Console</div>
        <Tag variant="filled" color="warning" className="me-0 mt-0.5 text-[10px] leading-4">
          Simulation
        </Tag>
      </div>
    </div>
  );
}
