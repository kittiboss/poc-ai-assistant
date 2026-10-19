'use client';

import { App, Checkbox, Switch, Table, Tooltip, type TableColumnsType } from 'antd';
import { useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { AdminModel, UpdateModel } from '@/lib/api/types';
import { useAdminMutations } from './admin-queries';

type Role = NonNullable<UpdateModel['allowedRoles']>[number];
const roles: Role[] = ['USER', 'ADMIN'];

export function ModelRegistry({ models, loading }: { models: AdminModel[]; loading: boolean }) {
  const t = useTranslations('admin.registry');
  const tAdmin = useTranslations('admin');
  const enums = useEnumLabel();
  const { message } = App.useApp();
  const { updateModel } = useAdminMutations();
  const busy = (model: AdminModel) => updateModel.isPending && updateModel.variables?.id === model.id;

  const update = async (model: AdminModel, change: UpdateModel) => {
    try {
      await updateModel.mutateAsync({ id: model.id, change });
      message.success(tAdmin('modelUpdated', { model: model.displayName }));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };

  const columns: TableColumnsType<AdminModel> = [
    {
      key: 'model',
      title: t('model'),
      render: (_, model) => (
        <>
          <div className="font-medium">{model.displayName}</div>
          <div className="font-mono text-[11px] text-fg-tertiary">{model.id}</div>
        </>
      ),
    },
    { key: 'provider', title: t('provider'), dataIndex: 'provider' },
    {
      key: 'location',
      title: t('location'),
      render: (_, model) => (
        <StatusTag tone={model.local ? 'success' : 'warning'}>
          {enums.label('location', model.local ? 'LOCAL' : 'EXTERNAL')}
        </StatusTag>
      ),
    },
    {
      key: 'availability',
      title: t('availability'),
      render: (_, model) => (
        <StatusTag
          tone={model.status === 'Available' ? 'success' : model.status === 'Ready (disabled)' ? 'neutral' : 'error'}
        >
          {enums.modelStatus(model.status)}
        </StatusTag>
      ),
    },
    {
      key: 'enabled',
      title: t('enabled'),
      render: (_, model) => (
        <Tooltip title={!model.configured ? t('notConfigured') : undefined}>
          <Switch
            checked={model.enabled}
            loading={busy(model)}
            disabled={!model.enabled && !model.configured}
            aria-label={t(model.enabled ? 'disable' : 'enable', { model: model.displayName })}
            onChange={(enabled) => update(model, { enabled })}
          />
        </Tooltip>
      ),
    },
    {
      key: 'allowedRoles',
      title: t('allowedRoles'),
      render: (_, model) => (
        <Checkbox.Group
          options={roles}
          value={model.allowedRoles}
          disabled={busy(model)}
          onChange={(allowedRoles) => update(model, { allowedRoles: allowedRoles as Role[] })}
        />
      ),
    },
  ];

  return (
    <SectionCard flush title={t('title')} description={t('note')}>
      <Table<AdminModel>
        rowKey="id"
        columns={columns}
        dataSource={models}
        loading={loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </SectionCard>
  );
}
