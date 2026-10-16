'use client';

import { Button } from 'antd';
import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { Message } from '@/lib/api/types';
import { MessageBubble } from './message-bubble';
import { useStickToBottom } from './use-stick-to-bottom';

/** Scrollable message area; follows a streaming reply until the user scrolls up. */
export function MessageList({ messages, children }: { messages: Message[]; children?: React.ReactNode }) {
  const t = useTranslations('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { isAtBottom, scrollToBottom } = useStickToBottom(scrollRef, contentRef);

  // Opening a chat or sending a message always jumps to the end, even if the user had scrolled up.
  const lastUserMessageId = messages.findLast((message) => message.role === 'USER')?.id;
  useEffect(() => {
    if (lastUserMessageId) scrollToBottom();
  }, [lastUserMessageId, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-7 px-4 py-6 md:px-6 md:py-10">
          {children}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      </div>
      {!isAtBottom && (
        <Button
          shape="circle"
          icon={<ArrowDown size={16} />}
          aria-label={t('scrollToBottom')}
          title={t('scrollToBottom')}
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
        />
      )}
    </div>
  );
}
