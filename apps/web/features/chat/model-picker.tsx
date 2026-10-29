'use client';
import { Drawer, Grid, Select } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { StatusTag } from '@/components/ui/status-tag';
import { ModelUsageLine, useModelUsage } from '@/features/usage/model-usage';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { Model, ModelUsage } from '@/lib/api/types';
import { cn } from '@/lib/cn';

type Option = { value: string; label: string; disabled: boolean; model: Model };

/**
 * The model for the next message. The field shows the name only; each choice adds where the model
 * runs, whether it can be used now, its provider and how close today's use is to its limit. A
 * dropdown on a wider screen, a drawer on a phone.
 */
export function ModelPicker({
  models,
  value,
  disabled,
  onChange,
}: {
  models: Model[];
  value: string;
  disabled: boolean;
  onChange: (modelId: string) => void;
}) {
  const t = useTranslations('chat');
  // Unknown before the first measure, which counts as wide, like the sidebar.
  const phone = Grid.useBreakpoint().md === false;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Usage follows live only while the choices are on screen, and is fresh the moment they open.
  const choosing = phone ? drawerOpen : listOpen;
  const usageQuery = useModelUsage(choosing);
  const { refetch } = usageQuery;
  useEffect(() => {
    if (choosing) void refetch();
  }, [choosing, refetch]);
  const usage = usageQuery.data;

  return (
    <>
      <Select<string, Option>
        aria-label={t('chatModel')}
        className="max-w-48 min-w-0 flex-1"
        value={value || undefined}
        disabled={disabled}
        onChange={onChange}
        // A phone opens the drawer in place of the list.
        open={phone ? false : undefined}
        onOpenChange={(open) => {
          setListOpen(open);
          if (phone && open) setDrawerOpen(true);
        }}
        popupMatchSelectWidth={352}
        classNames={{ popup: { listItem: 'py-1' } }}
        // About six models with their usage lines fit; more scroll. A plain list keeps its scroll bar
        // in view, and the options' own text is what screen readers read.
        listHeight={360}
        virtual={false}
        options={models.map((model) => ({
          value: model.id,
          label: model.displayName,
          disabled: !model.available,
          model,
        }))}
        optionRender={(option) => <ModelOption model={option.data.model} usage={usage} />}
      />
      <Drawer
        placement="bottom"
        size="auto"
        title={t('chatModel')}
        open={phone && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        // Capped on the panel, so a long list scrolls under the header.
        styles={{ section: { maxHeight: '80dvh' }, body: { padding: 8 } }}
      >
        <div className="flex flex-col gap-1 pb-[env(safe-area-inset-bottom)]">
          {models.map((model) => {
            const selected = model.id === value;
            return (
              <button
                key={model.id}
                type="button"
                disabled={!model.available}
                aria-current={selected || undefined}
                onClick={() => {
                  onChange(model.id);
                  setDrawerOpen(false);
                }}
                className={cn(
                  'rounded-brand px-3 py-2 text-left transition-colors disabled:cursor-not-allowed',
                  selected ? 'bg-primary-soft' : 'enabled:hover:bg-fill-tertiary',
                )}
              >
                <ModelOption model={model} usage={usage} />
              </button>
            );
          })}
        </div>
      </Drawer>
    </>
  );
}

/** Name and where it runs, whether it can be used now, then the provider and today's usage on smaller lines. */
function ModelOption({ model, usage }: { model: Model; usage?: ModelUsage }) {
  const enums = useEnumLabel();
  return (
    // A model that cannot be picked fades as a whole, its tags too.
    <div className={cn('flex min-w-0 flex-col gap-0.5', !model.available && 'opacity-50')}>
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold text-fg">{model.displayName}</span>
        <StatusTag tone={model.local ? 'success' : 'warning'} className="shrink-0">
          {enums.label('location', model.local ? 'LOCAL' : 'EXTERNAL')}
        </StatusTag>
        <StatusTag tone={model.available ? 'success' : 'neutral'} className="ms-auto shrink-0">
          {enums.modelStatus(model.status)}
        </StatusTag>
      </div>
      <span className="truncate text-xs text-fg-secondary">{model.provider}</span>
      <ModelUsageLine modelId={model.id} usage={usage} />
    </div>
  );
}
