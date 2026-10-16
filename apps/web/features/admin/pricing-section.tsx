'use client';

import { App, Button, DatePicker, Form, Input, InputNumber, Select, Table, type TableColumnsType } from 'antd';
import type { Dayjs } from 'dayjs';
import { Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type {
  AdminModel,
  PriceResult,
  PricingConfiguration,
  PricingStrategy,
  PricingVersion,
  UpdatePricing,
} from '@/lib/api/types';
import { useAdminMutations } from './admin-queries';
import { useAdminFormat } from './use-admin-format';
import { ValueTile } from './value-tile';

const strategies: PricingStrategy[] = ['PASS_THROUGH', 'PERCENTAGE_MARKUP', 'FIXED_RATE', 'SIMULATION'];
const rateFields = [
  'providerInputRate',
  'providerOutputRate',
  'cachedInputRate',
  'additionalFee',
  'customerInputRate',
  'customerOutputRate',
  'markupPercent',
  'simulationInputRate',
  'simulationOutputRate',
] as const;
type RateField = (typeof rateFields)[number];
const rateLabels = {
  providerInputRate: 'providerInput',
  providerOutputRate: 'providerOutput',
  cachedInputRate: 'cachedInput',
  additionalFee: 'additionalFee',
  customerInputRate: 'customerInput',
  customerOutputRate: 'customerOutput',
  markupPercent: 'markupPercent',
  simulationInputRate: 'simulationInput',
  simulationOutputRate: 'simulationOutput',
} as const satisfies Record<RateField, string>;

/** Rates are decimal strings (stringMode keeps every digit); effectiveAt stays a date until sent. */
type PriceForm = Record<RateField, string | null> & {
  strategy: PricingStrategy;
  currency: string;
  effectiveAt: Dayjs | null;
};

const defaults: PriceForm = {
  strategy: 'SIMULATION',
  providerInputRate: '0',
  providerOutputRate: '0',
  cachedInputRate: '0',
  additionalFee: '0',
  customerInputRate: '0',
  customerOutputRate: '0',
  markupPercent: '50',
  simulationInputRate: '2.5',
  simulationOutputRate: '3.571428571428',
  currency: 'USD',
  effectiveAt: null,
};

/** A new version starts from the latest one, but never from its effective date. */
function fromVersion(version: PricingVersion | undefined): PriceForm {
  if (!version) return defaults;
  const rates = Object.fromEntries(rateFields.map((field) => [field, version[field] ?? defaults[field]]));
  return { ...defaults, ...rates, strategy: version.strategy, currency: version.currency };
}

/** Only the fields the pricing API accepts; it rejects unknown properties such as a version's id. */
function pricingBody(form: PriceForm): UpdatePricing {
  const optional = (value: string | null) => value || undefined;
  return {
    strategy: form.strategy,
    providerInputRate: form.providerInputRate ?? '0',
    providerOutputRate: form.providerOutputRate ?? '0',
    cachedInputRate: optional(form.cachedInputRate),
    additionalFee: optional(form.additionalFee),
    customerInputRate: optional(form.customerInputRate),
    customerOutputRate: optional(form.customerOutputRate),
    markupPercent: optional(form.markupPercent),
    simulationInputRate: optional(form.simulationInputRate),
    simulationOutputRate: optional(form.simulationOutputRate),
    currency: form.currency,
    effectiveAt: form.effectiveAt ? form.effectiveAt.toISOString() : undefined,
  };
}

export function PricingSection({
  models,
  pricing,
  loading,
}: {
  models: AdminModel[];
  pricing: PricingConfiguration[];
  loading: boolean;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const enums = useEnumLabel();
  const { percent, dateTime } = useAdminFormat();
  const [selectedModel, setSelectedModel] = useState('local-mock');
  // Kept across model changes, like the original form.
  const [tokens, setTokens] = useState({ inputTokens: 3000, outputTokens: 700 });
  const priced = pricing.filter((item) => item.versions[0]);
  const selected = pricing.find((item) => item.modelId === selectedModel);
  const latest = selected?.versions[0];
  const rates = (input: string, output: string) => (
    <span className="font-mono">
      {input} / {output}
    </span>
  );

  const priceColumns: TableColumnsType<PricingConfiguration> = [
    {
      key: 'model',
      title: t('prices.model'),
      render: (_, item) => <span className="font-medium">{item.model.displayName}</span>,
    },
    {
      key: 'version',
      title: t('prices.version'),
      render: (_, item) => t('prices.versionLabel', { version: item.versions[0].version }),
    },
    {
      key: 'strategy',
      title: t('prices.strategy'),
      render: (_, item) => enums.label('strategy', item.versions[0].strategy),
    },
    {
      key: 'provider',
      title: t('prices.providerRates'),
      render: (_, item) => rates(item.versions[0].providerInputRate, item.versions[0].providerOutputRate),
    },
    {
      key: 'customer',
      title: t('prices.customerRates'),
      render: (_, item) => rates(item.versions[0].customerInputRate, item.versions[0].customerOutputRate),
    },
    { key: 'markup', title: t('prices.markup'), render: (_, item) => percent(item.versions[0].markupPercent) },
    {
      key: 'simulation',
      title: t('prices.simulationRates'),
      render: (_, item) => rates(item.versions[0].simulationInputRate, item.versions[0].simulationOutputRate),
    },
    {
      key: 'effective',
      title: t('prices.effective'),
      className: 'whitespace-nowrap',
      render: (_, item) => (
        <span className="inline-flex items-center gap-2">
          {dateTime(item.versions[0].effectiveAt)}
          {new Date(item.versions[0].effectiveAt) > new Date() && (
            <StatusTag tone="warning">{t('prices.scheduled')}</StatusTag>
          )}
        </span>
      ),
    },
  ];

  const historyColumns: TableColumnsType<PricingVersion> = [
    {
      key: 'version',
      title: t('pricing.historyColumns.version'),
      render: (_, version) => (
        <span className="font-semibold">{t('prices.versionLabel', { version: version.version })}</span>
      ),
    },
    {
      key: 'effective',
      title: t('pricing.historyColumns.effective'),
      className: 'whitespace-nowrap',
      render: (_, version) => dateTime(version.effectiveAt),
    },
    {
      key: 'strategy',
      title: t('pricing.historyColumns.strategy'),
      render: (_, version) => enums.label('strategy', version.strategy),
    },
    {
      key: 'provider',
      title: t('pricing.historyColumns.providerRates'),
      render: (_, version) => rates(version.providerInputRate, version.providerOutputRate),
    },
    {
      key: 'customer',
      title: t('pricing.historyColumns.customerRates'),
      render: (_, version) => rates(version.customerInputRate, version.customerOutputRate),
    },
    {
      key: 'markup',
      title: t('pricing.historyColumns.markup'),
      render: (_, version) => percent(version.markupPercent),
    },
    {
      key: 'simulation',
      title: t('pricing.historyColumns.simulationRates'),
      render: (_, version) => rates(version.simulationInputRate, version.simulationOutputRate),
    },
    {
      key: 'createdBy',
      title: t('pricing.historyColumns.createdBy'),
      render: (_, version) => (typeof version.createdBy === 'string' && version.createdBy) || tCommon('system'),
    },
  ];

  return (
    <>
      <SectionCard flush title={t('prices.title')} description={t('prices.note')}>
        <Table<PricingConfiguration>
          rowKey="modelId"
          size="small"
          columns={priceColumns}
          dataSource={priced}
          loading={loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: [selectedModel],
            onChange: (keys) => setSelectedModel(String(keys[0])),
          }}
          onRow={(item) => ({ onClick: () => setSelectedModel(item.modelId), className: 'cursor-pointer' })}
        />
      </SectionCard>

      <SectionCard
        title={t('pricing.title')}
        description={t('pricing.note')}
        extra={
          <Select
            aria-label={t('filters.model')}
            className="min-w-48"
            value={selectedModel}
            onChange={setSelectedModel}
            options={models.map((model) => ({ value: model.id, label: model.displayName }))}
          />
        }
      >
        {/* Remounted per model and version, so the form always starts from the latest version. */}
        <PricingEditor
          key={`${selectedModel}:${latest?.id ?? 'none'}`}
          modelId={selectedModel}
          latest={latest}
          tokens={tokens}
          onTokensChange={setTokens}
        />
        <h3 className="mt-7 mb-2 text-sm font-semibold">{t('pricing.history')}</h3>
        <Table<PricingVersion>
          rowKey="id"
          size="small"
          columns={historyColumns}
          dataSource={selected?.versions ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </SectionCard>
    </>
  );
}

function PricingEditor({
  modelId,
  latest,
  tokens,
  onTokensChange,
}: {
  modelId: string;
  latest: PricingVersion | undefined;
  tokens: { inputTokens: number; outputTokens: number };
  onTokensChange: (tokens: { inputTokens: number; outputTokens: number }) => void;
}) {
  const t = useTranslations('admin');
  const enums = useEnumLabel();
  const { message } = App.useApp();
  const { money } = useAdminFormat();
  const { createPricing, previewPricing } = useAdminMutations();
  const [form] = Form.useForm<PriceForm>();
  const [preview, setPreview] = useState<PriceResult | null>(null);
  const required = [{ required: true, message: t('pricing.required') }];

  const save = async (values: PriceForm) => {
    try {
      await createPricing.mutateAsync({ modelId, pricing: pricingBody(values) });
      message.success(t('pricingCreated'));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };
  const runPreview = async () => {
    const values = await form.validateFields();
    try {
      setPreview(await previewPricing.mutateAsync({ ...pricingBody(values), ...tokens }));
    } catch (cause) {
      message.error((cause as Error).message);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Form<PriceForm>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={fromVersion(latest)}
        onFinish={save}
        className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Form.Item name="strategy" label={t('pricing.strategy')} rules={required}>
          <Select options={strategies.map((value) => ({ value, label: enums.label('strategy', value) }))} />
        </Form.Item>
        {rateFields.map((field) => (
          <Form.Item
            key={field}
            name={field}
            label={t(`pricing.${rateLabels[field]}`)}
            rules={field === 'providerInputRate' || field === 'providerOutputRate' ? required : undefined}
          >
            <InputNumber<string> stringMode min="0" step="0.000001" className="w-full" />
          </Form.Item>
        ))}
        <Form.Item
          name="currency"
          label={t('pricing.currency')}
          normalize={(value: string) => value.toUpperCase()}
          rules={[{ required: true, len: 3, message: t('pricing.currencyHint') }]}
        >
          <Input maxLength={3} />
        </Form.Item>
        <Form.Item name="effectiveAt" label={t('pricing.effectiveAt')}>
          <DatePicker showTime className="w-full" />
        </Form.Item>
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={createPricing.isPending}>
            {t('pricing.save')}
          </Button>
        </div>
      </Form>

      <div className="rounded-brand-lg bg-fill-quaternary p-5">
        <h3 className="text-sm font-semibold">{t('pricing.preview')}</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-secondary">{t('pricing.inputTokens')}</span>
            <InputNumber<number>
              min={0}
              precision={0}
              value={tokens.inputTokens}
              onChange={(value) => onTokensChange({ ...tokens, inputTokens: value ?? 0 })}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-secondary">{t('pricing.outputTokens')}</span>
            <InputNumber<number>
              min={0}
              precision={0}
              value={tokens.outputTokens}
              onChange={(value) => onTokensChange({ ...tokens, outputTokens: value ?? 0 })}
              className="w-full"
            />
          </label>
        </div>
        <Button block className="mt-3" onClick={runPreview} loading={previewPricing.isPending}>
          {t('pricing.previewButton')}
        </Button>
        {preview ? (
          <div className="mt-4 space-y-3">
            <ValueTile label={t('pricing.actualProviderCost')} value={money(preview.actualProviderCost)} />
            <ValueTile label={t('pricing.actualCustomerCharge')} value={money(preview.customerCharge)} />
            <ValueTile label={t('pricing.simulatedProviderCost')} value={money(preview.simulatedProviderCost)} />
            <ValueTile label={t('pricing.simulatedCustomerCharge')} value={money(preview.simulatedCustomerCharge)} />
            <ValueTile label={t('pricing.grossMargin')} value={money(preview.grossMargin)} />
          </div>
        ) : (
          <p className="mt-3 text-xs text-fg-secondary">{t('pricing.previewNote')}</p>
        )}
      </div>
    </div>
  );
}
