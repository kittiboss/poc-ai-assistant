'use client';

import { Card } from 'antd';
import { cn } from '@/lib/cn';

/**
 * A titled AntD Card. `flush` is for tables: the header gets a divider and the content runs to
 * the card's edges.
 */
export function SectionCard({
  title,
  description,
  extra,
  flush = false,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Shown at the end of the header, e.g. a select */
  extra?: React.ReactNode;
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const hasHeader = title !== undefined || extra !== undefined;
  return (
    <Card
      className={cn('shadow-sm', flush && 'overflow-hidden', className)}
      styles={{ body: { padding: flush ? 0 : 20 } }}
    >
      {hasHeader && (
        <div
          className={cn(
            'flex flex-wrap items-end justify-between gap-3',
            flush ? 'border-b border-line-secondary p-5' : 'mb-4',
          )}
        >
          <div className="min-w-0">
            {title && <h2 className="font-semibold">{title}</h2>}
            {description && <p className="text-xs text-fg-secondary">{description}</p>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </Card>
  );
}
