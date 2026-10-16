'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/api/api-provider';
import { queryKeys } from '@/lib/api/query-keys';
import type { ConversationDetail, ConversationSummary, Model } from '@/lib/api/types';

type CreatedConversation = Omit<ConversationDetail, 'messages'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Conversation ids are UUIDs; anything else in the URL cannot be a conversation (the API would answer 500). */
export const isConversationId = (id: string | undefined): id is string => Boolean(id && UUID.test(id));

export function useModels() {
  const { client, unwrap } = useApi();
  return useQuery<Model[]>({
    queryKey: queryKeys.models,
    queryFn: async ({ signal }) => unwrap(await client.GET('/api/models', { signal })),
  });
}

export function useConversations() {
  const { client, unwrap } = useApi();
  return useQuery<ConversationSummary[]>({
    queryKey: queryKeys.conversations,
    queryFn: async ({ signal }) => unwrap(await client.GET('/api/conversations', { signal })),
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

/** Adds a conversation created for a first message to the list and caches it as an empty chat. */
export function addConversation(queryClient: QueryClient, conversation: CreatedConversation) {
  queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (items = []) => [
    { ...conversation, _count: { messages: 0 } },
    ...items,
  ]);
  queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(conversation.id), {
    ...conversation,
    messages: [],
  });
}

export function useRenameConversation() {
  const { client, unwrap } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) =>
      unwrap(await client.PATCH('/api/conversations/{id}', { params: { path: { id } }, body: { title } })),
    onSuccess: ({ id, title }) => {
      queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (items) =>
        items?.map((item) => (item.id === id ? { ...item, title } : item)),
      );
      queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(id), (current) =>
        current ? { ...current, title } : current,
      );
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
    onSuccess: (_, id) =>
      queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (items) =>
        items?.filter((item) => item.id !== id),
      ),
  });
}
