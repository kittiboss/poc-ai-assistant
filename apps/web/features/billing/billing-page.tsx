'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, InputNumber, Table } from 'antd';
import { Coins, Download, RefreshCw, Wallet } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';
import { useApi } from '@/components/api/api-provider';
import { Shell } from '@/components/layout/shell';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionCard } from '@/components/ui/section-card';
import { useRoles } from '@/lib/auth/use-roles';
import { download } from '@/lib/download';
import { runtimeConfig } from '@/lib/runtime-config';

type Receipt = {
  id: string;
  reference: string;
  kind: string;
  amount: string;
  createdAt: string;
  note: string;
  simulation: true;
};
type Billing = {
  credit: { limit: number; spent: number; remaining: number; reserved: number; lowCredit: boolean; exhausted: boolean };
  prices: { id: string; model: string; inputRate: string; outputRate: string }[];
  transactions: Receipt[];
  requests: {
    request_id: string;
    model: string;
    kind: string;
    state: string;
    input_tokens: number | null;
    output_tokens: number | null;
    charge: string | null;
    price_id: string;
  }[];
};
const money = (value: unknown) => `$${Number(value ?? 0).toFixed(9)}`;

export function BillingPage() {
  const locale = useLocale();
  const th = locale === 'th';
  const text = (en: string, thai: string) => (th ? thai : en);
  const allowed = useRoles().includes('ADMIN') && runtimeConfig().vendorManaged;
  const { request } = useApi();
  const cache = useQueryClient();
  const [amount, setAmount] = useState<number | null>(2);
  const reference = useRef<{ amount: number; id: string } | null>(null);
  const query = useQuery({
    queryKey: ['vendor-billing'],
    queryFn: ({ signal }) => request<Billing>('/admin/billing', { signal }),
    enabled: allowed,
    refetchInterval: 5000,
  });
  const topup = useMutation({
    mutationFn: async () => {
      if (!amount || amount <= 0) throw new Error('Enter a positive test amount');
      if (!reference.current || reference.current.amount !== amount)
        reference.current = { amount, id: crypto.randomUUID() };
      return request<Receipt>('/admin/billing/topups', {
        method: 'POST',
        body: JSON.stringify({ amount: String(amount), reference: reference.current.id }),
      });
    },
    onSuccess: () => {
      reference.current = null;
      void cache.invalidateQueries({ queryKey: ['vendor-billing'] });
      void cache.invalidateQueries({ queryKey: ['admin'] });
      void cache.invalidateQueries({ queryKey: ['models'] });
    },
  });
  const credit = query.data?.credit;
  return (
    <Shell active="billing">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">{text('Test credits & billing', 'เครดิตและรายการใช้จำลอง')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {text('Organization-wide balance · refreshed every 5 seconds', 'ยอดรวมขององค์กร · อัปเดตทุก 5 วินาที')}
            </p>
          </div>
          <Button
            icon={<RefreshCw size={16} />}
            disabled={!allowed}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {text('Refresh', 'รีเฟรช')}
          </Button>
        </div>
        <Alert
          showIcon
          type="info"
          title={text('Simulation only — no payment collected', 'ระบบจำลองเท่านั้น — ไม่มีการเก็บเงินจริง')}
          description={text(
            'USD values are test credits. Receipts are not tax invoices. Sale prices below are per 1 million tokens. Provider costs and margins are private to the vendor.',
            'จำนวน USD เป็นเครดิตทดสอบ ใบรับเครดิตไม่ใช่ใบกำกับภาษี ราคาขายด้านล่างคิดต่อ 1 ล้าน token ต้นทุนและกำไรเป็นข้อมูลภายในของ vendor',
          )}
        />
        {!allowed ? (
          <Alert type="warning" title={text('Tenant administrators only', 'สำหรับผู้ดูแลองค์กรเท่านั้น')} />
        ) : (
          <>
            {query.error && <Alert type="error" title={query.error.message} />}
            {credit?.lowCredit && (
              <Alert
                showIcon
                type={credit.exhausted ? 'error' : 'warning'}
                title={text(
                  'Low test credit — top up before sending more requests',
                  'เครดิตทดสอบใกล้หมด — เติมเครดิตก่อนส่งคำขอเพิ่ม',
                )}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Wallet />}
                label={text('Available', 'ใช้ได้')}
                value={credit ? money(credit.remaining) : '—'}
              />
              <MetricCard
                icon={<Coins />}
                label={text('Reserved for in-flight requests', 'กันไว้สำหรับคำขอที่กำลังทำงาน')}
                value={credit ? money(credit.reserved) : '—'}
              />
              <MetricCard
                icon={<Coins />}
                label={text('Consumed test credit', 'เครดิตทดสอบที่ใช้ไป')}
                value={credit ? money(credit.spent) : '—'}
              />
              <MetricCard
                icon={<Coins />}
                label={text('Total granted', 'เครดิตที่ได้รับทั้งหมด')}
                value={credit ? money(credit.limit) : '—'}
              />
            </div>
            <SectionCard
              title={text('Add test credit', 'เติมเครดิตทดสอบ')}
              description={text(
                'No card, payment provider, bank transfer, or real-money transaction.',
                'ไม่มีบัตรเครดิต ช่องทางชำระเงิน การโอนเงิน หรือธุรกรรมเงินจริง',
              )}
            >
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  topup.mutate();
                }}
              >
                <label className="flex flex-col gap-2 text-sm">
                  {text('Simulated USD', 'จำนวน USD จำลอง')}
                  <InputNumber
                    min={0.01}
                    max={10000}
                    precision={2}
                    value={amount}
                    onChange={setAmount}
                    disabled={topup.isPending}
                  />
                </label>
                <Button type="primary" htmlType="submit" loading={topup.isPending} disabled={!amount || amount <= 0}>
                  {text('Grant test credit', 'เติมเครดิตทดสอบ')}
                </Button>
              </form>
              {topup.error && <Alert className="mt-4" type="error" title={topup.error.message} />}
              {topup.data && (
                <Alert
                  className="mt-4"
                  type="success"
                  title={`${topup.data.id} · ${money(topup.data.amount)} · ${text('Test credit granted', 'เติมเครดิตทดสอบแล้ว')}`}
                />
              )}
            </SectionCard>
            <SectionCard title={text('Current sale prices · USD / 1M tokens', 'ราคาขายปัจจุบัน · USD / 1 ล้าน token')}>
              <Table
                rowKey="id"
                dataSource={query.data?.prices}
                pagination={false}
                loading={query.isPending}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: 'Model', dataIndex: 'model' },
                  { title: text('Version', 'เวอร์ชัน'), dataIndex: 'id' },
                  { title: 'Input', render: (_, row) => money(row.inputRate) },
                  { title: 'Output', render: (_, row) => money(row.outputRate) },
                ]}
              />
            </SectionCard>
            <SectionCard title={text('Credit history · latest 100', 'ประวัติเครดิต · 100 รายการล่าสุด')}>
              <Table<Receipt>
                rowKey="id"
                dataSource={query.data?.transactions}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: text('Receipt', 'ใบรับเครดิต'), dataIndex: 'id' },
                  { title: text('Time', 'เวลา'), render: (_, row) => new Date(row.createdAt).toLocaleString(locale) },
                  { title: text('Type', 'ประเภท'), dataIndex: 'kind' },
                  { title: 'USD', render: (_, row) => money(row.amount) },
                  { title: text('Reference', 'อ้างอิง'), dataIndex: 'reference', ellipsis: true },
                  {
                    title: '',
                    render: (_, row) => (
                      <Button
                        icon={<Download size={14} />}
                        aria-label={`${text('Download test receipt', 'ดาวน์โหลดใบรับเครดิตจำลอง')} ${row.id}`}
                        onClick={() => download(`${row.id}.json`, JSON.stringify(row, null, 2), 'application/json')}
                      />
                    ),
                  },
                ]}
              />
            </SectionCard>
            <SectionCard
              title={text('Request ledger · latest 100', 'รายการใช้เครดิต · 100 คำขอล่าสุด')}
              description={text(
                'ESTIMATED means final usage was unavailable; the reserved maximum was used. Contact your vendor to investigate. Cancelled requests may still consume credit.',
                'ESTIMATED หมายถึงไม่มีข้อมูลการใช้สุดท้าย จึงคิดตามวงเงินที่กันไว้ ติดต่อ vendor เพื่อตรวจสอบ การยกเลิกคำขออาจยังใช้เครดิต',
              )}
            >
              <Table
                rowKey="request_id"
                dataSource={query.data?.requests}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: 'Request ID', dataIndex: 'request_id', ellipsis: true },
                  { title: 'Model', dataIndex: 'model' },
                  { title: text('Status', 'สถานะ'), dataIndex: 'state' },
                  {
                    title: 'Input / Output',
                    render: (_, row) => `${row.input_tokens ?? '—'} / ${row.output_tokens ?? '—'}`,
                  },
                  {
                    title: text('Test charge', 'เครดิตทดสอบ'),
                    render: (_, row) => (row.charge === null ? '—' : money(row.charge)),
                  },
                  { title: text('Price version', 'เวอร์ชันราคา'), dataIndex: 'price_id' },
                ]}
              />
            </SectionCard>
          </>
        )}
      </div>
    </Shell>
  );
}
