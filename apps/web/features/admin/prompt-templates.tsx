'use client';

import { App, Button, Checkbox, Form, Input, InputNumber, Select, Switch } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SectionCard } from '@/components/ui/section-card';
import type { AdminModel } from '@/lib/api/types';
import { templateRoles, useWorkspaceMutations, type PromptTemplate, type TemplateInput } from './workspace-queries';

const emptyTemplate: TemplateInput = {
  name: '',
  description: '',
  systemPrompt: '',
  allowedModels: [],
  allowedRoles: [...templateRoles],
  temperature: 0.7,
  maxOutputTokens: 1024,
  enabled: true,
};

const NEW = '';

export function PromptTemplates({
  templates,
  models,
  loading,
}: {
  templates: PromptTemplate[];
  models: AdminModel[];
  loading: boolean;
}) {
  const t = useTranslations('admin.workspace.templates');
  const [selectedId, setSelectedId] = useState(NEW);
  const selected = templates.find((template) => template.id === selectedId);

  return (
    <SectionCard
      title={t('title')}
      description={t('note')}
      extra={
        <Select
          aria-label={t('select')}
          className="w-64"
          loading={loading}
          value={selected ? selectedId : NEW}
          onChange={setSelectedId}
          options={[
            { value: NEW, label: t('new') },
            ...templates.map((template) => ({
              value: template.id,
              label: template.enabled ? template.name : t('disabled', { name: template.name }),
            })),
          ]}
        />
      }
    >
      {/* Keyed by the template and its saved version, so the form starts from what is saved. */}
      <TemplateEditor
        key={selected ? JSON.stringify(selected) : NEW}
        id={selected?.id}
        initial={selected ?? emptyTemplate}
        models={models}
        onSaved={setSelectedId}
      />
    </SectionCard>
  );
}

function TemplateEditor({
  id,
  initial,
  models,
  onSaved,
}: {
  id?: string;
  initial: TemplateInput;
  models: AdminModel[];
  onSaved: (id: string) => void;
}) {
  const t = useTranslations('admin.workspace.templates');
  const { message } = App.useApp();
  const { saveTemplate } = useWorkspaceMutations();
  const [form] = Form.useForm<TemplateInput>();
  const required = [{ required: true, whitespace: true, message: t('required') }];

  const save = async (values: TemplateInput) => {
    try {
      const saved = await saveTemplate.mutateAsync({
        id,
        template: { ...values, name: values.name.trim(), description: values.description?.trim() ?? '' },
      });
      onSaved(saved.id);
      message.success(t('saved'));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };

  return (
    <Form<TemplateInput>
      form={form}
      layout="vertical"
      initialValues={{
        name: initial.name,
        description: initial.description,
        systemPrompt: initial.systemPrompt,
        allowedModels: initial.allowedModels,
        allowedRoles: initial.allowedRoles,
        temperature: initial.temperature,
        maxOutputTokens: initial.maxOutputTokens,
        enabled: initial.enabled,
      }}
      onFinish={save}
    >
      <div className="grid gap-x-4 md:grid-cols-2">
        <Form.Item name="name" label={t('name')} rules={required}>
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item name="description" label={t('description')}>
          <Input maxLength={500} />
        </Form.Item>
      </div>
      <Form.Item name="systemPrompt" label={t('systemPrompt')} rules={required}>
        <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} maxLength={6000} showCount />
      </Form.Item>
      <div className="grid gap-x-4 md:grid-cols-3">
        <Form.Item name="allowedRoles" label={t('roles')}>
          <Checkbox.Group options={templateRoles.map((role) => ({ value: role, label: role }))} />
        </Form.Item>
        <Form.Item name="temperature" label={t('temperature')}>
          <InputNumber<number> min={0} max={2} step={0.1} className="w-full" />
        </Form.Item>
        <Form.Item name="maxOutputTokens" label={t('maxOutputTokens')}>
          <InputNumber<number> min={1} max={4096} precision={0} className="w-full" />
        </Form.Item>
      </div>
      <Form.Item name="allowedModels" label={t('models')} extra={t('modelsHint')}>
        <Checkbox.Group options={models.map((model) => ({ value: model.id, label: model.displayName }))} />
      </Form.Item>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Form.Item name="enabled" valuePropName="checked" noStyle>
            <Switch size="small" />
          </Form.Item>
          {t('enabled')}
        </label>
        <Button type="primary" htmlType="submit" loading={saveTemplate.isPending}>
          {t('save')}
        </Button>
      </div>
    </Form>
  );
}
