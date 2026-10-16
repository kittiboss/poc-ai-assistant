'use client';

import { Form, Input, Modal } from 'antd';
import { useTranslations } from 'next-intl';

interface RenameDialogProps {
  initialTitle: string;
  saving: boolean;
  onSave: (title: string) => void;
  onClose: () => void;
}

/** Mounted only while open, so each rename starts from the chat's current title. The API accepts 1–120 characters. */
export function RenameDialog({ initialTitle, saving, onSave, onClose }: RenameDialogProps) {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const [form] = Form.useForm<{ title: string }>();

  return (
    <Modal
      open
      title={t('renameTitle')}
      okText={tCommon('save')}
      cancelText={tCommon('cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ title: initialTitle }}
        onFinish={(values) => onSave(values.title.trim())}
      >
        <Form.Item
          name="title"
          label={t('renamePrompt')}
          rules={[{ required: true, whitespace: true, message: t('titleRequired') }]}
        >
          <Input maxLength={120} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
