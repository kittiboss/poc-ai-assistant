export type Model = { id: string; displayName: string; provider: string; providerModelId: string; enabled: boolean; permitted: boolean; available: boolean; local: boolean; status: string; contextWindow: number; capabilities: string[] };
export type Message = { id: string; role: 'USER' | 'ASSISTANT' | 'SYSTEM'; content: string; status: 'PENDING' | 'STREAMING' | 'COMPLETED' | 'INTERRUPTED' | 'ERROR'; modelId?: string; createdAt: string };
export type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; messages?: Message[]; _count?: { messages: number } };

