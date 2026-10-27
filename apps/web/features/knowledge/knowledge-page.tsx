'use client';

import { Alert, App, Button, Form, InputNumber, Popconfirm, Progress, Select, Switch, Table, Upload } from 'antd';
import { BookOpen, FileText, Layers, RefreshCw, RotateCw, Search, Trash2, UploadCloud } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Shell } from '@/components/layout/shell';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag } from '@/components/ui/status-tag';
import { useRoles } from '@/lib/auth/use-roles';
import { runtimeConfig } from '@/lib/runtime-config';
import {
  KnowledgeError,
  type KnowledgeDocument,
  type KnowledgeOverview,
  type KnowledgeSettings,
  useKnowledgeBase,
  useKnowledgeBaseMutations,
} from './knowledge-queries';

const MB = 1024 * 1024;
const REASONS = ['CREDIT_EXHAUSTED', 'POLICY', 'DAILY_LIMIT', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'ERROR'] as const;

/** Documents and retrieval settings in the platform's central knowledge base, within the vendor's limits. */
export function KnowledgePage() {
  const t = useTranslations('knowledgeBase');
  const allowed = useRoles().includes('ADMIN') && runtimeConfig().vendorManaged;
  const { overview, documents } = useKnowledgeBase(allowed);
  const data = overview.data;
  const error = overview.error ?? documents.error;
  return (
    <Shell active="knowledge">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold">{t('title')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
          </div>
          <Button
            icon={<RefreshCw size={16} />}
            disabled={!allowed}
            loading={overview.isFetching || documents.isFetching}
            onClick={() => void Promise.all([overview.refetch(), documents.refetch()])}
          >
            {t('refresh')}
          </Button>
        </div>
        {!allowed ? (
          <Alert type="warning" title={t(runtimeConfig().vendorManaged ? 'adminsOnly' : 'notVendor')} />
        ) : (
          <>
            {error && <Alert type="error" title={error.message} />}
            {data?.problem && <Alert showIcon type="warning" title={t('unavailable')} description={data.problem} />}
            {data && <IndexProgress overview={data} />}
            {data && <Usage overview={data} />}
            {data && <SettingsForm overview={data} />}
            {data && <Uploader overview={data} />}
            <Documents documents={documents.data ?? []} loading={documents.isLoading} />
          </>
        )}
      </div>
    </Shell>
  );
}

function IndexProgress({ overview }: { overview: KnowledgeOverview }) {
  const t = useTranslations('knowledgeBase');
  const { pendingChunks } = overview.usage;
  if (!pendingChunks) return null;
  const rebuilding = overview.active !== null && overview.active.version !== overview.target.version;
  return (
    <Alert
      showIcon
      type="info"
      title={
        rebuilding
          ? t('reindexing', { version: overview.target.version, pending: pendingChunks })
          : t('indexing', { pending: pendingChunks })
      }
    />
  );
}

function Usage({ overview }: { overview: KnowledgeOverview }) {
  const t = useTranslations('knowledgeBase');
  const format = useFormatter();
  const { usage, limits, effective } = overview;
  const mb = (bytes: number) => format.number(bytes / MB, { maximumFractionDigits: 2 });
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        icon={<FileText />}
        label={t('documents')}
        value={t('of', { used: usage.documents, max: limits.maxDocuments })}
      />
      <MetricCard
        icon={<BookOpen />}
        label={t('text')}
        value={t('mbOf', { used: mb(usage.textBytes), max: limits.maxTextMb })}
      />
      <MetricCard
        icon={<Layers />}
        label={t('passages')}
        value={t('of', { used: usage.chunks, max: limits.maxTotalChunks })}
      />
      <MetricCard icon={<Search />} label={t('topK')} value={t('of', { used: effective.topK, max: limits.maxTopK })} />
    </div>
  );
}

/** Reads a refusal; with a sensitive-information finding the admin may confirm and send again. */
function useReview() {
  const t = useTranslations('knowledgeBase');
  const { message, modal } = App.useApp();
  return async (attempt: (acknowledge: boolean) => Promise<unknown>) => {
    try {
      return await attempt(false);
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'SENSITIVE_CONTEXT' && error.canAcknowledge) {
        const confirmed = await modal.confirm({
          title: t('sensitiveTitle'),
          content: error.message,
          okText: t('sendAnyway'),
          cancelText: t('cancel'),
        });
        if (confirmed) return attempt(true);
        return undefined;
      }
      message.error((error as Error).message);
      return undefined;
    }
  };
}

