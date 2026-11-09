'use client';

import { Alert, App, Form, InputNumber, Modal, Radio, Select, type FormRule } from 'antd';
import { useAddPrice, type NewPrice } from '@/components/api/mutations';
import { MoneyInput, moneyRules, plainUsd } from '@/components/ui/money';
import type { Price, PriceStrategy } from '@/lib/api/types';
import { formatUsd, nanoUsd } from '@/lib/format';
import { USD_AMOUNT, isEmbeddingModel } from '@/lib/limits';
import { strategyLabel } from './strategy';

interface Values {
  model: string;
  strategy: PriceStrategy;
  inputCost: string;
  outputCost: string;
  markupPercent: number;
  inputRate: string;
  outputRate: string;
}

/** A model's current version as the starting point of its next one. */
const startFrom = (price: Price): Values => ({
  model: price.model,
  strategy: price.strategy,
  inputCost: plainUsd(price.inputCost),
  outputCost: plainUsd(price.outputCost),
  markupPercent: price.markupPercent,
  inputRate: plainUsd(price.inputRate),
  outputRate: plainUsd(price.outputRate),
});

/** The sale price a markup gives, rounded up to the next billionth like vendor-control (money.mjs). */
const withMarkup = (cost: string, markup: number) => (nanoUsd(cost) * BigInt(100 + markup) + 99n) / 100n;

const validUsd = (value?: string) => Boolean(value && USD_AMOUNT.test(value.trim()));

/** With a markup, a $0 cost gives a $0 sale price, which vendor-control refuses (embedding output excepted). */
const costGivesSale =
  (side: 'input' | 'output'): FormRule =>
  ({ getFieldValue }) => ({
    validator: async (_, value?: string) => {
      if (getFieldValue('strategy') !== 'PERCENTAGE_MARKUP' || !validUsd(value)) return;
      if (side === 'output' && isEmbeddingModel(getFieldValue('model'))) return;
      if (nanoUsd(value!.trim()) === 0n) throw new Error('A markup on a $0 cost gives a $0 sale price');
    },
  });

export function PriceDialog({
  prices,
  model,
  open,
  onClose,
}: {
  prices: Price[];
  /** The model to start with; the first one otherwise */
  model?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const add = useAddPrice();
  const currentOf = (name?: string) => prices.find((p) => p.model === name);
  const start = currentOf(model) ?? prices[0];

  const selected = Form.useWatch('model', form) ?? start?.model;
  const strategy = Form.useWatch('strategy', form) ?? start?.strategy;
  const inputCost = Form.useWatch('inputCost', form);
  const outputCost = Form.useWatch('outputCost', form);
  const markup = Form.useWatch('markupPercent', form);
  const current = currentOf(selected);
  const embedding = isEmbeddingModel(selected ?? '');

  const preview =
    strategy === 'PERCENTAGE_MARKUP' && validUsd(inputCost) && validUsd(outputCost) && Number.isInteger(markup)
      ? `${formatUsd(withMarkup(inputCost.trim(), markup))} input · ${formatUsd(withMarkup(outputCost.trim(), markup))} output`
      : undefined;

  const finish = async (values: Values) => {
    const markupStrategy = values.strategy === 'PERCENTAGE_MARKUP';
    const price: NewPrice = {
      model: values.model,
      strategy: values.strategy,
      inputCost: values.inputCost.trim(),
      outputCost: values.outputCost.trim(),
      markupPercent: markupStrategy ? values.markupPercent : 0,
      ...(markupStrategy ? {} : { inputRate: values.inputRate.trim(), outputRate: values.outputRate.trim() }),
    };
    const saved = await add.mutateAsync(price).catch(() => undefined);
    if (!saved) return;
    message.success(`${values.model} v${saved.id} saved. Requests already running keep the price they started with.`);
    onClose();
  };

  return (
    <Modal
      title="New price version"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Save version"
      confirmLoading={add.isPending}
      destroyOnHidden
      width={600}
    >
      <p className="mt-2 mb-4 text-sm text-fg-secondary">
        USD per 1 million tokens. Saving adds a version; earlier ones stay in the history. Costs are simulated and seen
        by the vendor only.
      </p>
      {add.error && <Alert type="error" showIcon title={add.error.message} className="mb-4" />}
      {start && (
        <Form<Values>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={finish}
          initialValues={startFrom(start)}
          onValuesChange={(changed: Partial<Values>) => {
            // Picking another model starts from its own current version.
            const next = changed.model && currentOf(changed.model);
            if (next) form.setFieldsValue(startFrom(next));
          }}
        >
          <Form.Item
            name="model"
            label="Model"
            extra={
              current &&
              `Now v${current.id}: ${strategyLabel(current)}, sale ${formatUsd(current.inputRate)} input · ${formatUsd(current.outputRate)} output`
            }
          >
            <Select options={prices.map((p) => ({ value: p.model, label: p.model }))} />
          </Form.Item>
          <Form.Item name="strategy" label="Sale price">
            <Radio.Group
              optionType="button"
              options={[
                { value: 'PERCENTAGE_MARKUP', label: 'Markup on cost' },
                { value: 'FIXED_RATE', label: 'Fixed rate' },
              ]}
            />
          </Form.Item>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Form.Item
              name="inputCost"
              label="Simulated input cost"
              dependencies={['strategy']}
              rules={[...moneyRules({ name: 'the input cost' }), costGivesSale('input')]}
            >
              <MoneyInput />
            </Form.Item>
            <Form.Item
              name="outputCost"
              label="Simulated output cost"
              dependencies={['strategy', 'model']}
              rules={[...moneyRules({ name: 'the output cost' }), costGivesSale('output')]}
            >
              <MoneyInput />
            </Form.Item>
          </div>
          {strategy === 'PERCENTAGE_MARKUP' ? (
            <>
              <Form.Item
                name="markupPercent"
                label="Markup"
                rules={[
                  {
                    required: true,
                    type: 'integer',
                    min: 0,
                    max: 10000,
                    message: 'Enter a whole number from 0 to 10,000',
                  },
                ]}
              >
                <InputNumber min={0} max={10000} precision={0} suffix="%" className="w-40" />
              </Form.Item>
              <p className="-mt-2 text-sm" aria-live="polite">
                <span className="text-fg-tertiary">Sale price: </span>
                {preview ?? '—'}
              </p>
            </>
          ) : (
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Form.Item
                name="inputRate"
                label="Sale input price"
                rules={moneyRules({ name: 'the input price', positive: true })}
              >
                <MoneyInput />
              </Form.Item>
              <Form.Item
                name="outputRate"
                label="Sale output price"
                dependencies={['model']}
                extra={embedding ? 'Embedding models produce no output tokens; $0 is fine.' : undefined}
                rules={moneyRules({ name: 'the output price', positive: !embedding })}
              >
                <MoneyInput />
              </Form.Item>
            </div>
          )}
          <button type="submit" hidden />
        </Form>
      )}
    </Modal>
  );
}
