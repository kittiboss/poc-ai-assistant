'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/api/api-provider';
import { queryKeys } from '@/lib/api/query-keys';
import type {
  AdminModel,
  AdminSummary,
  AdminUser,
  AuditLog,
  PriceResult,
  PricingConfiguration,
  UpdateModel,
  UpdatePricing,
} from '@/lib/api/types';

export const providers = ['MOCK', 'OLLAMA', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'GROQ', 'OPENROUTER'] as const;
export type Provider = (typeof providers)[number];

/** Dates are `<input type="date">` values in the user's time zone; empty means no filter. */
export type Filters = { from: string; to: string; provider: Provider | ''; modelId: string };

function summaryQuery(filters: Filters) {
  return {
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
    provider: filters.provider || undefined,
    modelId: filters.modelId || undefined,
  };
}

export function useAdminData(filters: Filters) {
  const { client, unwrap } = useApi();
  return {
    summary: useQuery<AdminSummary>({
      queryKey: queryKeys.admin.summary(filters),
      queryFn: async ({ signal }) =>
        unwrap(await client.GET('/api/admin/summary', { params: { query: summaryQuery(filters) }, signal })),
      // Keep showing the previous numbers while a new filter loads.
      placeholderData: (previous) => previous,
    }),
    models: useQuery<AdminModel[]>({
      queryKey: queryKeys.admin.models,
      queryFn: async ({ signal }) => unwrap(await client.GET('/api/admin/models', { signal })),
    }),
    pricing: useQuery<PricingConfiguration[]>({
      queryKey: queryKeys.admin.pricing,
      queryFn: async ({ signal }) => unwrap(await client.GET('/api/admin/pricing', { signal })),
    }),
    users: useQuery<AdminUser[]>({
      queryKey: queryKeys.admin.users,
      queryFn: async ({ signal }) => unwrap(await client.GET('/api/admin/users', { signal })),
    }),
    audit: useQuery<AuditLog[]>({
      queryKey: queryKeys.admin.audit,
      queryFn: async ({ signal }) => unwrap(await client.GET('/api/admin/audit', { signal })),
    }),
  };
}

/** Every change is audited and may move the numbers, so all admin data is refreshed afterwards. */
export function useAdminMutations() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
  return {
    updateModel: useMutation({
      mutationFn: async ({ id, change }: { id: string; change: UpdateModel }) =>
        unwrap(await client.PATCH('/api/admin/models/{id}', { params: { path: { id } }, body: change })),
      onSuccess,
    }),
    setPermission: useMutation({
      mutationFn: async ({ userId, modelId, allowed }: { userId: string; modelId: string; allowed: boolean }) =>
        unwrap(
          await client.PATCH('/api/admin/users/{userId}/models/{modelId}', {
            params: { path: { userId, modelId } },
            body: { allowed },
          }),
        ),
      onSuccess,
    }),
    createPricing: useMutation({
      mutationFn: async ({ modelId, pricing }: { modelId: string; pricing: UpdatePricing }) =>
        unwrap(await client.POST('/api/admin/pricing/{modelId}', { params: { path: { modelId } }, body: pricing })),
      onSuccess,
    }),
    previewPricing: useMutation({
      mutationFn: async (input: UpdatePricing & { inputTokens: number; outputTokens: number }): Promise<PriceResult> =>
        unwrap(await client.POST('/api/admin/pricing/preview/calculate', { body: input })),
    }),
  };
}