function SettingsForm({ overview }: { overview: KnowledgeOverview }) {
  const t = useTranslations('knowledgeBase');
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<KnowledgeSettings>();
  const { settings: save } = useKnowledgeBaseMutations();
  const review = useReview();
  const { settings, limits } = overview;
  // Show what is saved whenever it changes (another admin, or the vendor lowering a limit).
  useEffect(() => form.setFieldsValue(settings), [form, settings]);
  const chunkSize = Form.useWatch('chunkSize', form) ?? settings.chunkSize;

  const submit = async (values: KnowledgeSettings) => {
    const changes = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => settings[key as keyof KnowledgeSettings] !== value),
    ) as Partial<KnowledgeSettings>;
    if (!Object.keys(changes).length) return;
    const reindex = ['embeddingModel', 'chunkSize', 'chunkOverlap'].some((key) => key in changes);
    if (reindex) {
      const model = overview.embeddingModels.find((m) => m.id === values.embeddingModel);
      const external = changes.embeddingModel && model?.local === false;
      const confirmed = await modal.confirm({
        title: t('confirmReindexTitle'),
        content: [
          t('confirmReindex', { chunks: overview.usage.chunks }),
          external ? t('confirmExternal', { model: model.displayName }) : '',
        ]
          .filter(Boolean)
          .join(' '),
        okText: t('continue'),
        cancelText: t('cancel'),
      });
      if (!confirmed) return;
    }
    const result = await review((acknowledgeSensitive) =>
      save.mutateAsync({ ...changes, ...(acknowledgeSensitive ? { acknowledgeSensitive } : {}) }),
    );
    if (result) message.success(t((result as { reindex: boolean }).reindex ? 'reindexStarted' : 'saved'));
  };

  return (
    <SectionCard
      title={t('settingsTitle')}
      description={t('settingsDescription', {
        models: overview.embeddingModels.map((m) => m.displayName).join(', ') || '—',
        maxTopK: limits.maxTopK,
      })}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={settings}
        onFinish={(values) => void submit(values)}
        disabled={!limits.enabled || save.isPending}
        className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        <Form.Item name="embeddingModel" label={t('embeddingModel')} rules={[{ required: true }]}>
          <Select
            options={overview.embeddingModels.map((model) => ({
              value: model.id,
              disabled: Boolean(model.problem),
              label: `${model.displayName} · ${model.local === false ? t('external') : t('local')}`,
              title: model.problem ?? undefined,
            }))}
          />
        </Form.Item>
        <Form.Item name="topK" label={t('topK')} rules={[{ required: true }]}>
          <InputNumber min={1} max={limits.maxTopK} precision={0} className="w-full" />
        </Form.Item>
        <Form.Item name="minScore" label={t('minScore')} rules={[{ required: true }]}>
          <InputNumber min={0} max={0.9} step={0.05} className="w-full" />
        </Form.Item>
        <Form.Item name="chunkSize" label={t('chunkSize')} rules={[{ required: true }]}>
          <InputNumber min={400} max={2000} step={100} precision={0} className="w-full" />
        </Form.Item>
        <Form.Item name="chunkOverlap" label={t('chunkOverlap')} rules={[{ required: true }]}>
          <InputNumber min={0} max={Math.floor(chunkSize * 0.4)} step={50} precision={0} className="w-full" />
        </Form.Item>
        <div className="sm:col-span-2 xl:col-span-5">
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {t('save')}
          </Button>
        </div>
      </Form>
    </SectionCard>
  );
}

function Uploader({ overview }: { overview: KnowledgeOverview }) {
  const t = useTranslations('knowledgeBase');
  const { message } = App.useApp();
  const { upload } = useKnowledgeBaseMutations();
  const review = useReview();
  const { limits } = overview;
  const accept = limits.allowedTypes.map((type) => `.${type}`).join(',');
  return (
    <SectionCard title={t('uploadTitle')}>
      <Upload.Dragger
        accept={accept}
        multiple={false}
        showUploadList={false}
        disabled={!limits.enabled || upload.isPending}
        beforeUpload={(file) => {
          if (file.size > limits.maxFileMb * MB) {
            message.error(t('tooLarge', { size: limits.maxFileMb }));
            return Upload.LIST_IGNORE;
          }
          return true;
        }}
        customRequest={({ file, onSuccess, onError }) => {
          void review((acknowledgeSensitive) => upload.mutateAsync({ file: file as File, acknowledgeSensitive })).then(
            (result) => {
              if (result) {
                message.success(
                  t('uploaded', { filename: (file as File).name, chunks: (result as { chunks: number }).chunks }),
                );
                onSuccess?.(result);
              } else onError?.(new Error('not uploaded'));
            },
          );
        }}
      >
        <div className="flex flex-col items-center gap-2 py-4">
          <UploadCloud className="text-primary" />
          <div className="font-medium">{upload.isPending ? t('uploading') : t('uploadDrop')}</div>
          <div className="text-xs text-fg-secondary">
            {t('uploadHint', { types: limits.allowedTypes.join(', ').toUpperCase(), size: limits.maxFileMb })}
          </div>
        </div>
      </Upload.Dragger>
    </SectionCard>
  );
}

