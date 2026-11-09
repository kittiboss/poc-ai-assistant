'use client';

import { useQuery } from '@tanstack/react-query';
import type { Billing, Price, RagUsage, Tenant, UsageToday } from '@/lib/api/types';
import { useAdminRequest } from './api-provider';

/** Credit and usage change with every customer request: refreshed while the page is visible. */
const LIVE = 10_000;

export function useTenants() {
  const request = useAdminRequest();
  return useQuery({ queryKey: ['tenants'], queryFn: () => request<Tenant[]>('/tenants'), refetchInterval: LIVE });
}

export function useBilling(id: string) {
  const request = useAdminRequest();
  return useQuery({
    queryKey: ['tenants', id, 'billing'],
    queryFn: () => request<Billing>(`/tenants/${encodeURIComponent(id)}/billing`),
    refetchInterval: LIVE,
  });
}

export function useUsageToday() {
  const request = useAdminRequest();
  return useQuery({
    queryKey: ['usage', 'today'],
    queryFn: () => request<UsageToday>('/usage/today'),
    refetchInterval: LIVE,
  });
}

/** From the RAG engine, through vendor-control; the limits still show while it is down. */
export function useRagUsage() {
  const request = useAdminRequest();
  return useQuery({
    queryKey: ['usage', 'knowledge'],
    queryFn: () => request<RagUsage>('/rag/usage'),
    refetchInterval: LIVE,
    retry: false,
  });
}

/** The latest version of each model's price. */
export function usePrices() {
  const request = useAdminRequest();
  return useQuery({ queryKey: ['prices'], queryFn: () => request<Price[]>('/prices') });
}

/** The latest 100 price versions of all models. */
export function usePriceHistory() {
  const request = useAdminRequest();
  return useQuery({ queryKey: ['prices', 'history'], queryFn: () => request<Price[]>('/prices/history') });
}
