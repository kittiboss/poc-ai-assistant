'use client';

import { Tag } from 'antd';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'success' | 'error' | 'warning' | 'primary';

const presetColors: Partial<Record<Tone, string>> = { success: 'success', error: 'error', warning: 'warning' };

/** Pill-shaped AntD Tag in the app's status colors; `primary` follows the brand. */
export function StatusTag({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      variant="filled"
      color={presetColors[tone]}
      className={cn(
        'me-0 rounded-full text-[11px] font-semibold',
        tone === 'primary' && 'bg-primary-soft text-primary-text',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Real token counts, synthetic ones (mock) and estimates look different everywhere usage is shown. */
export const usageKindTone = (kind: string): Tone =>
  kind === 'ACTUAL' ? 'success' : kind === 'SYNTHETIC' ? 'primary' : 'warning';
