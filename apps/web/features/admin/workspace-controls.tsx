'use client';

import { Alert } from 'antd';
import { useTranslations } from 'next-intl';
import type { AdminModel } from '@/lib/api/types';
import { DepartmentSection } from './department-section';
import { FeedbackSection } from './feedback-section';
import { PromptTemplates } from './prompt-templates';
import { QuotaSection } from './quota-section';
import { useWorkspace } from './workspace-queries';
import { WorkspacePolicy } from './workspace-policy';

/** Governance for the whole workspace: external access, retention, quotas, departments, templates and feedback. */
export function WorkspaceControls({ models }: { models: AdminModel[] }) {
  const t = useTranslations('admin.workspace');
  const { dashboard, templates } = useWorkspace();
  const data = dashboard.data;
  const error = dashboard.error ?? templates.error;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm text-fg-secondary">{t('intro')}</p>
      </div>
      {error && <Alert type="error" showIcon title={error.message} />}
      {/* Keyed by the saved form fields, so the form shows them after a save; the kill switch alone keeps edits. */}
      {data && (
        <WorkspacePolicy
          key={`${data.settings.sensitiveMode}:${data.settings.retentionDays}`}
          settings={data.settings}
        />
      )}
      <QuotaSection dashboard={data} models={models} loading={dashboard.isPending} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DepartmentSection dashboard={data} loading={dashboard.isPending} />
        <FeedbackSection dashboard={data} models={models} loading={dashboard.isPending} />
      </div>
      <PromptTemplates templates={templates.data ?? []} models={models} loading={templates.isPending} />
    </section>
  );
}
