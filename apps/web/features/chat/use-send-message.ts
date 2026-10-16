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
        citations: [],
        metadata: {},
        feedback: null,
        feedbackComment: null,
        createdAt: now,
        updatedAt: now,
      });
      const assistant = message('ASSISTANT', '', 'STREAMING');
      updateMessages(id, (messages) => [...messages, message('USER', prompt, 'COMPLETED'), assistant]);
      const setAssistant = (change: Partial<Message>) =>
        updateMessages(id!, (messages) =>
          messages.map((item) => (item.id === assistant.id ? { ...item, ...change } : item)),
        );

      const requestId = crypto.randomUUID();
      const post = (acknowledgeSensitive: boolean) => {
        const body: SendMessage = { content: prompt, modelId, requestId, acknowledgeSensitive };
        return fetch(
          new Request(`${API_URL}/conversations/${id}/messages`, {
            method: 'POST',
            signal: abort.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      };
      let response = await post(false);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string; canAcknowledge?: boolean };
        // The workspace's sensitive-data policy can ask the user to confirm before context leaves the company.
        if (
          payload.code === 'SENSITIVE_CONTEXT' &&
          payload.canAcknowledge &&
          window.confirm(t('sensitiveConfirm', { message: errorMessage(payload) ?? '' }))
        )
          response = await post(true);
        else throw new Error(errorMessage(payload) || t('failedStatus', { status: response.status }));
      }
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(errorMessage(payload) || t('failedStatus', { status: response.status }));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let completed = false;
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
          if (event === 'done') completed = true;
          if (event === 'error') throw new Error(data.message || t('failed'));
        }
        if (done) break;
      }
      if (!completed) throw new Error(t('connectionEnded'));
      setAssistant({ status: 'COMPLETED' });
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
      if (id) {
        // The saved chat has the server's message ids (needed to branch or rate a reply), the usage and
        // the citations; the server may also have retitled it.
        const saved = await client.GET('/api/conversations/{id}', { params: { path: { id } } }).catch(() => null);
        if (saved?.data) queryClient.setQueryData(queryKeys.conversation(id), saved.data);
        await queryClient.invalidateQueries({ queryKey: queryKeys.conversationLists });
      }
      setStream(null);
    }
  };
}
