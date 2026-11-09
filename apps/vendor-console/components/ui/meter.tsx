'use client';

import { Progress, theme } from 'antd';
import { formatNumber } from '@/lib/format';

/** Usage against a limit, with its numbers: amber from 80% of the limit, red at it. */
export function Meter({
  used,
  limit,
  format = formatNumber,
  note,
  label,
}: {
  used: number;
  limit: number;
  format?: (value: number) => string;
  note?: string;
  /** What is measured, for screen readers */
  label: string;
}) {
  const { token } = theme.useToken();
  const share = limit > 0 ? used / limit : 1;
  const color = share >= 1 ? token.colorError : share >= 0.8 ? token.colorWarning : token.colorPrimary;
  return (
    <div className="min-w-32">
      <Progress
        percent={Math.min(share, 1) * 100}
        showInfo={false}
        size="small"
        strokeColor={color}
        className="m-0! block!"
        aria-label={label}
      />
      <div className="text-xs text-fg-secondary tabular-nums">
        {format(used)} / {format(limit)}
        {note}
      </div>
    </div>
  );
}
