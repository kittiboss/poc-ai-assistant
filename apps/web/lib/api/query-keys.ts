/** `search` matches titles and message content on the server. */
export type ConversationFilters = { search: string; archived: boolean };

/** Query keys in one place, so mutations invalidate exactly what they change. */
export const queryKeys = {
  models: ['models'] as const,
  conversations: ['conversations'] as const,
  /** Every conversation list; each search and archive filter is cached on its own. */
  conversationLists: ['conversations', 'list'] as const,
  conversationList: (filters: ConversationFilters) => ['conversations', 'list', filters] as const,
  conversation: (id: string) => ['conversations', id] as const,
  myUsage: ['usage', 'me'] as const,
  liveUsage: ['usage', 'me', 'live'] as const,
  /** Organization-wide use of each model today. */
  modelUsage: ['usage', 'models'] as const,
  knowledge: ['knowledge', 'status'] as const,
  /** The central knowledge base (vendor-managed deployments). */
  knowledgeBase: {
    all: ['knowledge-base'] as const,
    overview: ['knowledge-base', 'overview'] as const,
    documents: ['knowledge-base', 'documents'] as const,
  },
  admin: {
    all: ['admin'] as const,
    workspace: ['admin', 'workspace'] as const,
    templates: ['admin', 'workspace', 'templates'] as const,
    models: ['admin', 'models'] as const,
    pricing: ['admin', 'pricing'] as const,
    users: ['admin', 'users'] as const,
    audit: ['admin', 'audit'] as const,
    credit: ['admin', 'credit'] as const,
    summary: (filters: object) => ['admin', 'summary', filters] as const,
  },
};
