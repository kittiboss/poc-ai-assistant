'use client';

import { Alert, App, Button, Progress } from 'antd';
import { Database, FileUp, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/components/api/api-provider';
import { SectionCard } from '@/components/ui/section-card';
import { StatusTag } from '@/components/ui/status-tag';
import { API_URL, errorMessage } from '@/lib/api/client';
import type { IndexRun, KnowledgeImportResult, KnowledgeReindexResult, KnowledgeStatus } from '@/lib/api/types';

/** Imports product CSV data and starts incremental embedding runs for the chat catalog. */
export function KnowledgePanel({ refreshKey }: { refreshKey?: unknown }) {
  const t = useTranslations('admin.knowledge');
  const format = useFormatter();
  const { message, modal } = App.useApp();
  const { fetch, request } = useApi();
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [rowErrors, setRowErrors] = useState<string[]>([]);

  const summarizeRun = useCallback(
    (run: IndexRun) =>
      run.error
        ? t('runFailed', { embedded: run.embedded, pending: run.pending, error: run.error })
        : t('runComplete', { embedded: run.embedded, batches: run.batches, removed: run.removed }),
    [t],
  );

  const load = useCallback(async () => {
    try {
      const next = await request<KnowledgeStatus>('/knowledge/status');
      setStatus(next);
      setProblem('');
      return next;
    } catch (cause) {
      setProblem((cause as Error).message);
      return null;
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!status?.indexing) return;
    const timer = window.setInterval(() => {
      void load().then((next) => {
        if (next && !next.indexing && next.lastRun) {
          const summary = summarizeRun(next.lastRun);
          if (next.lastRun.error) message.error(summary);
          else message.success(summary);
        }
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, message, status?.indexing, summarizeRun]);

  const importCsv = async () => {
    const csv = file.current?.files?.[0];
    if (!csv) {
      message.warning(t('chooseFile'));
      return;
    }
    setBusy(true);
    setProblem('');
    setRowErrors([]);
    try {
      const body = new FormData();
      body.append('file', csv);
      const response = await fetch(
        new Request(`${API_URL}/admin/knowledge/products/import`, {
          method: 'POST',
          body,
        }),
      );
      const payload = (await response.json().catch(() => ({}))) as Partial<KnowledgeImportResult> & {
        message?: string | string[];
        errors?: string[];
      };
      if (!response.ok) {
        setRowErrors(Array.isArray(payload.errors) ? payload.errors : []);
        throw new Error(errorMessage(payload) || t('importFailed', { status: response.status }));
      }
      message.success(
        t('imported', {
          rows: payload.rows ?? 0,
          created: payload.created ?? 0,
          updated: payload.updated ?? 0,
        }),
      );
    } catch (cause) {
      setProblem((cause as Error).message);
    } finally {
      if (file.current) file.current.value = '';
      setBusy(false);
      await load();
    }
  };

  const reindex = async () => {
    if (!status) return;
    if (status.embeddingModel.local === false && status.stale > 0) {
      const confirmed = await modal.confirm({
        title: t('confirmTitle'),
        content: t('confirmExternal', {
          count: status.stale,
          provider: status.embeddingModel.provider ?? t('externalProvider'),
          model: status.embeddingModel.displayName,
          requests: Math.ceil(status.stale / 25),
        }),
        okText: t('confirm'),
      });
      if (!confirmed) return;
    }
    setBusy(true);
    setProblem('');
    setRowErrors([]);
    try {
      const run = await request<KnowledgeReindexResult>('/admin/knowledge/reindex', { method: 'POST' });
      if (run.started) {
        message.info(
          t('started', {
            pending: run.pending,
            batches: run.batches,
            minutes: Math.max(1, Math.round(run.estimatedSeconds / 60)),
          }),
        );
      } else if (run.removed) {
        message.success(t('removed', { count: run.removed }));
      } else {
        message.success(t('upToDate'));
      }
    } catch (cause) {
      setProblem((cause as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  const progress = status?.lastRun
    ? Math.round((status.lastRun.embedded / Math.max(1, status.lastRun.pending)) * 100)
    : 0;

  return (
    <SectionCard
      title={t('title')}
      description={t('description')}
      extra={
        status && (
          <StatusTag tone={status.available ? 'success' : 'error'}>
            {t(status.available ? 'available' : 'unavailable')}
          </StatusTag>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
          <Database size={15} />
          <span>{t('embeddingModel', { model: status?.embeddingModel.displayName ?? '…' })}</span>
          {status?.embeddingModel.local !== null && status?.embeddingModel.local !== undefined && (
            <StatusTag tone={status.embeddingModel.local ? 'success' : 'warning'}>
              {t(status.embeddingModel.local ? 'local' : 'external')}
            </StatusTag>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('products')} value={status?.products} />
          <Stat label={t('indexed')} value={status?.indexed} />
          <Stat label={t('stale')} value={status?.stale} />
          <Stat label={t('orphaned')} value={status?.orphaned} />
        </div>

        {status?.indexing && status.lastRun && (
          <div>
            <p className="mb-1 text-xs text-fg-secondary">
              {t('indexing', {
                embedded: status.lastRun.embedded,
                pending: status.lastRun.pending,
                model: status.lastRun.embeddingModel,
              })}
            </p>
            <Progress percent={progress} showInfo={false} />
          </div>
        )}

        {status?.problem && <Alert type="warning" showIcon title={t('notReady', { problem: status.problem })} />}
        {problem && <Alert type="error" showIcon title={problem} />}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            aria-label={t('fileLabel')}
            disabled={busy || status?.indexing}
            className="max-w-full text-xs text-fg-secondary file:mr-3 file:rounded-brand file:border-0 file:bg-fill-secondary file:px-3 file:py-2 file:text-fg"
          />
          <Button
            icon={<FileUp size={15} />}
            loading={busy}
            disabled={status?.indexing}
            onClick={() => void importCsv()}
          >
            {t('import')}
          </Button>
          <Button
            type="primary"
            icon={<RefreshCw size={15} />}
            loading={busy}
            disabled={!status?.ready || status.indexing}
            onClick={() => void reindex()}
          >
            {t('index')}
          </Button>
          <p className="text-xs text-fg-tertiary">{t('csvNote')}</p>
        </div>

        {rowErrors.length > 0 && (
          <Alert
            type="error"
            showIcon
            title={t('rowErrors')}
            description={
              <ul className="list-disc pl-5 text-xs">
                {rowErrors.slice(0, 20).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            }
          />
        )}
      </div>
    </SectionCard>
  );

  function Stat({ label, value }: { label: string; value?: number }) {
    return (
      <div className="rounded-brand border border-line-secondary p-3">
        <p className="text-[11px] text-fg-secondary">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value === undefined ? '–' : format.number(value)}</p>
      </div>
    );
  }
}
