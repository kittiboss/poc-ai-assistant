'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/api/api-provider';
import { queryKeys } from '@/lib/api/query-keys';

// The governance endpoints have no response schema in the OpenAPI document yet, so these types
// follow apps/api/src/workspace/governance.service.ts and the calls go through `request`.

export const quotaScopes = ['USER', 'ROLE', 'MODEL', 'DEPARTMENT'] as const;
export type QuotaScope = (typeof quotaScopes)[number];
export const sensitiveModes = ['WARN', 'BLOCK'] as const;
export type SensitiveMode = (typeof sensitiveModes)[number];
export const templateRoles = ['USER', 'ADMIN'] as const;

export interface WorkspaceSettings {
  externalBlocked: boolean;
  /** 0 turns automatic chat-content retention off */
  retentionDays: number;
  sensitiveMode: SensitiveMode;
}

export interface QuotaPolicy {
  id: string;
  scope: QuotaScope;
  /** A user id, role, model id or department name, depending on the scope */
  subject: string;
  dailyRequests: number | null;
  dailyTokens: number | null;
  perRequestTokens: number | null;
  /** Simulated provider cost in USD, as a decimal string */
  dailySimulatedBudget: string | null;
}

/** null is unlimited, 0 blocks. */
export type QuotaInput = Omit<QuotaPolicy, 'id' | 'dailySimulatedBudget'> & { dailySimulatedBudget: number | null };

export interface WorkspaceDashboard {
  settings: WorkspaceSettings;
  policies: QuotaPolicy[];
  users: { id: string; username: string; department: string }[];
  feedback: { modelId: string; feedback: 1 | -1; _count: number }[];
  recentFeedback: {
    id: string;
    modelId: string;
    feedback: 1 | -1;
    feedbackComment: string | null;
    updatedAt: string;
  }[];
  /** Today (UTC), by each user's current department */
  departmentUsage: {
    department: string;
    _count: number;
    _sum: { totalTokens: number | null; simulatedProviderCost: string | null };
  }[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Empty means every model the user may use */
  allowedModels: string[];
  allowedRoles: string[];
  temperature: number;
  maxOutputTokens: number;
  enabled: boolean;
}
export type TemplateInput = Omit<PromptTemplate, 'id'>;

export interface CsvFile {
  filename: string;
  content: string;
}

export function useWorkspace() {
  const { request } = useApi();
  return {
    dashboard: useQuery({
      queryKey: queryKeys.admin.workspace,
      queryFn: ({ signal }) => request<WorkspaceDashboard>('/admin/workspace', { signal }),
    }),
    templates: useQuery({
      queryKey: queryKeys.admin.templates,
      queryFn: ({ signal }) => request<PromptTemplate[]>('/admin/workspace/templates', { signal }),
    }),
  };
}

/** Every change is audited and may move the numbers, so all admin data is refreshed afterwards. */
export function useWorkspaceMutations() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
  const send = <Data = unknown>(path: string, method: string, body?: unknown) =>
    request<Data>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    saveSettings: useMutation({
      mutationFn: (settings: WorkspaceSettings) => send('/admin/workspace/settings', 'PATCH', settings),
      onSuccess,
    }),
    /** Adds a quota, or replaces the one with the same scope and subject. */
    saveQuota: useMutation({
      mutationFn: (quota: QuotaInput) => send('/admin/workspace/quotas', 'POST', quota),
      onSuccess,
    }),
    removeQuota: useMutation({
      mutationFn: (id: string) => send(`/admin/workspace/quotas/${id}`, 'DELETE'),
      onSuccess,
    }),
    setDepartment: useMutation({
      mutationFn: ({ userId, department }: { userId: string; department: string }) =>
        send(`/admin/workspace/users/${userId}`, 'PATCH', { department }),
      onSuccess,
    }),
    saveTemplate: useMutation({
      mutationFn: ({ id, template }: { id?: string; template: TemplateInput }) =>
        id
          ? send<PromptTemplate>(`/admin/workspace/templates/${id}`, 'PATCH', template)
          : send<PromptTemplate>('/admin/workspace/templates', 'POST', template),
      onSuccess,
    }),
    previewRetention: useMutation({
      mutationFn: () => request<{ conversations: number; retentionDays: number }>('/admin/workspace/retention'),
    }),
    exportUsage: useMutation({
      mutationFn: () => request<CsvFile>('/admin/workspace/usage.csv'),
    }),
  };
}
