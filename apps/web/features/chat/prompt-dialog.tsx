'use client';

import { Form, Input, Modal } from 'antd';
import { useTranslations } from 'next-intl';

interface PromptDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  /** A text area (for a message or a comment) instead of a single line */
  multiline?: boolean;
  /** Shown when the field is left empty; without it an empty value is allowed */
  requiredMessage?: string;
  /** The API's limit for this field */
  maxLength: number;
  okText?: string;
  saving?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** A one-field form in a modal, in place of window.prompt. Mounted only while open, so it starts from `initialValue`. */
export function PromptDialog({
  title,
  label,
  initialValue = '',
  multiline = false,
  requiredMessage,
  maxLength,
  okText,
  saving = false,
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const tCommon = useTranslations('common');
  const [form] = Form.useForm<{ value: string }>();

  return (
    <Modal
      open
      title={title}
      okText={okText ?? tCommon('save')}
      cancelText={tCommon('cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ value: initialValue }}
        onFinish={(values) => onSubmit((values.value ?? '').trim())}
      >
        <Form.Item
          name="value"
          label={label}
          rules={requiredMessage ? [{ required: true, whitespace: true, message: requiredMessage }] : []}
        >
          {multiline ? (
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} maxLength={maxLength} showCount autoFocus />
          ) : (
            <Input maxLength={maxLength} autoFocus />
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
}
