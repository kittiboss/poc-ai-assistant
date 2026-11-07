'use client';

import { Empty } from 'antd';

/** Stands in for a page whose content is built in a later step. */
export function PagePlaceholder({ description }: { description: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <Empty description={description} />
    </div>
  );
}
