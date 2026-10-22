'use client';

import { useTranslations } from 'next-intl';

type EnumGroup =
  | 'messageStatus'
  | 'requestStatus'
  | 'usageKind'
  | 'strategy'
  | 'location'
  | 'auditAction'
  | 'entityType';

// The API sends model availability as English phrases; these map them to message keys.
const modelStatusKeys: Record<string, string> = {
  Available: 'available',
  'Ready (disabled)': 'readyDisabled',
  Disabled: 'disabled',
  'Not permitted': 'notPermitted',
  'Not configured': 'notConfigured',
  'Daily limit reached': 'dailyLimitReached',
  'Credit exhausted': 'creditExhausted',
  Unavailable: 'unavailable',
};

/** Labels for values the API sends. A value without a translation is shown as it is. */
export function useEnumLabel() {
  const t = useTranslations('enums');
  const translate = (key: string, fallback: string) => {
    const path = key as Parameters<typeof t>[0];
    return t.has(path) ? t(path) : fallback;
  };
  return {
    label: (group: EnumGroup, value: string) => translate(`${group}.${value}`, value),
    modelStatus: (status: string) =>
      modelStatusKeys[status] ? translate(`modelStatus.${modelStatusKeys[status]}`, status) : status,
  };
}
