'use client';

import { Table, type TableColumnsType } from 'antd';
import { useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { AuditLog as AuditEntry } from '@/lib/api/types';
import { useAdminFormat } from './use-admin-format';

export function AuditLog({ entries, loading }: { entries: AuditEntry[]; loading: boolean }) {
  const t = useTranslations('admin.audit');
  const tCommon = useTranslations('common');
  const enums = useEnumLabel();
  const { dateTime } = useAdminFormat();

  const detail = (entry: AuditEntry) => {
    const after = entry.after || {};
    if (entry.action === 'PRICING_VERSION_CREATE')
      return t('pricingDetail', {
        version: String(after.version),
        strategy: enums.label('strategy', String(after.strategy)),
      });
    if (entry.action === 'MODEL_UPDATE')
      return t('modelDetail', {
        enabled: String(after.enabled),
        roles: (after.allowedRoles as string[] | undefined)?.join('/') || '—',
      });
    if (entry.action === 'MODEL_PERMISSION_UPDATE')
      return t('permissionDetail', { model: String(after.modelId), allowed: String(Boolean(after.allowed)) });
    return '';
  };

  const columns: TableColumnsType<AuditEntry> = [
    {
      key: 'time',
      title: t('time'),
      className: 'whitespace-nowrap',
      render: (_, entry) => dateTime(entry.createdAt),
    },
    { key: 'actor', title: t('actor'), render: (_, entry) => entry.actor?.username || tCommon('system') },
    { key: 'action', title: t('action'), render: (_, entry) => enums.label('auditAction', entry.action) },
    {
      key: 'entity',
      title: t('entity'),
      render: (_, entry) => (
        <>
          {enums.label('entityType', entry.entityType)}
          <div className="font-mono text-[10px] text-fg-tertiary">{entry.entityId}</div>
        </>
      ),
    },
    { key: 'change', title: t('change'), render: (_, entry) => detail(entry) },
  ];

  return (
    <SectionCard flush title={t('title')} description={t('note')}>
      <Table<AuditEntry>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={entries}
        loading={loading}
        locale={{ emptyText: t('empty') }}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </SectionCard>
  );
}
