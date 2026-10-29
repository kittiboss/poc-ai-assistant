'use client';

import { Alert, Button } from 'antd';
import { BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { runtimeConfig } from '@/lib/runtime-config';
import { useAdminModels } from './admin-queries';
import { DepartmentSection } from './department-section';
import { KnowledgePanel } from './knowledge-panel';
import { PromptTemplates } from './prompt-templates';
import { QuotaSection } from './quota-section';
import { usePromptTemplates, useWorkspaceDashboard } from './workspace-queries';
import { WorkspacePolicy } from './workspace-policy';

/** Governance for the whole workspace: external access, retention, quotas, departments, templates and the product catalog. */
export function WorkspaceTab() {
  const t = useTranslations('admin.workspace');
  const vendor = runtimeConfig().vendorManaged;
  const models = useAdminModels();
  const dashboard = useWorkspaceDashboard();
  const templates = usePromptTemplates();
  const data = dashboard.data;
  const modelList = models.data ?? [];
  const error = dashboard.error ?? templates.error ?? models.error;

  return (
    <>
      <p className="text-sm text-fg-secondary">{t('intro')}</p>
      {error && <Alert type="error" showIcon title={error.message} />}
      {/* Keyed by the saved form fields, so the form shows them after a save; the kill switch alone keeps edits. */}
      {data && (
        <WorkspacePolicy
          key={`${data.settings.sensitiveMode}:${data.settings.retentionDays}`}
          settings={data.settings}
        />
      )}
      <QuotaSection dashboard={data} models={modelList} loading={dashboard.isPending} />
      <DepartmentSection dashboard={data} loading={dashboard.isPending} />
      <PromptTemplates templates={templates.data ?? []} models={modelList} loading={templates.isPending} />
      {vendor ? <KnowledgeBaseLink /> : <KnowledgePanel refreshKey={models.data} />}
    </>
  );
}

/** Vendor-managed deployments keep their documents in the central knowledge base, on its own page. */
function KnowledgeBaseLink() {
  const t = useTranslations('admin.knowledge');
  return (
    <SectionCard
      title={t('centralTitle')}
      description={t('centralDescription')}
      extra={
        <Link href="/knowledge">
          <Button icon={<BookOpen size={16} />}>{t('centralOpen')}</Button>
        </Link>
      }
    >
      {null}
    </SectionCard>
  );
}
