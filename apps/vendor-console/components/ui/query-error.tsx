'use client';

import { Alert, Button } from 'antd';

/** A failed load, with vendor-control's reason. Data loaded before stays on the page below it. */
export function QueryError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      title={error.message}
      action={
        onRetry && (
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}
