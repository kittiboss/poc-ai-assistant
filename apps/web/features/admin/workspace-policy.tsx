'use client';

import { App, Button, Form, InputNumber, Select, Switch } from 'antd';
import { FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SectionCard } from '@/components/ui/section-card';
import { download } from '@/lib/download';
import { sensitiveModes, useWorkspaceMutations, type WorkspaceSettings } from './workspace-queries';

type PolicyForm = Pick<WorkspaceSettings, 'sensitiveMode' | 'retentionDays'>;

/** The kill switch saves at once; the sensitive-data and retention policy saves with its button. */
export function WorkspacePolicy({ settings }: { settings: WorkspaceSettings }) {
  const t = useTranslations('admin.workspace.policy');
  const { message, modal } = App.useApp();
  const { saveSettings, previewRetention, exportUsage } = useWorkspaceMutations();
  const [form] = Form.useForm<PolicyForm>();

  const run = async (action: () => Promise<string>) => {
    try {
      message.success(await action());
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };
  const toggleExternal = (externalBlocked: boolean) =>
    run(async () => {
      await saveSettings.mutateAsync({ ...settings, externalBlocked });
      return externalBlocked ? t('paused') : t('resumed');
    });
  const save = async (values: PolicyForm) => {
    // Turning retention on, or changing it, removes chat content for good, so it asks first.
    if (
      values.retentionDays > 0 &&
      values.retentionDays !== settings.retentionDays &&
      !(await modal.confirm({
        title: t('retentionConfirmTitle'),
        content: t('retentionConfirm', { days: values.retentionDays }),
        okText: t('save'),
        okButtonProps: { danger: true },
      }))
    )
      return;
    await run(async () => {
      await saveSettings.mutateAsync({ ...settings, ...values });
      return t('saved');
    });
  };

  return (
    <SectionCard title={t('title')} description={t('description')}>
      <label className="mb-5 flex items-center gap-3 text-sm font-medium">
        <Switch checked={settings.externalBlocked} loading={saveSettings.isPending} onChange={toggleExternal} />
        {t('killSwitch')}
      </label>
      <Form<PolicyForm>
        form={form}
        layout="vertical"
        initialValues={{ sensitiveMode: settings.sensitiveMode, retentionDays: settings.retentionDays }}
        onFinish={save}
        className="grid gap-x-4 md:grid-cols-2"
      >
        <Form.Item name="sensitiveMode" label={t('sensitiveMode')}>
          <Select options={sensitiveModes.map((mode) => ({ value: mode, label: t(`modes.${mode}`) }))} />
        </Form.Item>
        <Form.Item name="retentionDays" label={t('retentionDays')} rules={[{ required: true }]}>
          <InputNumber<number> min={0} max={3650} precision={0} className="w-full" />
        </Form.Item>
      </Form>
      <p className="mb-4 text-xs text-fg-secondary">{t('note')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="primary" loading={saveSettings.isPending} onClick={() => form.submit()}>
          {t('save')}
        </Button>
        <Button
          loading={previewRetention.isPending}
          onClick={() =>
            run(async () => {
              const preview = await previewRetention.mutateAsync();
              return t('previewResult', { count: preview.conversations, days: preview.retentionDays });
            })
          }
        >
          {t('preview')}
        </Button>
        <Button
          icon={<FileDown size={16} />}
          loading={exportUsage.isPending}
          onClick={() =>
            run(async () => {
              const file = await exportUsage.mutateAsync();
              download(file.filename, file.content, 'text/csv');
              return t('exported');
            })
          }
        >
          {t('exportUsage')}
        </Button>
      </div>
    </SectionCard>
  );
}
