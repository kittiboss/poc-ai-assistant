'use client';

import { Alert, App, Button, Dropdown, Form, Modal } from 'antd';
import { Ellipsis, Pause, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { useGrantCredit, useSetEnabled, useSettleStale } from '@/components/api/mutations';
import { MoneyInput, moneyRules } from '@/components/ui/money';
import { useDialog } from '@/components/ui/use-dialog';
import type { Tenant } from '@/lib/api/types';
import { formatNumber, formatUsd } from '@/lib/format';
import { MAX_GRANT_USD } from '@/lib/limits';
import { newReference } from '@/lib/reference';

/** Grant credit, suspend or resume, and the rarer actions in a menu. */
export function TenantActions({ tenant }: { tenant: Tenant }) {
  const { message, modal } = App.useApp();
  const setEnabled = useSetEnabled(tenant.id);
  const settle = useSettleStale(tenant.id);
  const granting = useDialog();
  const pending = Number(tenant.pending);

  const toggle = async () => {
    const suspend = tenant.enabled;
    const confirmed = await modal.confirm({
      title: suspend ? `Suspend ${tenant.name}?` : `Resume ${tenant.name}?`,
      content: suspend
        ? 'The gateway refuses its requests until you resume it. Its credit, settings and data stay as they are.'
        : 'The gateway accepts its requests again.',
      okText: suspend ? 'Suspend' : 'Resume',
      okButtonProps: { danger: suspend },
    });
    if (!confirmed) return;
    try {
      await setEnabled.mutateAsync(!suspend);
      message.success(suspend ? `${tenant.name} is suspended` : `${tenant.name} is active again`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const settleStale = async () => {
    const confirmed = await modal.confirm({
      title: 'Settle stale reservations?',
      content:
        'Requests still running after 5 minutes are charged the maximum reserved for them and recorded as estimated charges. If you later find they used nothing, grant the amount back.',
      okText: 'Settle',
    });
    if (!confirmed) return;
    try {
      const { settled } = await settle.mutateAsync();
      message.success(
        settled
          ? `${formatNumber(settled)} stale ${settled === 1 ? 'reservation' : 'reservations'} settled as estimated charges`
          : 'No request had been running for over 5 minutes',
      );
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const rotate = () =>
    modal.info({
      title: 'Rotate the gateway credential',
      content: (
        <p>
          Run <code>npm run tenant:rotate -- {tenant.id}</code> on the vendor host. The new credential goes straight to
          the tenant&apos;s deployment and never leaves the server.
        </p>
      ),
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="primary" icon={<Plus size={16} />} onClick={granting.show}>
        Grant credit
      </Button>
      <Button
        danger={tenant.enabled}
        icon={tenant.enabled ? <Pause size={16} /> : <Play size={16} />}
        loading={setEnabled.isPending}
        onClick={toggle}
      >
        {tenant.enabled ? 'Suspend' : 'Resume'}
      </Button>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items: [
            {
              key: 'settle',
              label: 'Settle stale reservations',
              extra: pending ? `${formatNumber(pending)} running` : 'None running',
              disabled: !pending || settle.isPending,
              onClick: () => void settleStale(),
            },
            {
              key: 'rotate',
              label: 'Rotate gateway credential',
              disabled: !tenant.provisioned,
              onClick: rotate,
            },
          ],
        }}
      >
        <Button icon={<Ellipsis size={16} />} aria-label="More actions" />
      </Dropdown>
      <GrantCreditDialog key={granting.key} tenant={tenant} open={granting.open} onClose={granting.hide} />
    </div>
  );
}

function GrantCreditDialog({ tenant, open, onClose }: { tenant: Tenant; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const grant = useGrantCredit(tenant.id);
  const [form] = Form.useForm<{ amount: string }>();
  // One reference per dialog: a second click or a retry of the same grant does not add credit twice.
  const [reference] = useState(newReference);

  const finish = async ({ amount }: { amount: string }) => {
    const receipt = await grant.mutateAsync({ amount: amount.trim(), reference }).catch(() => undefined);
    if (!receipt) return;
    message.success(
      `${receipt.id}: ${formatUsd(receipt.amount, { sign: true })} test credit granted to ${tenant.name}`,
    );
    onClose();
  };

  return (
    <Modal
      title={`Grant test credit to ${tenant.name}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Grant"
      confirmLoading={grant.isPending}
      destroyOnHidden
    >
      <p className="mt-2 mb-4 text-sm text-fg-secondary">
        Test credit only: no payment is collected, and the SIM receipt is not a tax invoice.
      </p>
      {grant.error && <Alert type="error" showIcon title={grant.error.message} className="mb-4" />}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={finish} initialValues={{ amount: '2' }}>
        <Form.Item
          name="amount"
          label="Amount (USD)"
          extra={`Available now: ${formatUsd(tenant.credit.remaining)}. At most ${formatUsd(MAX_GRANT_USD)} per grant.`}
          rules={moneyRules({ name: 'the amount', positive: true, max: MAX_GRANT_USD })}
        >
          <MoneyInput autoFocus className="max-w-60" />
        </Form.Item>
        <button type="submit" hidden />
      </Form>
    </Modal>
  );
}
