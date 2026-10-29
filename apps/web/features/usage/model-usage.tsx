'use client';

import { useQuery } from '@tanstack/react-query';
import { Progress } from 'antd';
import { useFormatter, useTranslations } from 'next-intl';
import { useApi } from '@/components/api/api-provider';
import { StatusTag } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { queryKeys } from '@/lib/api/query-keys';
import type { ModelUsage } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';

type Meter = ModelUsage['external']['tokens'];
type ModelRow = ModelUsage['models'][number];
type Unit = 'requests' | 'tokens';
type Limit = { meter: Meter; unit: Unit; shared: boolean };

/**
 * The organization's use of each model today, as admission counts it. While `live`, it follows the
 * server's polling pace; otherwise it loads once and refreshes only when asked.
 */
export function useModelUsage(live: boolean) {
  const { client, unwrap } = useApi();
  return useQuery<ModelUsage>({
    queryKey: queryKeys.modelUsage,
    queryFn: async ({ signal }) => unwrap(await client.GET('/api/usage/models', { signal, cache: 'no-store' })),
    refetchInterval: (query) =>
      !live ? false : query.state.status === 'error' ? 15_000 : Math.max(2000, query.state.data?.pollAfterMs ?? 5000),
    // The bars are a hint; their absence must never get in the way of chatting.
    retry: false,
  });
}

/** What admission counts: completed usage plus what running requests hold. */
const counted = (meter: Meter) => meter.used + meter.reserved;
/** Share of the limit taken; a zero limit is full from the start. */
const ratio = (meter: Meter) =>
  meter.limit === null ? 0 : meter.limit === 0 ? 1 : Math.min(1, counted(meter) / meter.limit);

/** The limits that can stop this model today, the nearest to running out first. */
function limitsFor(model: ModelRow, usage: ModelUsage): Limit[] {
  const own: Limit[] = [
    { meter: model.requests, unit: 'requests', shared: false },
    { meter: model.tokens, unit: 'tokens', shared: false },
  ];
  const shared: Limit[] = model.external
    ? [
        { meter: usage.external.requests, unit: 'requests', shared: true },
        { meter: usage.external.tokens, unit: 'tokens', shared: true },
      ]
    : [];
  return [...own, ...shared]
    .filter((limit) => limit.meter.limit !== null)
    .sort((a, b) => ratio(b.meter) - ratio(a.meter));
}

/** What is left before the limit; nothing when there is none. */
const left = (meter: Meter) => Math.max(0, (meter.limit ?? 0) - counted(meter));

/**
 * What the latest refused message would have reserved, when this limit refused it: the bar then
 * says why the message did not fit although the limit is not full. The shared limit shows it on
 * the pool and on the model that was refused; a model's quota on that model.
 */
function useRefusedNeed(scope: 'INSTALLATION' | 'MODEL', unit: Unit, modelId?: string) {
  const refusal = useUIStore((state) => state.quotaRefusal);
  if (!refusal || refusal.period !== 'day' || refusal.unit !== 'tokens' || unit !== 'tokens') return undefined;
  if (refusal.scope !== scope) return undefined;
  if (modelId && (scope === 'MODEL' ? refusal.subject : refusal.modelId) !== modelId) return undefined;
  return refusal.needed;
}

/** Green, amber from 80% of the limit, red once it is reached. */
const tone = (share: number) =>
  share >= 1 ? 'var(--app-color-error)' : share >= 0.8 ? 'var(--app-color-warning)' : 'var(--app-color-success)';

/**
 * A thin bar against a limit, labelled with what is left; the empty part is always what is left.
 * With `part`, the limit is shared: the bar shows how full it is for everyone, and the label adds
 * this model's own use. With `refused`, the latest message needed more than is left, so the bar
 * turns red and says how much it needed.
 */
function UsageBar({
  meter,
  unit,
  part,
  note,
  refused,
}: {
  meter: Meter;
  unit: Unit;
  part?: Meter;
  note?: string;
  refused?: number;
}) {
  const t = useTranslations('modelUsage');
  const format = useFormatter();
  const blocked = refused !== undefined && refused > left(meter);
  const share = ratio(meter);
  const color = tone(blocked ? 1 : share);
  const values = { left: format.number(left(meter)), limit: format.number(meter.limit ?? 0) };
  const running = meter.reserved > 0 ? ` · ${t('running', { count: format.number(meter.reserved) })}` : '';
  return (
    <div className="min-w-0">
      <Progress percent={share * 100} showInfo={false} size="small" strokeColor={color} />
      <p className={cn('truncate text-[11px]', share >= 1 || blocked ? 'text-error' : 'text-fg-secondary')}>
        {part
          ? t(unit === 'tokens' ? 'sharedTokens' : 'sharedRequests', { ...values, part: format.number(part.used) })
          : t(unit, values)}
        {running}
        {note && ` · ${note}`}
      </p>
      {blocked && (
        <p className="truncate text-[11px] text-error">{t('lastNeeded', { needed: format.number(refused) })}</p>
      )}
    </div>
  );
}

