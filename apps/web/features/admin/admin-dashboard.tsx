'use client';
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Coins, Save, ShieldAlert, Users, Zap } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { costFormat, dateTimeFormat } from '@/i18n/formats';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { AdminModel, PriceResult, PricingStrategy, UpdateModel, UpdatePricing } from '@/lib/api/types';
import { SimpleBarChart } from '@/components/ui/charts';
import { Shell } from '@/components/layout/shell';
import { Badge, Button, Card, Input, Select } from '@/components/ui/primitives';
import { providers, useAdminData, useAdminMutations, type Filters } from './admin-queries';

type Role = NonNullable<UpdateModel['allowedRoles']>[number];
const roles: Role[] = ['USER', 'ADMIN'];
type PriceForm = {
  strategy: PricingStrategy;
  providerInputRate: string;
  providerOutputRate: string;
  cachedInputRate: string;
  additionalFee: string;
  customerInputRate: string;
  customerOutputRate: string;
  markupPercent: string;
  simulationInputRate: string;
  simulationOutputRate: string;
  currency: string;
  /** datetime-local text until sent */
  effectiveAt: string;
  inputTokens: number;
  outputTokens: number;
};

const emptyForm: PriceForm = {
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
  effectiveAt: '',
  inputTokens: 3000,
  outputTokens: 700,
};
const noFilters: Filters = { from: '', to: '', provider: '', modelId: '' };
const pricingFields = [
  'strategy',
  'providerInputRate',
  'providerOutputRate',
  'cachedInputRate',
  'additionalFee',
  'customerInputRate',
  'customerOutputRate',
  'markupPercent',
  'simulationInputRate',
  'simulationOutputRate',
  'currency',
] as const;
/** Only the fields the pricing API accepts; it rejects unknown properties such as a version's id. */
function pricingBody(form: PriceForm): UpdatePricing {
  const optional = (value: string) => value || undefined;
  return {
    strategy: form.strategy,
    providerInputRate: form.providerInputRate,
    providerOutputRate: form.providerOutputRate,
    cachedInputRate: optional(form.cachedInputRate),
    additionalFee: optional(form.additionalFee),
    customerInputRate: optional(form.customerInputRate),
    customerOutputRate: optional(form.customerOutputRate),
    markupPercent: optional(form.markupPercent),
    simulationInputRate: optional(form.simulationInputRate),
    simulationOutputRate: optional(form.simulationOutputRate),
    currency: form.currency,
    effectiveAt: form.effectiveAt ? new Date(form.effectiveAt).toISOString() : undefined,
  };
}

