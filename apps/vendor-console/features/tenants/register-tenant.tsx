'use client';

import { Alert, Button, Form, Input, InputNumber, Modal, Typography } from 'antd';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useRegisterTenant } from '@/components/api/mutations';
import { useDialog } from '@/components/ui/use-dialog';
import type { Tenant } from '@/lib/api/types';
import { formatUsd } from '@/lib/format';
import { TENANT_ID } from '@/lib/limits';

interface Values {
  id: string;
  name: string;
  webPort: number;
}

/** Registers a customer deployment; it runs once `tenant:create` has deployed it on the vendor host. */
export function RegisterTenant({ tenants }: { tenants?: Tenant[] }) {
  const dialog = useDialog();
  return (
    <>
      <Button type="primary" icon={<Plus size={16} />} disabled={!tenants} onClick={dialog.show}>
        Register deployment
      </Button>
      {tenants && <RegisterDialog key={dialog.key} open={dialog.open} tenants={tenants} onClose={dialog.hide} />}
    </>
  );
}

function RegisterDialog({ open, tenants, onClose }: { open: boolean; tenants: Tenant[]; onClose: () => void }) {
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const register = useRegisterTenant();
  const [registered, setRegistered] = useState<string>();
  const webPort = Form.useWatch('webPort', form);

  // Each deployment publishes its web port and the next one (its API).
  const portOwners = useMemo(
    () => new Map(tenants.flatMap((t) => [[t.config.webPort, t] as const, [t.config.apiPort, t] as const])),
    [tenants],
  );
  const suggestedPort = Math.max(3300, ...tenants.map((t) => t.config.webPort)) + 100;

  const finish = async (values: Values) => {
    const result = await register
      .mutateAsync({ id: values.id, name: values.name.trim(), webPort: values.webPort })
      .catch(() => undefined);
    if (!result) return;
    // Registered meanwhile, by someone else: vendor-control leaves the existing tenant as it is.
    if (!result.created) form.setFields([{ name: 'id', errors: ['A tenant with this ID already exists'] }]);
    else setRegistered(result.id);
  };

  const tenant = registered ? tenants.find((t) => t.id === registered) : undefined;
  const command = `npm run tenant:create -- ${registered}`;

  return (
    <Modal
      title={registered ? 'Deployment registered' : 'Register a deployment'}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={
        registered
          ? [
              <Button key="close" onClick={onClose}>
                Close
              </Button>,
              <Button key="open" type="primary" onClick={() => router.push(`/tenants/${registered}`)}>
                Open tenant
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose}>
                Cancel
              </Button>,
              <Button key="register" type="primary" loading={register.isPending} onClick={() => form.submit()}>
                Register
              </Button>,
            ]
      }
    >
      {registered ? (
        <div className="text-sm leading-6">
          <p>
            <strong>{tenant?.name ?? registered}</strong> is registered
            {tenant && <> with {formatUsd(tenant.credit.remaining)} of test credit</>} and the local mock models. It is
            not running yet: deploy it on the vendor host with
          </p>
          <Typography.Paragraph
            copyable={{ text: command }}
            className="mt-3 mb-3! rounded-brand bg-fill-quaternary px-3 py-2"
          >
            <code>{command}</code>
          </Typography.Paragraph>
          <p className="text-xs text-fg-tertiary">
            The command creates its sign-in realm, gateway credential and containers. This console has no access to
            Docker.
          </p>
        </div>
      ) : (
        <Form<Values>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={finish}
          initialValues={{ webPort: suggestedPort }}
          className="mt-4"
        >
          <p className="mb-4 text-sm text-fg-secondary">
            Creates the tenant&apos;s record with its opening test credit and the local mock models. Nothing is deployed
            until you run the command shown next on the vendor host.
          </p>
          {register.error && <Alert type="error" showIcon title={register.error.message} className="mb-4" />}
          <Form.Item
            name="id"
            label="Tenant ID"
            extra="Lowercase letters, digits and hyphens. It also names the tenant's sign-in realm and containers."
            rules={[
              { required: true, message: 'Enter a tenant ID' },
              {
                pattern: TENANT_ID,
                message: 'Use up to 20 lowercase letters, digits and hyphens, starting with a letter or digit',
              },
              {
                validator: async (_, id?: string) => {
                  if (id && tenants.some((t) => t.id === id)) throw new Error('A tenant with this ID already exists');
                },
              },
            ]}
          >
            <Input autoFocus maxLength={20} autoComplete="off" spellCheck={false} />
          </Form.Item>
          <Form.Item
            name="name"
            label="Organization name"
            rules={[{ required: true, whitespace: true, message: 'Enter the organization name' }]}
          >
            <Input maxLength={100} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="webPort"
            label="Web port"
            extra={
              Number.isInteger(webPort) ? `Its API uses the next port, ${webPort + 1}.` : 'Its API uses the next port.'
            }
            rules={[
              { required: true, message: 'Enter a port' },
              {
                validator: async (_, port?: number) => {
                  if (port === undefined || port === null) return;
                  for (const used of [port, port + 1]) {
                    const owner = portOwners.get(used);
                    if (owner) throw new Error(`Port ${used} is used by ${owner.name} (${owner.id})`);
                  }
                },
              },
            ]}
          >
            <InputNumber min={1024} max={64999} precision={0} className="w-40" />
          </Form.Item>
          <button type="submit" hidden />
        </Form>
      )}
    </Modal>
  );
}
