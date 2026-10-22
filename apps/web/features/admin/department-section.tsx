'use client';

import { App, Input, Table, type TableColumnsType } from 'antd';
import { useFormatter, useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { costFormat } from '@/i18n/formats';
import { runtimeConfig } from '@/lib/runtime-config';
import { useWorkspaceMutations, type WorkspaceDashboard } from './workspace-queries';

type User = WorkspaceDashboard['users'][number];
type DepartmentUsage = WorkspaceDashboard['departmentUsage'][number];

export function DepartmentSection({ dashboard, loading }: { dashboard?: WorkspaceDashboard; loading: boolean }) {
  const t = useTranslations('admin.workspace.departments');
  const format = useFormatter();
  const { message } = App.useApp();
  const { setDepartment } = useWorkspaceMutations();

  const save = async (user: User, value: string) => {
    const department = value.trim();
    if (department === user.department) return;
    try {
      await setDepartment.mutateAsync({ userId: user.id, department });
      message.success(t('saved', { user: user.username }));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };

  const userColumns: TableColumnsType<User> = [
    { key: 'user', title: t('user'), render: (_, user) => <span className="font-medium">{user.username}</span> },
    {
      key: 'department',
      title: t('department'),
      render: (_, user) => (
        // Keyed by the saved value, so the field shows it again after a refresh.
        <Input
          key={`${user.id}:${user.department}`}
          size="small"
          defaultValue={user.department}
          maxLength={120}
          placeholder={t('placeholder')}
          aria-label={t('departmentOf', { user: user.username })}
          onBlur={(event) => void save(user, event.target.value)}
          onPressEnter={(event) => event.currentTarget.blur()}
          className="min-w-40"
        />
      ),
    },
  ];
  const usageColumns: TableColumnsType<DepartmentUsage> = [
    {
      key: 'department',
      title: t('department'),
      render: (_, row) => row.department || <span className="text-fg-tertiary">{t('none')}</span>,
    },
    { key: 'requests', title: t('requests'), render: (_, row) => format.number(row._count) },
    { key: 'tokens', title: t('tokens'), render: (_, row) => format.number(row._sum.totalTokens ?? 0) },
    {
      key: 'cost',
      title: t('simulatedCost'),
      className: 'whitespace-nowrap',
      render: (_, row) => format.number(Number(row._sum.simulatedProviderCost ?? 0), costFormat('USD', 2, 6)),
    },
  ];

  return (
    <SectionCard title={t('title')} description={t('note')}>
      <Table<User>
        rowKey="id"
        size="small"
        columns={userColumns}
        dataSource={dashboard?.users}
        loading={loading}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
      <h3 className="mt-5 mb-2 text-sm font-semibold">{t('today')}</h3>
      <Table<DepartmentUsage>
        rowKey={(row) => row.department}
        size="small"
        columns={runtimeConfig().vendorManaged ? usageColumns.filter((column) => column.key !== 'cost') : usageColumns}
        dataSource={dashboard?.departmentUsage}
        loading={loading}
        locale={{ emptyText: t('noUsage') }}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </SectionCard>
  );
}
