'use client';

import { App, Button, Form, Input, InputNumber, Popconfirm, Select, Table, type TableColumnsType } from 'antd';
import { useFormatter, useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { costFormat } from '@/i18n/formats';
import type { AdminModel } from '@/lib/api/types';
import {
  quotaScopes,
  templateRoles,
  useWorkspaceMutations,
  type QuotaInput,
  type QuotaPolicy,
  type QuotaScope,
  type WorkspaceDashboard,
} from './workspace-queries';

const limits = ['dailyRequests', 'dailyTokens', 'perRequestTokens', 'dailySimulatedBudget'] as const;
type Limit = (typeof limits)[number];
/** The API's upper bound for each limit. */
const maxima: Record<Limit, number> = {
  dailyRequests: 1_000_000,
  dailyTokens: 1_000_000_000,
  perRequestTokens: 1_000_000,
  dailySimulatedBudget: 1_000_000,
};

type QuotaForm = { scope: QuotaScope; subject?: string } & Partial<Record<Limit, number | null>>;
const emptyForm: QuotaForm = { scope: 'USER', subject: undefined };

export function QuotaSection({
  dashboard,
  models,
  loading,
}: {
  dashboard?: WorkspaceDashboard;
  models: AdminModel[];
  loading: boolean;
}) {
  const t = useTranslations('admin.workspace.quotas');
  const format = useFormatter();
  const { message } = App.useApp();
  const { saveQuota, removeQuota } = useWorkspaceMutations();
  const [form] = Form.useForm<QuotaForm>();
  const scope = Form.useWatch('scope', form) ?? 'USER';
  const users = dashboard?.users ?? [];

  const subjectOptions = (kind: QuotaScope) =>
    kind === 'USER'
      ? users.map((user) => ({ value: user.id, label: user.username }))
      : kind === 'MODEL'
        ? models.map((model) => ({ value: model.id, label: model.displayName }))
        : templateRoles.map((role) => ({ value: role, label: role }));
  const subjectLabel = (policy: QuotaPolicy) =>
    subjectOptions(policy.scope).find((option) => option.value === policy.subject)?.label ?? policy.subject;
  const limit = (value: number | string | null, field: Limit) =>
    value === null
      ? t('unlimited')
      : field === 'dailySimulatedBudget'
        ? format.number(Number(value), costFormat('USD', 2, 6))
        : format.number(Number(value));

  const save = async (values: QuotaForm) => {
    const quota: QuotaInput = {
      scope: values.scope,
      subject: (values.subject ?? '').trim(),
      dailyRequests: values.dailyRequests ?? null,
      dailyTokens: values.dailyTokens ?? null,
      perRequestTokens: values.perRequestTokens ?? null,
      dailySimulatedBudget: values.dailySimulatedBudget ?? null,
    };
    try {
      await saveQuota.mutateAsync(quota);
      form.resetFields();
      message.success(t('saved'));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };
  const remove = async (policy: QuotaPolicy) => {
    try {
      await removeQuota.mutateAsync(policy.id);
      message.success(t('removed'));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };

  const columns: TableColumnsType<QuotaPolicy> = [
    { key: 'scope', title: t('scope'), render: (_, policy) => t(`scopes.${policy.scope}`) },
    {
      key: 'subject',
      title: t('subject'),
      render: (_, policy) => <span className="font-medium">{subjectLabel(policy)}</span>,
    },
    ...limits.map((field) => ({
      key: field,
      title: t(field),
      className: 'whitespace-nowrap',
      render: (_: unknown, policy: QuotaPolicy) => limit(policy[field], field),
    })),
    {
      key: 'actions',
      title: t('actions'),
      className: 'whitespace-nowrap',
      render: (_, policy) => (
        <>
          <Button
            type="link"
            size="small"
            onClick={() =>
              form.setFieldsValue({
                scope: policy.scope,
                subject: policy.subject,
                dailyRequests: policy.dailyRequests,
                dailyTokens: policy.dailyTokens,
                perRequestTokens: policy.perRequestTokens,
                dailySimulatedBudget: policy.dailySimulatedBudget === null ? null : Number(policy.dailySimulatedBudget),
              })
            }
          >
            {t('edit')}
          </Button>
          <Popconfirm title={t('removeConfirm')} okButtonProps={{ danger: true }} onConfirm={() => remove(policy)}>
            <Button type="link" size="small" danger>
              {t('remove')}
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <SectionCard title={t('title')} description={t('note')}>
      <Form<QuotaForm>
        form={form}
        layout="vertical"
        initialValues={emptyForm}
        onFinish={save}
        // A new scope means a different kind of subject.
        onValuesChange={(changed) => {
          if ('scope' in changed) form.setFieldValue('subject', undefined);
        }}
        className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Form.Item name="scope" label={t('scope')}>
          <Select options={quotaScopes.map((value) => ({ value, label: t(`scopes.${value}`) }))} />
        </Form.Item>
        <Form.Item
          name="subject"
          label={t('subject')}
          rules={[{ required: true, whitespace: true, message: t('subjectRequired') }]}
        >
          {scope === 'DEPARTMENT' ? (
            <Input maxLength={120} placeholder={t('departmentPlaceholder')} />
          ) : (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('subjectPlaceholder')}
              options={subjectOptions(scope)}
            />
          )}
        </Form.Item>
        {limits.map((field) => (
          <Form.Item key={field} name={field} label={t(field)}>
            <InputNumber<number>
              min={0}
              max={maxima[field]}
              precision={field === 'dailySimulatedBudget' ? undefined : 0}
              step={field === 'dailySimulatedBudget' ? 0.01 : 1}
              placeholder={t('unlimited')}
              className="w-full"
            />
          </Form.Item>
        ))}
      </Form>
      <Button type="primary" loading={saveQuota.isPending} onClick={() => form.submit()}>
        {t('save')}
      </Button>
      <Table<QuotaPolicy>
        rowKey="id"
        size="small"
        className="mt-5"
        columns={columns}
        dataSource={dashboard?.policies}
        loading={loading}
        locale={{ emptyText: t('empty') }}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </SectionCard>
  );
}
