import type { Price } from '@/lib/api/types';

export const strategyLabel = (p: Pick<Price, 'strategy' | 'markupPercent'>) =>
  p.strategy === 'FIXED_RATE' ? 'Fixed rate' : `Markup +${p.markupPercent}%`;