/** One line under a model in the picker: the limit closest to stopping it, or today's count when none applies. */
export function ModelUsageLine({ modelId, usage }: { modelId: string; usage?: ModelUsage }) {
  const t = useTranslations('modelUsage');
  const format = useFormatter();
  const sharedNeed = useRefusedNeed('INSTALLATION', 'tokens', modelId);
  const ownNeed = useRefusedNeed('MODEL', 'tokens', modelId);
  const model = usage?.models.find((row) => row.modelId === modelId);
  if (!usage || !model) return null;
  // The limit that refused this model's latest message comes first, otherwise the fullest one.
  const limits = limitsFor(model, usage);
  const nearest =
    limits.find((limit) => limit.unit === 'tokens' && (limit.shared ? sharedNeed : ownNeed) !== undefined) ?? limits[0];
  if (nearest?.shared)
    return (
      <UsageBar
        meter={nearest.meter}
        unit={nearest.unit}
        part={model[nearest.unit]}
        refused={nearest.unit === 'tokens' ? sharedNeed : undefined}
      />
    );
  if (nearest)
    return (
      <UsageBar
        meter={nearest.meter}
        unit={nearest.unit}
        note={t('modelLimit')}
        refused={nearest.unit === 'tokens' ? ownNeed : undefined}
      />
    );
  return (
    <p className="truncate text-[11px] text-fg-secondary">
      {t('noLimit', { requests: format.number(model.requests.used), tokens: format.number(model.tokens.used) })}
    </p>
  );
}

/**
 * A bar against `meter`'s own limit (the model's quota on a model's row); for an external model
 * without one, the shared external limit with its own use in the label; otherwise just today's count.
 */
function MeterCell({
  label,
  meter,
  unit,
  shared,
  modelId,
}: {
  label: string;
  meter: Meter;
  unit: Unit;
  shared?: Meter;
  /** Set on a model's row; absent on the shared pool's */
  modelId?: string;
}) {
  const t = useTranslations('modelUsage');
  const format = useFormatter();
  const sharedNeed = useRefusedNeed('INSTALLATION', unit, modelId);
  const ownNeed = useRefusedNeed('MODEL', unit, modelId);
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-secondary">{label}</p>
      {meter.limit !== null ? (
        <UsageBar
          meter={meter}
          unit={unit}
          note={modelId ? t('modelLimit') : undefined}
          refused={modelId ? ownNeed : sharedNeed}
        />
      ) : shared ? (
        <UsageBar meter={shared} unit={unit} part={meter} refused={sharedNeed} />
      ) : (
        <p className="font-mono text-sm">
          {format.number(meter.used)}
          {meter.reserved > 0 && (
            <span className="ms-1 text-[11px] text-fg-secondary">
              {t('running', { count: format.number(meter.reserved) })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Every model's requests and tokens today, with the shared external limit first. A model's bar is
 * its MODEL quota when an administrator set one, otherwise the shared external limit.
 */
export function ModelUsageList({ usage }: { usage?: ModelUsage }) {
  const t = useTranslations('modelUsage');
  const enums = useEnumLabel();
  if (!usage) return <p className="text-sm text-fg-secondary">{t('loading')}</p>;
  return (
    <div className="divide-y divide-line-secondary">
      <div className="pb-4">
        <p className="font-medium">{t('external')}</p>
        <p className="mb-2 text-xs text-fg-secondary">{t('externalNote')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <MeterCell label={t('requestsLabel')} meter={usage.external.requests} unit="requests" />
          <MeterCell label={t('tokensLabel')} meter={usage.external.tokens} unit="tokens" />
        </div>
      </div>
      {usage.models.map((model) => (
        <div key={model.modelId} className="py-4 last:pb-0">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{model.displayName}</span>
            <StatusTag tone={model.local ? 'success' : 'warning'} className="shrink-0">
              {enums.label('location', model.local ? 'LOCAL' : 'EXTERNAL')}
            </StatusTag>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MeterCell
              label={t('requestsLabel')}
              meter={model.requests}
              unit="requests"
              shared={model.external ? usage.external.requests : undefined}
              modelId={model.modelId}
            />
            <MeterCell
              label={t('tokensLabel')}
              meter={model.tokens}
              unit="tokens"
              shared={model.external ? usage.external.tokens : undefined}
              modelId={model.modelId}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Everyone in the organization · resets at 07:00", in the viewer's time zone. */
export function ModelUsageNote({ usage }: { usage?: ModelUsage }) {
  const t = useTranslations('modelUsage');
  const format = useFormatter();
  return (
    <>
      {t('description', {
        time: usage ? format.dateTime(new Date(usage.resetsAt), { timeStyle: 'short' }) : '—',
      })}
    </>
  );
}
