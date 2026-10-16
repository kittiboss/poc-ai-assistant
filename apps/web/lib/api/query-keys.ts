/** Query keys in one place, so mutations invalidate exactly what they change. */
export const queryKeys = {
  models: ['models'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  myUsage: ['usage', 'me'] as const,
  admin: {
    all: ['admin'] as const,
    models: ['admin', 'models'] as const,
    pricing: ['admin', 'pricing'] as const,
    users: ['admin', 'users'] as const,
    audit: ['admin', 'audit'] as const,
    summary: (filters: object) => ['admin', 'summary', filters] as const,
  },
};
