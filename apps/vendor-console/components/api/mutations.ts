'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ImageLimits, PriceStrategy, RagLimits, Receipt } from '@/lib/api/types';
import { useAdminRequest } from './api-provider';

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** Every change below shows up in the tenant list, its ledger or usage; prices only on the pricing page. */
function useRefresh() {
  const client = useQueryClient();
  return {
    tenants: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['tenants'] }),
        client.invalidateQueries({ queryKey: ['usage'] }),
      ]),
    prices: () => client.invalidateQueries({ queryKey: ['prices'] }),
  };
}

/** Creates the tenant record with its opening test credit; `tenant:create` on the host deploys it. */
export function useRegisterTenant() {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { id: string; name: string; webPort: number }) =>
      request<{ id: string; created: boolean }>('/tenants', json('POST', body)),
    onSuccess: refresh.tenants,
  });
}

/** `reference` makes a retry of the same grant a no-op instead of a second grant. */
export function useGrantCredit(id: string) {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { amount: string; reference: string }) =>
      request<Receipt>(`/tenants/${encodeURIComponent(id)}/credits`, json('POST', body)),
    onSuccess: refresh.tenants,
  });
}

/** Suspend (the gateway refuses the tenant's requests) or resume. */
export function useSetEnabled(id: string) {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      request<{ id: string; enabled: boolean }>(`/tenants/${encodeURIComponent(id)}`, json('PATCH', { enabled })),
    onSuccess: refresh.tenants,
  });
}

/** Charges the reserved maximum for requests pending over 5 minutes, labelled as estimates. */
export function useSettleStale(id: string) {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => request<{ settled: number }>(`/tenants/${encodeURIComponent(id)}/reconcile`, json('POST', {})),
    onSuccess: refresh.tenants,
  });
}

export function useSaveRagLimits(id: string) {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (limits: RagLimits) =>
      request<RagLimits>(`/tenants/${encodeURIComponent(id)}/rag`, json('PATCH', limits)),
    onSuccess: refresh.tenants,
  });
}

export function useSaveImageLimits(id: string) {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (limits: ImageLimits) =>
      request<ImageLimits>(`/tenants/${encodeURIComponent(id)}/images`, json('PATCH', limits)),
    onSuccess: refresh.tenants,
  });
}

export interface NewPrice {
  model: string;
  strategy: PriceStrategy;
  inputCost: string;
  outputCost: string;
  markupPercent: number;
  inputRate?: string;
  outputRate?: string;
}

/** Saves a new version of a model's price; requests already running keep theirs. */
export function useAddPrice() {
  const request = useAdminRequest();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (price: NewPrice) => request<{ id: string }>('/prices', json('POST', price)),
    onSuccess: refresh.prices,
  });
}