function Documents({ documents, loading }: { documents: KnowledgeDocument[]; loading: boolean }) {
  const t = useTranslations('knowledgeBase');
  const format = useFormatter();
  const { message } = App.useApp();
  const { setEnabled, retry, remove } = useKnowledgeBaseMutations();
  const act = (promise: Promise<unknown>, done?: string) =>
    promise
      .then(() => {
        if (done) void message.success(done);
      })
      .catch((error: Error) => {
        void message.error(error.message);
      });
  const reason = (value: string | null) =>
    value && (REASONS as readonly string[]).includes(value) ? t(`reason.${value as (typeof REASONS)[number]}`) : value;
  return (
    <SectionCard title={t('documentsTitle')} flush>
      <Table<KnowledgeDocument>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={documents}
        pagination={false}
        scroll={{ x: 760 }}
        locale={{ emptyText: t('noDocuments') }}
        columns={[
          {
            title: t('columnDocument'),
            render: (_, doc) => (
              <div className="min-w-0">
                <div className="truncate font-medium">{doc.filename}</div>
                <div className="text-xs text-fg-secondary">
                  {doc.type.toUpperCase()} ·{' '}
                  {doc.type === 'pdf'
                    ? t('pages', { count: doc.sections })
                    : doc.type === 'csv'
                      ? t('rows', { count: doc.sections })
                      : format.dateTime(new Date(doc.createdAt), { dateStyle: 'medium' })}
                  {doc.sensitiveFindings > 0 && ` · ${t('sensitive')}`}
                </div>
              </div>
            ),
          },
          {
            title: t('columnText'),
            width: 120,
            render: (_, doc) => `${format.number(doc.textBytes / 1024, { maximumFractionDigits: 1 })} KB`,
          },
          {
            title: t('columnPassages'),
            width: 170,
            render: (_, doc) => (
              <div>
                <div className="text-xs">{t('embeddedOf', { embedded: doc.embedded, chunks: doc.chunks })}</div>
                <Progress
                  percent={doc.chunks ? Math.round((doc.embedded / doc.chunks) * 100) : 0}
                  size="small"
                  showInfo={false}
                />
              </div>
            ),
          },
          {
            title: t('columnStatus'),
            width: 200,
            render: (_, doc) => (
              <div className="flex flex-col items-start gap-1">
                <StatusTag tone={doc.status === 'READY' ? 'success' : doc.status === 'PAUSED' ? 'warning' : 'primary'}>
                  {t(`status.${doc.status}`)}
                </StatusTag>
                {doc.reason && <span className="text-xs text-fg-secondary">{reason(doc.reason)}</span>}
              </div>
            ),
          },
          {
            title: t('columnChat'),
            width: 110,
            render: (_, doc) => (
              <Switch
                size="small"
                checked={doc.enabled}
                aria-label={t('columnChat')}
                onChange={(enabled) => void act(setEnabled.mutateAsync({ id: doc.id, enabled }))}
              />
            ),
          },
          {
            title: t('columnActions'),
            width: 190,
            render: (_, doc) => (
              <div className="flex flex-wrap gap-2">
                {doc.status === 'PAUSED' && (
                  <Button
                    size="small"
                    icon={<RotateCw size={14} />}
                    onClick={() => void act(retry.mutateAsync(doc.id))}
                  >
                    {t('retry')}
                  </Button>
                )}
                <Popconfirm
                  title={t('confirmDelete', { filename: doc.filename })}
                  okText={t('delete')}
                  cancelText={t('cancel')}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => act(remove.mutateAsync(doc.id), t('deleted'))}
                >
                  <Button size="small" danger icon={<Trash2 size={14} />}>
                    {t('delete')}
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />
    </SectionCard>
  );
}
