'use client';

import { App, Checkbox, Table, type TableColumnsType } from 'antd';
import { useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import type { AdminModel, AdminUser } from '@/lib/api/types';
import { useAdminMutations } from './admin-queries';

export function UserPermissions({
  users,
  models,
  loading,
}: {
  users: AdminUser[];
  models: AdminModel[];
  loading: boolean;
}) {
  const t = useTranslations('admin');
  const { message } = App.useApp();
  const { setPermission } = useAdminMutations();

  const change = async (user: AdminUser, model: AdminModel, allowed: boolean) => {
    try {
      await setPermission.mutateAsync({ userId: user.id, modelId: model.id, allowed });
      message.success(t('permissionUpdated'));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };

  const columns: TableColumnsType<AdminUser> = [
    {
      key: 'user',
      title: t('permissions.user'),
      render: (_, user) => (
        <>
          <span className="font-medium">{user.username}</span>
          <div className="text-xs text-fg-tertiary">{user.roles.map((role) => role.role.name).join(', ')}</div>
        </>
      ),
    },
    ...models.map((model) => ({
      key: model.id,
      title: model.displayName,
      render: (_: unknown, user: AdminUser) => {
        const explicit = user.modelPermissions.find((item) => item.modelId === model.id);
        // An explicit choice overrides the model's role defaults.
        const checked =
          explicit?.allowed ?? model.allowedRoles.some((role) => user.roles.some((value) => value.role.name === role));
        return (
          <Checkbox checked={checked} onChange={(event) => change(user, model, event.target.checked)}>
            <span className="text-xs">{explicit ? t('permissions.explicit') : t('permissions.roleDefault')}</span>
          </Checkbox>
        );
      },
    })),
  ];

  return (
    <SectionCard flush title={t('permissions.title')} description={t('permissions.note')}>
      <Table<AdminUser>
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </SectionCard>
  );
}
