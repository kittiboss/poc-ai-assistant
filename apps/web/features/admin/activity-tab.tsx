'use client';
import { Alert } from 'antd';
import { useAdminAudit, useAdminModels } from './admin-queries';
import { AuditLog } from './audit-log';
import { FeedbackSection } from './feedback-section';
import { useWorkspaceDashboard } from './workspace-queries';

/** What users said about answers and what admins changed. */
export function ActivityTab() {
  const models = useAdminModels();
  const dashboard = useWorkspaceDashboard();
  const audit = useAdminAudit();
  const loadError = [models, dashboard, audit].find((query) => query.error)?.error?.message;

  return (
    <>
      {loadError && <Alert type="error" showIcon title={loadError} />}
      <FeedbackSection dashboard={dashboard.data} models={models.data ?? []} loading={dashboard.isPending} />
      <AuditLog entries={audit.data ?? []} loading={audit.isPending} />
    </>
  );
}
