'use client';

import { Sender } from '@ant-design/x';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface ChatComposerProps {
  /** A reply is streaming: the send button becomes a stop button */
  generating: boolean;
  /** False while no available model is selected */
  canSend: boolean;
  disabled?: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
}

export function ChatComposer({ generating, canSend, disabled = false, onSend, onStop }: ChatComposerProps) {
  const t = useTranslations('chat');
  // The draft survives switching chats, because the chat layout stays mounted.
  const [draft, setDraft] = useState('');

  return (
    <Sender
      value={draft}
      onChange={(value) => setDraft(value)}
      onSubmit={(value) => {
        const prompt = value.trim();
        if (!prompt || generating || !canSend) return;
        setDraft('');
        onSend(prompt);
      }}
      loading={generating}
      onCancel={onStop}
      disabled={disabled}
      placeholder={t('placeholder')}
      autoSize={{ minRows: 1, maxRows: 6 }}
      className="bg-surface shadow-lg"
      // Named buttons (the defaults only carry an icon); send also waits for an available model.
      suffix={(_, { components: { SendButton, LoadingButton } }) =>
        generating ? (
          <LoadingButton title={t('stop')} aria-label={t('stop')} />
        ) : (
          <SendButton title={t('send')} aria-label={t('send')} disabled={!canSend || !draft.trim()} />
        )
      }
    />
  );
}
