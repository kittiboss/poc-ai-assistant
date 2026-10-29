'use client';
import { runtimeConfig } from '@/lib/runtime-config';

import { Actions, Bubble, type ActionsProps } from '@ant-design/x';
import { Button, Tooltip } from 'antd';
import { Download, GitBranch, LoaderCircle, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { memo } from 'react';
import { costFormat } from '@/i18n/formats';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { Message } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { download } from '@/lib/download';
import type { Rating } from './chat-queries';
import { MarkdownContent } from './markdown-content';

type ActionItem = ActionsProps['items'][number];

/** What the buttons under a message do. ChatApp keeps this object the same between renders. */
export interface MessageActions {
  branch: (message: Message) => void;
  edit: (message: Message) => void;
  regenerate: (message: Message) => void;
  rate: (message: Message, rating: Rating) => void;
}

interface MessageBubbleProps {
  message: Message;
  /** The model's display name, shown above a reply */
  modelName?: string;
  actions: MessageActions;
  /** False while a reply is generating: the actions that send or branch are hidden */
  canChange: boolean;
}

// Memoized: while a reply streams, only the message that changed re-renders.
export const MessageBubble = memo(function MessageBubble({
  message,
  modelName,
  actions,
  canChange,
}: MessageBubbleProps) {
  const t = useTranslations('chat');
  const enums = useEnumLabel();
  const format = useFormatter();
  const { tool, filename } = message.metadata;
  const streaming = message.status === 'STREAMING' || message.status === 'PENDING';
  // A real button with a name: an Actions item on its own is an unlabelled div that keyboards cannot reach.
  const action = (
    key: string,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    pressed?: boolean,
  ): ActionItem => ({
    key,
    actionRender: (
      <Tooltip title={label}>
        <Button
          type="text"
          size="small"
          icon={icon}
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn('text-fg-tertiary', pressed && 'text-primary')}
        />
      </Tooltip>
    ),
  });
  const copy: ActionItem = {
    key: 'copy',
    label: message.role === 'USER' ? t('copyText') : t('copy'),
    actionRender: <Actions.Copy text={message.content} />,
  };
  const branch = action('branch', t('branch'), <GitBranch size={14} />, () => actions.branch(message));

  if (message.role === 'USER') {
    const items = [
      copy,
      ...(canChange && !tool
        ? [action('edit', t('editResend'), <Pencil size={14} />, () => actions.edit(message))]
        : []),
      ...(canChange ? [branch] : []),
    ];
    return (
      <Bubble
        placement="end"
        content={message.content}
        footerPlacement="outer-end"
        // Shown on hover or focus, and always on touch screens.
        footer={
          <Actions
            items={items}
            className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
          />
        }
        className="w-full"
        classNames={{
          root: 'group',
          body: 'max-w-[86%]',
          content: 'whitespace-pre-wrap rounded-brand-lg bg-primary px-4 py-3 text-sm leading-6 text-on-primary',
        }}
      />
    );
  }

  const usage = message.usage;
  const money = (value: string) => format.number(Number(value), costFormat(usage?.currency || 'USD', 6));
  const footer = (
    <div className="flex flex-col gap-1">
      {usage && (
        <p className="text-[11px] text-fg-tertiary">
          {runtimeConfig().vendorManaged
            ? `${format.number(usage.inputTokens)} in · ${format.number(usage.outputTokens)} out · ${format.number(usage.durationMs)} ms`
            : t('usageLine', {
                input: format.number(usage.inputTokens),
                output: format.number(usage.outputTokens),
                duration: format.number(usage.durationMs),
                kind: enums.label('usageKind', usage.usageKind),
                cost: money(usage.actualProviderCost),
                charge: money(usage.customerCharge),
              })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {message.status !== 'COMPLETED' && (
          <span
            className={cn('flex items-center gap-1', message.status === 'ERROR' ? 'text-error' : 'text-fg-tertiary')}
          >
            {streaming && <LoaderCircle className="animate-spin" size={11} />}
            {enums.label('messageStatus', message.status)}
          </span>
        )}
        {!streaming && message.content && (
          <Actions
            items={[
              copy,
              ...(canChange && !tool
                ? [action('regenerate', t('regenerate'), <RefreshCw size={14} />, () => actions.regenerate(message))]
                : []),
              ...(canChange ? [branch] : []),
              // Both ratings stay visible, so a reply can be re-rated (the API cannot clear a rating).
              action(
                'helpful',
                t('helpful'),
                <ThumbsUp size={14} />,
                () => actions.rate(message, 1),
                message.feedback === 1,
              ),
              action(
                'unhelpful',
                t('unhelpful'),
                <ThumbsDown size={14} />,
                () => actions.rate(message, -1),
                message.feedback === -1,
              ),
            ]}
          />
        )}
      </div>
    </div>
  );

  return (
    <Bubble
      placement="start"
      variant="outlined"
      loading={streaming && !message.content}
      header={
        (tool || modelName) && (
          <span className="text-xs text-fg-secondary">{tool ? t('localTool', { tool }) : modelName}</span>
        )
      }
      content={message.content}
      contentRender={(content) => (
        <>
          <MarkdownContent content={String(content)} streaming={streaming} />
          {filename && (
            <Button
              size="small"
              className="mt-3"
              icon={<Download size={14} />}
              onClick={() => download(filename, message.metadata.content || '', message.metadata.mime)}
            >
              {t('downloadFile', { filename })}
            </Button>
          )}
        </>
      )}
      footer={footer}
      // The body is capped like the original bubble; min-w-0 lets a long code line scroll inside
      // its block instead of widening the chat on small screens.
      className="w-full"
      classNames={{
        body: 'min-w-0 max-w-[86%]',
        content: 'min-w-0 max-w-full rounded-brand-lg border-line-secondary bg-surface px-4 py-3 text-sm leading-6',
      }}
    />
  );
});
