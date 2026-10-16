'use client';

import { Actions, Bubble } from '@ant-design/x';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { memo } from 'react';
import { useEnumLabel } from '@/i18n/use-enum-label';
import type { Message } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { MarkdownContent } from './markdown-content';

// Memoized: while a reply streams, only the message that changed re-renders.
export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const t = useTranslations('chat');
  const enums = useEnumLabel();

  if (message.role === 'USER') {
    return (
      <Bubble
        placement="end"
        content={message.content}
        classNames={{
          content:
            'max-w-[86%] whitespace-pre-wrap rounded-brand-lg bg-primary px-4 py-3 text-sm leading-6 text-on-primary',
        }}
      />
    );
  }

  const streaming = message.status === 'STREAMING' || message.status === 'PENDING';
  const footer = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      {message.status !== 'COMPLETED' && (
        <span className={cn('flex items-center gap-1', message.status === 'ERROR' ? 'text-error' : 'text-fg-tertiary')}>
          {streaming && <LoaderCircle className="animate-spin" size={11} />}
          {enums.label('messageStatus', message.status)}
        </span>
      )}
      {!streaming && message.content && (
        <Actions items={[{ key: 'copy', label: t('copy'), actionRender: <Actions.Copy text={message.content} /> }]} />
      )}
    </div>
  );

  return (
    <Bubble
      placement="start"
      variant="outlined"
      loading={streaming && !message.content}
      content={message.content}
      contentRender={(content) => <MarkdownContent content={String(content)} streaming={streaming} />}
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
