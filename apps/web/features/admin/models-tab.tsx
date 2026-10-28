'use client';
import { Alert } from 'antd';
import { runtimeConfig } from '@/lib/runtime-config';
import { useAdminModels, useAdminPricing, useAdminUsers } from './admin-queries';
import { ModelRegistry } from './model-registry';
import { PricingSection } from './pricing-section';
import { UserPermissions } from './user-permissions';

/** Which models exist, what they cost and who may use them. */
export function ModelsTab() {
  const vendor = runtimeConfig().vendorManaged;
  const models = useAdminModels();
  const pricing = useAdminPricing();
  const users = useAdminUsers();
  const loadError = [models, pricing, users].find((query) => query.error)?.error?.message;
  const modelList = models.data ?? [];

  return (
    <>
      {loadError && <Alert type="error" showIcon title={loadError} />}
      <ModelRegistry models={modelList} loading={models.isPending} />
      {!vendor && <PricingSection models={modelList} pricing={pricing.data ?? []} loading={pricing.isPending} />}
      <UserPermissions users={users.data ?? []} models={modelList} loading={users.isPending} />
    </>
  );
}
