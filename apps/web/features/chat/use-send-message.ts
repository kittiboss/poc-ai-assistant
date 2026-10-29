'use client';

import { useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useRouter } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useApi } from '@/components/api/api-provider';
import { apiUrl, errorMessage } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { AttachmentRef, ConversationDetail, Message, SendMessage } from '@/lib/api/types';
import type { QuotaRefusal } from '@/stores/ui-store';
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
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { modal } = App.useApp();
  const setStream = useUIStore((state) => state.setStream);
  const setChatError = useUIStore((state) => state.setChatError);
  const setQuotaRefusal = useUIStore((state) => state.setQuotaRefusal);
  const tUsage = useTranslations('modelUsage');
  const format = useFormatter();

  /** How much the message needed against how much is left, and what to do about it. */
  const quotaMessage = (quota: Omit<QuotaRefusal, 'modelId'>) => {
    const values = {
      scope: quota.scope,
      needed: format.number(quota.needed),
      left: format.number(Math.max(0, quota.limit - quota.used)),
      limit: format.number(quota.limit),
      time: format.dateTime(new Date(quota.resetsAt), { timeStyle: 'short' }),
    };
    if (quota.period === 'request') return tUsage('refusedPerRequest', values);
    return tUsage(quota.unit === 'requests' ? 'refusedRequests' : 'refusedTokens', values);
  };

  const updateMessages = (id: string, update: (messages: Message[]) => Message[]) =>
    queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(id), (current) =>
      current ? { ...current, messages: update(current.messages) } : current,
    );

  /**
   * Replaces the streamed chat with the saved one, which has the server's message ids (needed to
   * branch or rate a reply), the usage and the citations; the server may also have retitled it.
   * A stopped or failed reply is saved by the server on its own time, so a copy that is still behind
   * the screen is not used and is fetched again a little later.
   */
  const syncSaved = async (id: string) => {
    const key = queryKeys.conversation(id);
    const shown = queryClient.getQueryData<ConversationDetail>(key);
    const behind = (saved: ConversationDetail) =>
      saved.messages.length < (shown?.messages.length ?? 0) ||
      saved.messages.some((item) => item.status === 'STREAMING' || item.status === 'PENDING');
    for (const delay of [0, 500, 1000, 2000, 4000, 8000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      // Anything that changed the chat meanwhile (a new message, a refetch) is newer than this copy.
      if (queryClient.getQueryData(key) !== shown) break;
      const saved = await client.GET('/api/conversations/{id}', { params: { path: { id } } }).catch(() => null);
      if (queryClient.getQueryData(key) !== shown) break;
      if (saved?.data && !behind(saved.data)) {
        queryClient.setQueryData(key, saved.data);
        break;
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversationLists });
  };

  /**
   * False when the server refused the message before streaming (nothing was saved), so the caller can
   * give it back to the user, for example to send it again with another model.
   */
  return async function send({
    conversationId,
    prompt,
    attachments,
    modelId,
    useKnowledge,
  }: {
    conversationId?: string;
    /** May be empty when files are sent: the reply is then a short overview of them. */
    prompt: string;
    attachments: AttachmentRef[];
    modelId: string;
    /** Product catalog, or the central knowledge base in vendor-managed deployments. */
    useKnowledge: boolean;
  }) {
    setChatError('');
    const abort = new AbortController();
    let id = conversationId;
    setStream({ conversationId: id ?? '', abort });
    let completed = false;
    let accepted = false;
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
      const user = message('USER', prompt, 'COMPLETED');
      if (attachments.length) user.metadata = { attachments };
      updateMessages(id, (messages) => [...messages, user, assistant]);
      const setAssistant = (change: Partial<Message>) =>
        updateMessages(id!, (messages) =>
          messages.map((item) => (item.id === assistant.id ? { ...item, ...change } : item)),
        );

      const requestId = crypto.randomUUID();
      const post = (acknowledgeSensitive: boolean) => {
        const body: SendMessage = {
          content: prompt,
          modelId,
          requestId,
          acknowledgeSensitive,
          useKnowledge,
          useProductCatalog: false,
          ...(attachments.length ? { attachmentIds: attachments.map((file) => file.id), locale } : {}),
        };
        return fetch(
          new Request(`${apiUrl()}/conversations/${id}/messages`, {
            method: 'POST',
            signal: abort.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      };
      // Refusals the server marks with a code get this app's own wording (prepaid credit, rate limits, plan, files).
      const refusals: Record<string, string> = {
        CREDIT_EXHAUSTED: t('creditExhausted'),
        RATE_LIMITED: t('rateLimited'),
        MODEL_NOT_ENTITLED: t('modelNotEntitled'),
        ATTACHMENT_LIMIT: t('attachChatLimit'),
        ATTACHMENT_NOT_FOUND: t('attachMissing'),
        CONTEXT_TOO_LONG: t('contextTooLong'),
      };
      const refusal = (code?: string) => (code ? refusals[code] : undefined);
      type Refusal = { code?: string; canAcknowledge?: boolean; quota?: Omit<QuotaRefusal, 'modelId'> };
      function fail(payload: Refusal, status: number): never {
        // A quota refused it before anything was sent: say by how much, and let the usage bars show it.
        if (payload.code === 'QUOTA_EXCEEDED' && payload.quota) {
          setQuotaRefusal({ modelId, ...payload.quota });
          void queryClient.invalidateQueries({ queryKey: queryKeys.modelUsage });
          throw new Error(quotaMessage(payload.quota));
        }
        throw new Error(refusal(payload.code) || errorMessage(payload) || t('failedStatus', { status }));
      }
      let response = await post(false);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Refusal;
        // The workspace's sensitive-data policy can ask the user to confirm before context leaves the company.
        if (
          payload.code === 'SENSITIVE_CONTEXT' &&
          payload.canAcknowledge &&
          (await modal.confirm({
            title: t('sensitiveConfirm'),
            content: errorMessage(payload),
            okText: t('sendAnyway'),
            cancelText: tCommon('cancel'),
          }))
        )
          response = await post(true);
        else fail(payload, response.status);
      }
      if (!response.ok || !response.body) fail((await response.json().catch(() => ({}))) as Refusal, response.status);
      // The server has saved the message once it streams.
      accepted = true;
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
          const data = JSON.parse(raw) as { text?: string; message?: string; code?: string };
          if (event === 'token' && data.text) {
            content += data.text;
            setAssistant({ content });
          }
          if (event === 'done') completed = true;
          if (event === 'error') throw new Error(refusal(data.code) || data.message || t('failed'));
        }
        if (done) break;
      }
      if (!completed) throw new Error(t('connectionEnded'));
      setAssistant({ status: 'COMPLETED' });
      setQuotaRefusal(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.modelUsage });
    } catch (cause) {
      const aborted = (cause as Error).name === 'AbortError';
      // A stop may come after the server saved the message, so it is not given back.
      if (aborted) accepted = true;
      setChatError(aborted ? t('stopped') : (cause as Error).message);
      if (id)
        updateMessages(id, (messages) =>
          messages.map((item) =>
            item.status === 'STREAMING' ? { ...item, status: aborted ? 'INTERRUPTED' : 'ERROR' } : item,
          ),
        );
    } finally {
      if (id) {
        const sync = syncSaved(id);
        // A finished reply is saved at once, so its buttons appear with the server's ids. A stopped or
        // failed one can take the server a few seconds, which the user does not wait for.
        if (completed) await sync;
      }
      setStream(null);
    }
    return accepted;
  };
}
