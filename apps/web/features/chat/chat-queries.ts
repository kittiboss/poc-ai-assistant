'use client';

import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { useApi } from '@/components/api/api-provider';
import { ApiError, apiUrl, errorMessage } from '@/lib/api/client';
import { queryKeys, type ConversationFilters } from '@/lib/api/query-keys';
import type {
  Attachment,
  Conversation,
  ConversationChange,
  ConversationDetail,
  ConversationSummary,
  KnowledgeStatus,
  Message,
  Model,
} from '@/lib/api/types';
import { recheckAfter, recheckHelps } from './model-recheck';
import { isImage } from './prepare-image';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Conversation ids are UUIDs; anything else in the URL cannot be a conversation (the API answers 400). */
export const isConversationId = (id: string | undefined): id is string => Boolean(id && UUID.test(id));

/**
 * The models the user may chat with. While none can be used because the gateway is unreachable for now,
 * or the API itself fails, the list is checked again, less often each time (model-recheck.ts); a hidden
 * tab does not check.
 */
export function useModels() {
  const { client, unwrap } = useApi();
  // Checks in a row that found no model to use, or failed.
  const misses = useRef(0);
  return useQuery<Model[]>({
    queryKey: queryKeys.models,
    queryFn: async ({ signal }) => {
      try {
        const models = unwrap(await client.GET('/api/models', { signal }));
        misses.current = recheckHelps(models) ? misses.current + 1 : 0;
        return models;
      } catch (error) {
        misses.current += 1;
        throw error;
      }
    },
    // The checks below take the place of retries, so each failed check counts once.
    retry: false,
    refetchInterval: (query) => {
      const { data, error } = query.state;
      // A client error (an expired session, say) does not go away by asking again.
      const helps = error ? !(error instanceof ApiError && error.status < 500) : Boolean(data && recheckHelps(data));
      return helps ? recheckAfter(misses.current) : false;
    },
  });
}

/** Catalog availability is optional; a failed status request must not block normal chat. */
export function useKnowledgeStatus() {
  const { request } = useApi();
  return useQuery<KnowledgeStatus>({
    queryKey: queryKeys.knowledge,
    queryFn: () => request<KnowledgeStatus>('/knowledge/status'),
    retry: false,
  });
}

export function useConversations(filters: ConversationFilters) {
  const { client, unwrap } = useApi();
  return useQuery<ConversationSummary[]>({
    queryKey: queryKeys.conversationList(filters),
    queryFn: async ({ signal }) =>
      unwrap(
        await client.GET('/api/conversations', {
          params: {
            query: { search: filters.search || undefined, archived: filters.archived ? 'true' : 'false' },
          },
          signal,
        }),
      ),
    // Keep the current list on screen while a new search loads.
    placeholderData: (previous) => previous,
  });
}

/** `streaming`: a reply is being written into this conversation's cache, so it must not be refetched. */
export function useConversation(id: string | undefined, streaming: boolean) {
  const { client, unwrap } = useApi();
  return useQuery<ConversationDetail>({
    queryKey: queryKeys.conversation(id ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(await client.GET('/api/conversations/{id}', { params: { path: { id: id! } }, signal })),
    enabled: isConversationId(id) && !streaming,
    refetchOnWindowFocus: false,
  });
}

/** Changes every cached list of conversations, whatever its filter. */
function updateLists(
  queryClient: QueryClient,
  update: (items: ConversationSummary[], filters: ConversationFilters) => ConversationSummary[],
) {
  for (const [key, items] of queryClient.getQueriesData<ConversationSummary[]>({
    queryKey: queryKeys.conversationLists,
  })) {
    if (items) queryClient.setQueryData(key, update(items, key[2] as ConversationFilters));
  }
}

/** Adds a conversation created for a first message to the unfiltered list and caches it as an empty chat. */
export function addConversation(queryClient: QueryClient, conversation: Conversation) {
  updateLists(queryClient, (items, filters) =>
    filters.archived || filters.search ? items : [{ ...conversation, _count: { messages: 0 } }, ...items],
  );
  queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(conversation.id), {
    ...conversation,
    messages: [],
  });
}

/** Rename, pin or archive. Pinning reorders and archiving moves the chat between lists, so lists refetch. */
export function useUpdateConversation() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, change }: { id: string; change: ConversationChange }) =>
      unwrap(await client.PATCH('/api/conversations/{id}', { params: { path: { id } }, body: change })),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(updated.id), (current) =>
        current ? { ...current, ...updated, messages: current.messages } : current,
      );
      return queryClient.invalidateQueries({ queryKey: queryKeys.conversationLists });
    },
  });
}

