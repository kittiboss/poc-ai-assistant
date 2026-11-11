'use client';

import { Alert, App, Button, Checkbox, Form, InputNumber, Modal, Switch, type FormRule } from 'antd';
import { Pencil } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useSaveImageLimits, useSaveRagLimits } from '@/components/api/mutations';
import { useDialog } from '@/components/ui/use-dialog';
import type { ImageLimits, RagLimits, Tenant } from '@/lib/api/types';
import { EMBEDDING_MODELS, FILE_TYPES, MAX_IMAGES, RAG_RANGES, VISION_MODELS, imageCaps } from '@/lib/limits';

/** The Edit button of a limits card and the dialog it opens. */
function EditButton({ label, dialog }: { label: string; dialog: (open: boolean, close: () => void) => ReactNode }) {
  const { key, open, show, hide } = useDialog();
  return (
    <>
      <Button size="small" icon={<Pencil size={14} />} aria-label={label} onClick={show}>
        Edit
      </Button>
      <Fragment key={key}>{dialog(open, hide)}</Fragment>
    </>
  );
}

/** Each model, marked when the tenant's plan does not include it: then it has no effect. */
const modelOptions = (models: string[], plan: string[], note?: (model: string) => ReactNode) =>
  models.map((model) => ({
    value: model,
    label: (
      <span>
        <code>{model}</code>
        {note?.(model)}
        {!plan.includes(model) && <span className="ms-1.5 text-xs text-warning">not in plan</span>}
      </span>
    ),
  }));

const visionModels = [...VISION_MODELS.keys()];
const capped = imageCaps(visionModels, MAX_IMAGES);

/** A list that must not be empty while the feature is on. */
const neededWhenOn =
  (message: string): FormRule =>
  ({ getFieldValue }) => ({
    validator: async (_, value?: string[]) => {
      if (getFieldValue('enabled') && !value?.length) throw new Error(message);
    },
  });

const wholeNumber = ([min, max]: readonly [number, number]): FormRule[] => [
  { required: true, type: 'integer', min, max, message: `Enter a whole number from ${min} to ${max}` },
];

const withinTotalChunks: FormRule = ({ getFieldValue }) => ({
  validator: async (_, value?: number) => {
    if (value && value > getFieldValue('maxTotalChunks')) throw new Error('Cannot be more than the chunks in total');
  },
});

const ragFields: { name: keyof typeof RAG_RANGES; label: string; extra?: string }[] = [
  { name: 'maxDocuments', label: 'Documents' },
  { name: 'maxFileMb', label: 'Largest file (MB)' },
  { name: 'maxTextMb', label: 'Extracted text in total (MB)' },
  { name: 'maxTotalChunks', label: 'Chunks in total' },
  { name: 'maxChunksPerDocument', label: 'Chunks per document' },
  { name: 'maxTopK', label: 'Top-K max', extra: 'Passages one question may retrieve' },
];

export function EditKnowledgeLimits({ tenant }: { tenant: Tenant }) {
  return (
    <EditButton
      label="Edit knowledge limits"
      dialog={(open, close) => <KnowledgeDialog tenant={tenant} open={open} onClose={close} />}
    />
  );
}

