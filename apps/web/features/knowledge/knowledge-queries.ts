'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useApi } from '@/components/api/api-provider';
import { ApiError, apiUrl, errorMessage } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { components } from '@/lib/api/schema';

// The OpenAPI document describes these responses in prose only, so their shapes are written here.
export type KnowledgeLimits = {
  enabled: boolean;
  embeddingModels: string[];
  allowedTypes: string[];
  maxDocuments: number;
  maxFileMb: number;
  maxTextMb: number;
  maxChunksPerDocument: number;
  maxTotalChunks: number;
  maxTopK: number;
};
export type KnowledgeSettings = {
  embeddingModel: string;
  topK: number;
  minScore: number;
  chunkSize: number;
  chunkOverlap: number;
};
export type KnowledgeOverview = {
  tenant: string;
  limits: KnowledgeLimits;
  settings: KnowledgeSettings;
  effective: { topK: number; minScore: number };
  problem: string | null;
  active: { version: number; model: string } | null;
  target: { version: number; model: string };
  usage: {
    documents: number;
    textBytes: number;
    chunks: number;
    pendingChunks: number;
    pausedDocuments: number;
    sensitiveDocuments: number;
  };
  embeddingModels: { id: string; displayName: string; local: boolean | null; problem: string | null }[];
};
export type KnowledgeDocument = {
  id: string;
  filename: string;
  type: string;
  fileBytes: number;
  textBytes: number;
  sections: number;
  sensitiveFindings: number;
  enabled: boolean;
  status: 'INDEXING' | 'READY' | 'PAUSED';
  reason: string | null;
  chunks: number;
  embedded: number;
  createdAt: string;
};
export type SettingsChange = components['schemas']['KnowledgeSettingsDto'];

/** An API refusal with the fields the review flow needs (code SENSITIVE_CONTEXT, canAcknowledge). */
export class KnowledgeError extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly code?: string,
    readonly canAcknowledge = false,
  ) {
    super(message, status);
  }
}

export function useKnowledgeBase(enabled: boolean) {
  const { request } = useApi();
  const busy = (overview?: KnowledgeOverview) => Boolean(overview?.usage.pendingChunks);
  const overview = useQuery({
    queryKey: queryKeys.knowledgeBase.overview,
    queryFn: ({ signal }) => request<KnowledgeOverview>('/admin/knowledge/settings', { signal }),
    enabled,
    // Follow indexing closely; otherwise only pick up changes the vendor makes to the limits.
    refetchInterval: (query) => (busy(query.state.data) ? 3000 : 15000),
  });
  const documents = useQuery({
    queryKey: queryKeys.knowledgeBase.documents,
    queryFn: ({ signal }) => request<KnowledgeDocument[]>('/admin/knowledge/documents', { signal }),
    enabled,
    refetchInterval: () => (busy(overview.data) ? 3000 : 15000),
  });
  return { overview, documents };
}

export function useKnowledgeBaseMutations() {
  const { fetch } = useApi();
  const t = useTranslations('errors');
  const cache = useQueryClient();
  /** Like useApi().request, but keeps the error code so a sensitive-information review can be offered. */
  const send = async <Data>(path: string, init: RequestInit): Promise<Data> => {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(new Request(`${apiUrl()}${path}`, { ...init, headers }));
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body as { code?: string; canAcknowledge?: boolean } | null;
      throw new KnowledgeError(
        errorMessage(body) ?? t('requestFailed', { status: response.status }),
        response.status,
        detail?.code,
        Boolean(detail?.canAcknowledge),
      );
    }
    return body as Data;
  };
  const onSuccess = () => {
    void cache.invalidateQueries({ queryKey: queryKeys.knowledgeBase.all });
    // Chat reads whether the knowledge base can be used.
    void cache.invalidateQueries({ queryKey: queryKeys.knowledge });
  };
  return {
    upload: useMutation({
      mutationFn: ({ file, acknowledgeSensitive }: { file: File; acknowledgeSensitive?: boolean }) => {
        const form = new FormData();
        if (acknowledgeSensitive) form.append('acknowledgeSensitive', 'true');
        form.append('file', file);
        return send<{ id: string; chunks: number }>('/admin/knowledge/documents', { method: 'POST', body: form });
      },
      onSuccess,
    }),
    settings: useMutation({
      mutationFn: (change: SettingsChange) =>
        send<{ reindex: boolean }>('/admin/knowledge/settings', { method: 'PATCH', body: JSON.stringify(change) }),
      onSuccess,
    }),
    setEnabled: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
        send(`/admin/knowledge/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
      onSuccess,
    }),
    retry: useMutation({
      mutationFn: (id: string) => send(`/admin/knowledge/documents/${id}/retry`, { method: 'POST' }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => send(`/admin/knowledge/documents/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
  };
}