export function AdminDashboard() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const enums = useEnumLabel();
  const format = useFormatter();
  const money = (value: unknown) => format.number(Number(value || 0), costFormat('USD', 6));
  const number = (value: unknown) => format.number(Number(value || 0));
  const percent = (value: string) => format.number(Number(value) / 100, { style: 'percent', maximumFractionDigits: 6 });
  const dateTime = (value: string) => format.dateTime(new Date(value), dateTimeFormat);
  // Daily buckets are UTC dates; formatting them in UTC keeps each bar on its own day.
  const day = (value: string) => format.dateTime(new Date(value), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const auditDetail = (entry: { action: string; after: Record<string, unknown> | null }) => {
    const after = entry.after || {};
    if (entry.action === 'PRICING_VERSION_CREATE')
      return t('audit.pricingDetail', {
        version: String(after.version),
        strategy: enums.label('strategy', String(after.strategy)),
      });
    if (entry.action === 'MODEL_UPDATE')
      return t('audit.modelDetail', {
        enabled: String(after.enabled),
        roles: (after.allowedRoles as string[] | undefined)?.join('/') || '—',
      });
    if (entry.action === 'MODEL_PERMISSION_UPDATE')
      return t('audit.permissionDetail', { model: String(after.modelId), allowed: String(Boolean(after.allowed)) });
    return '';
  };
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [selectedModel, setSelectedModel] = useState('local-mock');
  const [form, setForm] = useState<PriceForm>(emptyForm);
  const [preview, setPreview] = useState<PriceResult | null>(null);
  const [message, setMessage] = useState('');
  const data = useAdminData(filters);
  const mutations = useAdminMutations();
  const summary = data.summary.data;
  const models = data.models.data ?? [];
  const pricing = useMemo(() => data.pricing.data ?? [], [data.pricing.data]);
  const users = data.users.data ?? [];
  const audit = data.audit.data ?? [];
  const loadError = Object.values(data).find((query) => query.error)?.error?.message;
  const report = (cause: unknown) => setMessage((cause as Error).message);
  const selectedPricing = useMemo(
    () => pricing.find((item) => item.modelId === selectedModel),
    [pricing, selectedModel],
  );
  // Reset the form to the latest version when the selected model or its pricing changes. Adjusted during render rather than in an effect, as React recommends.
  const [formSource, setFormSource] = useState(selectedPricing);
  if (formSource !== selectedPricing) {
    setFormSource(selectedPricing);
    const version = selectedPricing?.versions[0];
    if (version)
      setForm((current) => ({
        ...emptyForm,
        ...Object.fromEntries(pricingFields.map((field) => [field, version[field] ?? emptyForm[field]])),
        effectiveAt: '',
        inputTokens: current.inputTokens,
        outputTokens: current.outputTokens,
      }));
    setPreview(null);
  }
  // The summary query follows the filters, so changing them is enough to reload it.
  const applyFilters = (next: Filters) => setFilters(next);
  const updateModel = async (model: AdminModel, change: UpdateModel) => {
    try {
      await mutations.updateModel.mutateAsync({ id: model.id, change });
      setMessage(t('modelUpdated', { model: model.displayName }));
    } catch (cause) {
      report(cause);
    }
  };
  const previewPrice = async () => {
    try {
      setPreview(
        await mutations.previewPricing.mutateAsync({
          ...pricingBody(form),
          inputTokens: form.inputTokens,
          outputTokens: form.outputTokens,
        }),
      );
    } catch (cause) {
      report(cause);
    }
  };
  const savePrice = async () => {
    try {
      await mutations.createPricing.mutateAsync({ modelId: selectedModel, pricing: pricingBody(form) });
      setMessage(t('pricingCreated'));
    } catch (cause) {
      report(cause);
    }
  };
  const permission = (userId: string, modelId: string, allowed: boolean) =>
    mutations.setPermission.mutateAsync({ userId, modelId, allowed }).catch(report);
  const guard = summary?.externalToday;

  return (
    <Shell active="admin">
      <div className="mx-auto max-w-7xl space-y-7 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div>
          <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
        </div>
        {(message || loadError) && (
          <div className="rounded-brand bg-primary-soft px-4 py-3 text-sm text-primary-text">
            {message || loadError}
            <button className="float-right" onClick={() => setMessage('')} aria-label={tCommon('dismiss')}>
              ×
            </button>
          </div>
        )}

        <Card className="flex flex-wrap items-end gap-3 p-4">
          <Field label={t('filters.from')}>
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => applyFilters({ ...filters, from: event.target.value })}
            />
          </Field>
          <Field label={t('filters.to')}>
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => applyFilters({ ...filters, to: event.target.value })}
            />
          </Field>
          <Field label={t('filters.provider')}>
            <Select
              value={filters.provider}
              onChange={(event) => applyFilters({ ...filters, provider: event.target.value as Filters['provider'] })}
            >
              <option value="">{t('filters.allProviders')}</option>
              {providers.map((provider) => (
                <option key={provider}>{provider}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('filters.model')}>
            <Select
              value={filters.modelId}
              onChange={(event) => applyFilters({ ...filters, modelId: event.target.value })}
            >
              <option value="">{t('filters.allModels')}</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="ghost" onClick={() => applyFilters(noFilters)}>
            {t('filters.reset')}
          </Button>
          <p className="ml-auto text-xs text-fg-secondary">{t('filters.note')}</p>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric
            icon={<Users />}
            label={t('metrics.users', { active: number(summary?.activeUsers) })}
            value={number(summary?.users)}
          />
          <Metric icon={<Zap />} label={t('metrics.requests')} value={number(summary?.requests)} />
          <Metric
            icon={<ArrowDownToLine />}
            label={t('metrics.inputTokens')}
            value={number(summary?.tokens.inputTokens)}
          />
          <Metric
            icon={<ArrowUpFromLine />}
            label={t('metrics.outputTokens')}
            value={number(summary?.tokens.outputTokens)}
          />
          <Metric
            icon={<Coins />}
            label={t('metrics.actualProviderCost')}
            value={money(summary?.costs.actualProviderCost)}
          />
          <Metric
            icon={<BarChart3 />}
            label={t('metrics.simulatedCost')}
            value={money(summary?.costs.simulatedProviderCost)}
          />
        </div>

        {guard && (
          <Card className="flex flex-wrap items-center gap-4 p-5">
            <ShieldAlert className="text-warning" />
            <div className="min-w-60 flex-1">
              <h2 className="font-semibold">{t('guard.title')}</h2>
              <p className="text-xs text-fg-secondary">{t('guard.description')}</p>
            </div>
            <GuardMeter label={t('guard.requests')} used={guard.used.requests} limit={guard.limits.requests} />
            <GuardMeter label={t('guard.tokens')} used={guard.used.tokens} limit={guard.limits.tokens} />
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-semibold">{t('charts.perDay')}</h2>
            <p className="mb-4 text-xs text-fg-secondary">{t('charts.perDayNote')}</p>
            <SimpleBarChart
              data={summary?.daily || []}
              x="day"
              y="requests"
              label={t('charts.requests')}
              formatX={day}
            />
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">{t('charts.byProvider')}</h2>
            <p className="mb-4 text-xs text-fg-secondary">{t('charts.byProviderNote')}</p>
            <SimpleBarChart data={summary?.byProvider || []} x="provider" y="_count" label={t('charts.requests')} />
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">{t('charts.byModel')}</h2>
            <p className="mb-4 text-xs text-fg-secondary">{t('charts.byModelNote')}</p>
            <SimpleBarChart data={summary?.byModel || []} x="displayName" y="_count" label={t('charts.requests')} />
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">{t('snapshot.title')}</h2>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Value label={t('snapshot.actualExternalCost')} value={money(summary?.costs.actualProviderCost)} />
              <Value label={t('snapshot.customerCharge')} value={money(summary?.costs.customerCharge)} />
              <Value label={t('snapshot.simulatedProviderCost')} value={money(summary?.costs.simulatedProviderCost)} />
              <Value
                label={t('snapshot.simulatedCustomerCharge')}
                value={money(summary?.costs.simulatedCustomerCharge)}
              />
              <Value
                label={t('snapshot.actualMargin')}
                value={money(
                  Number(summary?.costs.customerCharge || 0) - Number(summary?.costs.actualProviderCost || 0),
                )}
              />
              <Value
                label={t('snapshot.simulatedMargin')}
                value={money(
                  Number(summary?.costs.simulatedCustomerCharge || 0) -
                    Number(summary?.costs.simulatedProviderCost || 0),
                )}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {summary?.byKind.map((kind) => (
                <Badge
                  key={kind.usageKind}
                  tone={
                    kind.usageKind === 'ACTUAL' ? 'success' : kind.usageKind === 'SYNTHETIC' ? 'primary' : 'warning'
                  }
                >
                  {t('snapshot.kind', {
                    kind: enums.label('usageKind', kind.usageKind),
                    requests: number(kind._count),
                    tokens: number(kind._sum.totalTokens),
                  })}
                </Badge>
              ))}
            </div>
            <p className="mt-4 text-xs text-fg-secondary">{t('snapshot.note')}</p>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">{t('breakdown.title')}</h2>
            <p className="text-xs text-fg-secondary">{t('breakdown.note')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-fill-quaternary text-left text-xs text-fg-secondary uppercase">
                <tr>
                  {(
                    [
                      'model',
                      'requests',
                      'tokens',
                      'actualProviderCost',
                      'customerCharge',
                      'simulatedProviderCost',
                      'simulatedCustomerCharge',
                    ] as const
                  ).map((column) => (
                    <th key={column} className="px-5 py-3">
                      {t(`breakdown.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {summary?.byModel.map((row) => (
                  <tr key={row.modelId}>
                    <td className="px-5 py-3 font-medium">{row.displayName}</td>
                    <td className="px-5 py-3">{number(row._count)}</td>
                    <td className="px-5 py-3">{number(row._sum.totalTokens)}</td>
                    <td className="px-5 py-3 font-mono text-xs">{money(row._sum.actualProviderCost)}</td>
                    <td className="px-5 py-3 font-mono text-xs">{money(row._sum.customerCharge)}</td>
                    <td className="px-5 py-3 font-mono text-xs">{money(row._sum.simulatedProviderCost)}</td>
                    <td className="px-5 py-3 font-mono text-xs">{money(row._sum.simulatedCustomerCharge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">{t('registry.title')}</h2>
            <p className="text-xs text-fg-secondary">{t('registry.note')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-fill-quaternary text-left text-xs text-fg-secondary uppercase">
                <tr>
                  {(['model', 'provider', 'location', 'availability', 'enabled', 'allowedRoles'] as const).map(
                    (column) => (
                      <th key={column} className="px-5 py-3">
                        {t(`registry.${column}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {models.map((model) => (
                  <tr key={model.id}>
                    <td className="px-5 py-4 font-medium">
                      {model.displayName}
                      <div className="font-mono text-[11px] text-fg-tertiary">{model.id}</div>
                    </td>
                    <td className="px-5 py-4">{model.provider}</td>
                    <td className="px-5 py-4">
                      <Badge tone={model.local ? 'success' : 'warning'}>
                        {enums.label('location', model.local ? 'LOCAL' : 'EXTERNAL')}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        tone={
                          model.status === 'Available'
                            ? 'success'
                            : model.status === 'Ready (disabled)'
                              ? 'neutral'
                              : 'error'
                        }
                      >
                        {enums.modelStatus(model.status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        aria-label={t(model.enabled ? 'registry.disable' : 'registry.enable', {
                          model: model.displayName,
                        })}
                        disabled={!model.enabled && !model.configured}
                        title={!model.configured ? t('registry.notConfigured') : undefined}
                        onClick={() => updateModel(model, { enabled: !model.enabled })}
                        className={`h-6 w-11 rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${model.enabled ? 'bg-primary' : 'bg-fill'}`}
                      >
                        <span
                          className={`block h-4 w-4 rounded-full bg-on-primary transition ${model.enabled ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-3">
                        {roles.map((role) => (
                          <label key={role} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={model.allowedRoles.includes(role)}
                              onChange={(event) =>
                                updateModel(model, {
                                  allowedRoles: (event.target.checked
                                    ? [...model.allowedRoles, role]
                                    : model.allowedRoles.filter((item) => item !== role)) as Role[],
                                })
                              }
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">{t('prices.title')}</h2>
            <p className="text-xs text-fg-secondary">{t('prices.note')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-fill-quaternary text-fg-secondary uppercase">
                <tr>
                  {(
                    [
                      'model',
                      'version',
                      'strategy',
                      'providerRates',
                      'customerRates',
                      'markup',
                      'simulationRates',
                      'effective',
                    ] as const
                  ).map((column) => (
                    <th key={column} className="px-5 py-3">
                      {t(`prices.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {pricing.map((item) => {
                  const version = item.versions[0];
                  if (!version) return null;
                  const scheduled = new Date(version.effectiveAt) > new Date();
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedModel(item.modelId)}
                      className={`cursor-pointer ${item.modelId === selectedModel ? 'bg-primary-soft' : 'hover:bg-fill-quaternary'}`}
                    >
                      <td className="px-5 py-3 font-medium">{item.model.displayName}</td>
                      <td className="px-5 py-3">{t('prices.versionLabel', { version: version.version })}</td>
                      <td className="px-5 py-3">{enums.label('strategy', version.strategy)}</td>
                      <td className="px-5 py-3 font-mono">
                        {version.providerInputRate} / {version.providerOutputRate}
                      </td>
                      <td className="px-5 py-3 font-mono">
                        {version.customerInputRate} / {version.customerOutputRate}
                      </td>
                      <td className="px-5 py-3">{percent(version.markupPercent)}</td>
                      <td className="px-5 py-3 font-mono">
                        {version.simulationInputRate} / {version.simulationOutputRate}
                      </td>
                      <td className="px-5 py-3">
                        {dateTime(version.effectiveAt)}{' '}
                        {scheduled && <Badge tone="warning">{t('prices.scheduled')}</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t('pricing.title')}</h2>
              <p className="text-xs text-fg-secondary">{t('pricing.note')}</p>
            </div>
            <Select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('pricing.strategy')}>
                <Select
                  className="w-full"
                  value={form.strategy}
                  onChange={(event) => setForm({ ...form, strategy: event.target.value as PricingStrategy })}
                >
                  {['PASS_THROUGH', 'PERCENTAGE_MARKUP', 'FIXED_RATE', 'SIMULATION'].map((value) => (
                    <option key={value} value={value}>
                      {enums.label('strategy', value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Rate
                label={t('pricing.providerInput')}
                value={form.providerInputRate}
                set={(value) => setForm({ ...form, providerInputRate: value })}
              />
              <Rate
                label={t('pricing.providerOutput')}
                value={form.providerOutputRate}
                set={(value) => setForm({ ...form, providerOutputRate: value })}
              />
              <Rate
                label={t('pricing.cachedInput')}
                value={form.cachedInputRate || '0'}
                set={(value) => setForm({ ...form, cachedInputRate: value })}
              />
              <Rate
                label={t('pricing.additionalFee')}
                value={form.additionalFee}
                set={(value) => setForm({ ...form, additionalFee: value })}
              />
              <Rate
                label={t('pricing.customerInput')}
                value={form.customerInputRate}
                set={(value) => setForm({ ...form, customerInputRate: value })}
              />
              <Rate
                label={t('pricing.customerOutput')}
                value={form.customerOutputRate}
                set={(value) => setForm({ ...form, customerOutputRate: value })}
              />
              <Rate
                label={t('pricing.markupPercent')}
                value={form.markupPercent}
                set={(value) => setForm({ ...form, markupPercent: value })}
              />
              <Rate
                label={t('pricing.simulationInput')}
                value={form.simulationInputRate}
                set={(value) => setForm({ ...form, simulationInputRate: value })}
              />
              <Rate
                label={t('pricing.simulationOutput')}
                value={form.simulationOutputRate}
                set={(value) => setForm({ ...form, simulationOutputRate: value })}
              />
              <Field label={t('pricing.currency')}>
                <Input
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('pricing.effectiveAt')}>
                <Input
                  type="datetime-local"
                  value={form.effectiveAt || ''}
                  onChange={(event) => setForm({ ...form, effectiveAt: event.target.value })}
                />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button onClick={savePrice}>
                  <Save size={16} /> {t('pricing.save')}
                </Button>
              </div>
            </div>
            <div className="rounded-brand-lg bg-fill-quaternary p-5">
              <h3 className="text-sm font-semibold">{t('pricing.preview')}</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={t('pricing.inputTokens')}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={form.inputTokens}
                    onChange={(event) =>
                      setForm({ ...form, inputTokens: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
                    }
                  />
                </Field>
                <Field label={t('pricing.outputTokens')}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={form.outputTokens}
                    onChange={(event) =>
                      setForm({ ...form, outputTokens: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
                    }
                  />
                </Field>
              </div>
              <Button variant="secondary" className="mt-3 w-full" onClick={previewPrice}>
                {t('pricing.previewButton')}
              </Button>
              {preview ? (
                <div className="mt-4 space-y-3">
                  <Value label={t('pricing.actualProviderCost')} value={money(preview.actualProviderCost)} />
                  <Value label={t('pricing.actualCustomerCharge')} value={money(preview.customerCharge)} />
                  <Value label={t('pricing.simulatedProviderCost')} value={money(preview.simulatedProviderCost)} />
                  <Value label={t('pricing.simulatedCustomerCharge')} value={money(preview.simulatedCustomerCharge)} />
                  <Value label={t('pricing.grossMargin')} value={money(preview.grossMargin)} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-fg-secondary">{t('pricing.previewNote')}</p>
              )}
            </div>
          </div>
          <div className="mt-7">
            <h3 className="text-sm font-semibold">{t('pricing.history')}</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-fg-secondary">
                  <tr>
                    {(
                      [
                        'version',
                        'effective',
                        'strategy',
                        'providerRates',
                        'customerRates',
                        'markup',
                        'simulationRates',
                        'createdBy',
                      ] as const
                    ).map((column) => (
                      <th key={column} className="py-2 pr-4">
                        {t(`pricing.historyColumns.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedPricing?.versions.map((version) => (
                    <tr key={version.id} className="border-t border-line-secondary">
                      <td className="py-3 pr-4 font-semibold">
                        {t('prices.versionLabel', { version: version.version })}
                      </td>
                      <td className="py-3 pr-4">{dateTime(version.effectiveAt)}</td>
                      <td className="py-3 pr-4">{enums.label('strategy', version.strategy)}</td>
                      <td className="py-3 pr-4">
                        {version.providerInputRate} / {version.providerOutputRate}
                      </td>
                      <td className="py-3 pr-4">
                        {version.customerInputRate} / {version.customerOutputRate}
                      </td>
                      <td className="py-3 pr-4">{percent(version.markupPercent)}</td>
                      <td className="py-3 pr-4">
                        {version.simulationInputRate} / {version.simulationOutputRate}
                      </td>
                      <td className="py-3 pr-4">
                        {(typeof version.createdBy === 'string' && version.createdBy) || tCommon('system')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">{t('permissions.title')}</h2>
            <p className="text-xs text-fg-secondary">{t('permissions.note')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-fill-quaternary text-left text-xs text-fg-secondary uppercase">
                <tr>
                  <th className="px-5 py-3">{t('permissions.user')}</th>
                  {models.map((model) => (
                    <th key={model.id} className="px-5 py-3">
                      {model.displayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-4">
                      <span className="font-medium">{user.username}</span>
                      <div className="text-xs text-fg-tertiary">
                        {user.roles.map((role) => role.role.name).join(', ')}
                      </div>
                    </td>
                    {models.map((model) => {
                      const explicit = user.modelPermissions.find((item) => item.modelId === model.id);
                      const checked =
                        explicit?.allowed ??
                        model.allowedRoles.some((role) => user.roles.some((value) => value.role.name === role));
                      return (
                        <td key={model.id} className="px-5 py-4">
                          <label className="inline-flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => permission(user.id, model.id, event.target.checked)}
                            />
                            {explicit ? t('permissions.explicit') : t('permissions.roleDefault')}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line-secondary p-5">
            <h2 className="font-semibold">{t('audit.title')}</h2>
            <p className="text-xs text-fg-secondary">{t('audit.note')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-fill-quaternary text-fg-secondary uppercase">
                <tr>
                  {(['time', 'actor', 'action', 'entity', 'change'] as const).map((column) => (
                    <th key={column} className="px-5 py-3">
                      {t(`audit.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-secondary">
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-3 whitespace-nowrap">{dateTime(entry.createdAt)}</td>
                    <td className="px-5 py-3">{entry.actor?.username || tCommon('system')}</td>
                    <td className="px-5 py-3">{enums.label('auditAction', entry.action)}</td>
                    <td className="px-5 py-3">
                      {enums.label('entityType', entry.entityType)}
                      <div className="font-mono text-[10px] text-fg-tertiary">{entry.entityId}</div>
                    </td>
                    <td className="px-5 py-3">{auditDetail(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!audit.length && <p className="p-5 text-xs text-fg-secondary">{t('audit.empty')}</p>}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="mb-3 inline-flex rounded-brand bg-primary-soft p-2 text-primary">{icon}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-fg-secondary">{label}</div>
    </Card>
  );
}
function GuardMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const t = useTranslations('admin.guard');
  const format = useFormatter();
  const ratio = limit ? Math.min(1, used / limit) : 1;
  return (
    <div className="w-48">
      <div className="flex justify-between text-xs">
        <span className="text-fg-secondary">{label}</span>
        <span className="font-mono">
          {format.number(used)} / {format.number(limit)}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-fill-secondary">
        <div
          className={`h-2 rounded-full ${ratio >= 1 ? 'bg-error' : ratio >= 0.8 ? 'bg-warning' : 'bg-success'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {ratio >= 1 && <p className="mt-1 text-[11px] text-error">{t('reached')}</p>}
    </div>
  );
}
function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-brand border border-line-secondary bg-surface p-3">
      <p className="text-[11px] text-fg-secondary">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}
function Rate({ label, value, set }: { label: string; value: string; set: (value: string) => void }) {
  return (
    <Field label={label}>
      <Input type="number" min="0" step="0.000001" value={value} onChange={(event) => set(event.target.value)} />
    </Field>
  );
}