function KnowledgeDialog({ tenant, open, onClose }: { tenant: Tenant; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RagLimits>();
  const save = useSaveRagLimits(tenant.id);

  const finish = async (values: RagLimits) => {
    // Exactly the fields vendor-control knows; it refuses any other.
    const limits: RagLimits = {
      enabled: values.enabled,
      embeddingModels: EMBEDDING_MODELS.filter((m) => values.embeddingModels.includes(m)),
      allowedTypes: FILE_TYPES.filter((t) => values.allowedTypes.includes(t)),
      maxDocuments: values.maxDocuments,
      maxFileMb: values.maxFileMb,
      maxTextMb: values.maxTextMb,
      maxChunksPerDocument: values.maxChunksPerDocument,
      maxTotalChunks: values.maxTotalChunks,
      maxTopK: values.maxTopK,
    };
    if (!(await save.mutateAsync(limits).catch(() => undefined))) return;
    message.success(`Knowledge limits saved for ${tenant.name}. The RAG engine applies them within 30 seconds.`);
    onClose();
  };

  return (
    <Modal
      title={`Knowledge limits · ${tenant.name}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Save"
      confirmLoading={save.isPending}
      destroyOnHidden
      width={600}
    >
      <p className="mt-2 mb-4 text-sm text-fg-secondary">
        The frame the customer&apos;s own administrators tune their knowledge settings within. Documents stay in the
        central RAG engine, kept apart per tenant.
      </p>
      {save.error && <Alert type="error" showIcon title={save.error.message} className="mb-4" />}
      <Form<RagLimits> form={form} layout="vertical" requiredMark={false} onFinish={finish} initialValues={tenant.rag}>
        <Form.Item name="enabled" label="Knowledge" valuePropName="checked">
          <Switch checkedChildren="On" unCheckedChildren="Off" />
        </Form.Item>
        <Form.Item
          name="embeddingModels"
          label="Embedding models"
          dependencies={['enabled']}
          rules={[neededWhenOn('Choose at least one embedding model')]}
        >
          <Checkbox.Group options={modelOptions(EMBEDDING_MODELS, tenant.config.models)} />
        </Form.Item>
        <Form.Item
          name="allowedTypes"
          label="File types"
          dependencies={['enabled']}
          rules={[neededWhenOn('Choose at least one file type')]}
        >
          <Checkbox.Group options={FILE_TYPES.map((type) => ({ value: type, label: type.toUpperCase() }))} />
        </Form.Item>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {ragFields.map(({ name, label, extra }) => (
            <Form.Item
              key={name}
              name={name}
              label={label}
              extra={extra}
              dependencies={name === 'maxChunksPerDocument' ? ['maxTotalChunks'] : undefined}
              rules={[
                ...wholeNumber(RAG_RANGES[name]),
                ...(name === 'maxChunksPerDocument' ? [withinTotalChunks] : []),
              ]}
            >
              <InputNumber min={RAG_RANGES[name][0]} max={RAG_RANGES[name][1]} precision={0} className="w-full" />
            </Form.Item>
          ))}
        </div>
        <button type="submit" hidden />
      </Form>
    </Modal>
  );
}

export function EditImageLimits({ tenant }: { tenant: Tenant }) {
  return (
    <EditButton
      label="Edit image limits"
      dialog={(open, close) => <ImagesDialog tenant={tenant} open={open} onClose={close} />}
    />
  );
}

function ImagesDialog({ tenant, open, onClose }: { tenant: Tenant; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ImageLimits>();
  const save = useSaveImageLimits(tenant.id);

  const finish = async (values: ImageLimits) => {
    const limits: ImageLimits = {
      enabled: values.enabled,
      models: visionModels.filter((m) => values.models.includes(m)),
      maxImages: values.maxImages,
    };
    if (!(await save.mutateAsync(limits).catch(() => undefined))) return;
    message.success(`Image limits saved for ${tenant.name}. They apply to the customer's next message.`);
    onClose();
  };

  return (
    <Modal
      title={`Image limits · ${tenant.name}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Save"
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <p className="mt-2 mb-4 text-sm text-fg-secondary">
        Which models may receive images in chat, and how many images one chat may hold.
      </p>
      {save.error && <Alert type="error" showIcon title={save.error.message} className="mb-4" />}
      <Form<ImageLimits>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={finish}
        initialValues={tenant.images}
      >
        <Form.Item name="enabled" label="Chat images" valuePropName="checked">
          <Switch checkedChildren="On" unCheckedChildren="Off" />
        </Form.Item>
        <Form.Item
          name="models"
          label="Models"
          dependencies={['enabled']}
          rules={[neededWhenOn('Choose at least one model')]}
        >
          <Checkbox.Group
            options={modelOptions(visionModels, tenant.config.models, (model) => {
              const own = capped.find((cap) => cap.model === model);
              return own && <span className="ms-1.5 text-xs text-fg-tertiary">at most {own.maxImages} a chat</span>;
            })}
          />
        </Form.Item>
        <Form.Item
          name="maxImages"
          label="Images per chat"
          rules={wholeNumber([1, MAX_IMAGES])}
          extra={`A model never takes more than its own, whatever this says: ${capped
            .map(({ model, maxImages }) => `${model} ${maxImages}`)
            .join(', ')}.`}
        >
          <InputNumber min={1} max={MAX_IMAGES} precision={0} className="w-32" />
        </Form.Item>
        <button type="submit" hidden />
      </Form>
    </Modal>
  );
}
