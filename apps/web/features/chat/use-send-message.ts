'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApi } from '@/components/api/api-provider';
import { API_URL, errorMessage } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { ConversationDetail, Message, SendMessage } from '@/lib/api/types';
import { useUIStore } from '@/stores/ui-store-provider';
import { addConversation } from './chat-queries';

/**
 * Sends a prompt and streams the reply over SSE into the conversation's query cache. The stream
 * keeps running if the user leaves the page; the active stream (and its abort) is in the UI store.
 */
export function useSendMessage() {
  const { client, fetch, unwrap } = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations('chat');
  const setStream = useUIStore((state) => state.setStream);
  const setChatError = useUIStore((state) => state.setChatError);

  const updateMessages = (id: string, update: (messages: Message[]) => Message[]) =>
    queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(id), (current) =>
      current ? { ...current, messages: update(current.messages) } : current,
    );

  return async function send({
    conversationId,
    prompt,
    modelId,
  }: {
    conversationId?: string;
    prompt: string;
    modelId: string;
  }) {
    setChatError('');
    const abort = new AbortController();
    let id = conversationId;
    setStream({ conversationId: id ?? '', abort });
    try {
      if (!id) {
        const created = unwrap(await client.POST('/api/conversations', { body: {} }));
        id = created.id;
        addConversation(queryClient, created);
        setStream({ conversationId: id, abort });
        // The chat layout stays mounted, so the stream below is not interrupted.
        router.replace(`/c/${id}`);
      }
      const now = new Date().toISOString();
      const message = (role: Message['role'], content: string, status: Message['status']): Message => ({
        id: crypto.randomUUID(),
        conversationId: id!,
        role,
        content,
        status,
        modelId: role === 'ASSISTANT' ? modelId : null,
        requestId: null,
        createdAt: now,
        updatedAt: now,
      });
      const assistant = message('ASSISTANT', '', 'STREAMING');
      updateMessages(id, (messages) => [...messages, message('USER', prompt, 'COMPLETED'), assistant]);
      const setAssistant = (change: Partial<Message>) =>
        updateMessages(id!, (messages) =>
          messages.map((item) => (item.id === assistant.id ? { ...item, ...change } : item)),
        );

      const body: SendMessage = { content: prompt, modelId, requestId: crypto.randomUUID() };
      const response = await fetch(
        new Request(`${API_URL}/conversations/${id}/messages`, {
          method: 'POST',
          signal: abort.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(errorMessage(payload) || t('failedStatus', { status: response.status }));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1];
          const raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw) as { text?: string; message?: string };
          if (event === 'token' && data.text) {
            content += data.text;
            setAssistant({ content });
          }
          if (event === 'error') throw new Error(data.message || t('failed'));
        }
        if (done) break;
      }
      setAssistant({ status: 'COMPLETED' });
      // The server may have retitled the chat; the cached messages are refreshed on the next visit.
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id), refetchType: 'none' });
    } catch (cause) {
      const aborted = (cause as Error).name === 'AbortError';
      setChatError(aborted ? t('stopped') : (cause as Error).message);
      if (id)
        updateMessages(id, (messages) =>
          messages.map((item) =>
            item.status === 'STREAMING' ? { ...item, status: aborted ? 'INTERRUPTED' : 'ERROR' } : item,
          ),
        );
    } finally {
      setStream(null);
    }
  };
}
