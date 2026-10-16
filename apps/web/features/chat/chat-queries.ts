'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/api/api-provider';
import { queryKeys, type ConversationFilters } from '@/lib/api/query-keys';
import type {
  Conversation,
  ConversationChange,
  ConversationDetail,
  ConversationSummary,
  Message,
  Model,
} from '@/lib/api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Conversation ids are UUIDs; anything else in the URL cannot be a conversation (the API answers 400). */
export const isConversationId = (id: string | undefined): id is string => Boolean(id && UUID.test(id));

export function useModels() {
  const { client, unwrap } = useApi();
  return useQuery<Model[]>({
    queryKey: queryKeys.models,
    queryFn: async ({ signal }) => unwrap(await client.GET('/api/models', { signal })),
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
