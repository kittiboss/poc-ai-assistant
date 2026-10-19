'use client';

import { Table, type TableColumnsType } from 'antd';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag } from '@/components/ui/status-tag';
import { dateTimeFormat } from '@/i18n/formats';
import type { AdminModel } from '@/lib/api/types';
import type { WorkspaceDashboard } from './workspace-queries';

type Feedback = WorkspaceDashboard['recentFeedback'][number];

export function FeedbackSection({
  dashboard,
  models,
  loading,
}: {
  dashboard?: WorkspaceDashboard;
  models: AdminModel[];
  loading: boolean;
}) {
  const t = useTranslations('admin.workspace.feedback');
  const format = useFormatter();
  const modelName = (id: string) => models.find((model) => model.id === id)?.displayName ?? id;
  const rating = (value: 1 | -1) =>
    value === 1 ? (
      <ThumbsUp size={14} className="text-success" aria-label={t('helpful')} />
    ) : (
      <ThumbsDown size={14} className="text-error" aria-label={t('unhelpful')} />
    );
  // One line per model: how many replies were rated each way.
  const totals = [...new Set(dashboard?.feedback.map((row) => row.modelId))].map((modelId) => {
    const count = (value: 1 | -1) =>
      dashboard?.feedback.find((row) => row.modelId === modelId && row.feedback === value)?._count ?? 0;
    return { modelId, up: count(1), down: count(-1) };
  });

  const columns: TableColumnsType<Feedback> = [
    {
      key: 'time',
      title: t('time'),
      className: 'whitespace-nowrap',
      render: (_, row) => format.dateTime(new Date(row.updatedAt), dateTimeFormat),
    },
    { key: 'model', title: t('model'), render: (_, row) => modelName(row.modelId) },
    { key: 'rating', title: t('rating'), render: (_, row) => rating(row.feedback) },
    {
      key: 'comment',
      title: t('comment'),
      render: (_, row) => row.feedbackComment || <span className="text-fg-tertiary">{t('noComment')}</span>,
    },
  ];

  return (
    <SectionCard title={t('title')} description={t('note')}>
      {totals.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {totals.map((row) => (
            <StatusTag key={row.modelId} tone="neutral" className="flex items-center gap-2">
              {modelName(row.modelId)}
              <span className="flex items-center gap-1">
                <ThumbsUp size={12} className="text-success" aria-label={t('helpful')} />
                {format.number(row.up)}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsDown size={12} className="text-error" aria-label={t('unhelpful')} />
                {format.number(row.down)}
              </span>
            </StatusTag>
          ))}
        </div>
      )}
      <Table<Feedback>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={dashboard?.recentFeedback}
        loading={loading}
        locale={{ emptyText: t('empty') }}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </SectionCard>
  );
}