export function useDeleteConversation() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await client.DELETE('/api/conversations/{id}', { params: { path: { id } } })),
    // The deleted chat's own cache entry is left to expire: removing it while the page still shows
    // that chat would make the query fetch it again and get a 404.
    onSuccess: (_, id) => updateLists(queryClient, (items) => items.filter((item) => item.id !== id)),
  });
}

/**
 * Copies a chat up to a message (`before`: excluding it) into a new chat, and caches that chat with
 * its messages so a reply can be streamed into it straight away.
 */
export function useBranchConversation() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, messageId, before }: { id: string; messageId: string; before?: boolean }) => {
      const branch = unwrap(
        await client.POST('/api/conversations/{id}/branch', {
          params: { path: { id } },
          body: { messageId, before },
        }),
      );
      const detail = unwrap(await client.GET('/api/conversations/{id}', { params: { path: { id: branch.id } } }));
      queryClient.setQueryData(queryKeys.conversation(detail.id), detail);
      return detail;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.conversationLists }),
  });
}

/** Why the API refused a file: its code without the ATTACHMENT_ prefix (see docs/CHAT_ATTACHMENTS.md). */
const ATTACHMENT_PROBLEMS = ['TYPE', 'SIZE', 'UNREADABLE', 'NO_TEXT', 'TOO_LONG', 'BUSY'] as const;

/**
 * Files for the next message. The API keeps a document's extracted text and an image's file; a
 * refused file comes back with a code, so the error is worded here in the user's language.
 */
export function useAttachmentApi() {
  const { fetch } = useApi();
  const t = useTranslations('chat');
  const tErrors = useTranslations('errors');
  return {
    async upload(file: File, signal: AbortSignal) {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(new Request(`${apiUrl()}/attachments`, { method: 'POST', body: form, signal }));
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) return body as Attachment;
      const code = (body as { code?: string } | null)?.code?.replace(/^ATTACHMENT_/, '');
      // Over 5 MB is refused by the upload limit itself, without a code.
      const problem = response.status === 413 ? 'SIZE' : ATTACHMENT_PROBLEMS.find((item) => item === code);
      throw new Error(
        problem
          ? t(`attachError.${problem === 'SIZE' && isImage(file) ? 'IMAGE_SIZE' : problem}`)
          : (errorMessage(body) ?? tErrors('requestFailed', { status: response.status })),
      );
    },
    /** Only a file that was not sent can be removed; an unsent one left behind is removed by the API after a day. */
    remove: (id: string) => fetch(new Request(`${apiUrl()}/attachments/${id}`, { method: 'DELETE' })),
  };
}

/**
 * Image attachments as object URLs. An <img> cannot send the bearer token, so each file is fetched
 * with it; a file never changes, so it is fetched once and its URL revoked when the cache lets it go.
 * A fetch is not cancelled when its message unmounts, so a remount shares it instead of fetching again.
 */
export function useAttachmentImages(ids: string[]) {
  const { fetch } = useApi();
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.attachmentImage(id),
      queryFn: async () => {
        const response = await fetch(new Request(`${apiUrl()}/attachments/${id}/content`));
        if (!response.ok) throw new ApiError(`Image ${id} is unavailable (${response.status})`, response.status);
        return URL.createObjectURL(await response.blob());
      },
      staleTime: Infinity,
      meta: { objectUrl: true },
    })),
  });
}

export type Rating = Message['feedback'] & number;

/** A rating of an assistant reply; the comment is shared with administrators, the chat text is not. */
export function useFeedback() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
      rating,
      comment,
    }: {
      conversationId: string;
      messageId: string;
      rating: Rating;
      comment: string;
    }) =>
      unwrap(
        await client.POST('/api/conversations/{id}/messages/{messageId}/feedback', {
          params: { path: { id: conversationId, messageId } },
          body: { rating, comment: comment || undefined },
        }),
      ),
    onSuccess: (_, { conversationId, messageId, rating, comment }) =>
      queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(conversationId), (current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((message: Message) =>
                message.id === messageId ? { ...message, feedback: rating, feedbackComment: comment || null } : message,
              ),
            }
          : current,
      ),
  });
}
