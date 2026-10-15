export type Model = {
  id: string;
  displayName: string;
  provider: string;
  providerModelId: string;
  enabled: boolean;
  permitted: boolean;
  available: boolean;
  local: boolean;
  status: string;
  contextWindow: number;
  capabilities: string[];
};
export type Citation = {
  id: string;
  sourceId: string;
  filename: string;
  page: number | null;
  content: string;
  label?: string;
  /** Product-catalog citations carry their similarity score (0–1). */
  kind?: "product";
  score?: number;
};
export type KnowledgeStatus = {
  ready: boolean;
  available: boolean;
  problem: string | null;
  embeddingModel: {
    id: string;
    displayName: string;
    provider: string | null;
    local: boolean | null;
  };
  products: number;
  indexed: number;
  stale: number;
  orphaned: number;
  indexing: boolean;
  lastRun: IndexRun | null;
};
export type IndexRun = {
  embeddingModel: string;
  pending: number;
  embedded: number;
  removed: number;
  batches: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};
export type Message = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  status: "PENDING" | "STREAMING" | "COMPLETED" | "INTERRUPTED" | "ERROR";
  modelId?: string;
  createdAt: string;
  metadata?: {
    tool?: string;
    filename?: string;
    content?: string;
    mime?: string;
  };
  citations?: Citation[];
  feedback?: number;
  feedbackComment?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    currency: string;
    actualProviderCost: string;
    customerCharge: string;
    usageKind: string;
  };
};
export type Conversation = {
  id: string;
  title: string;
  projectId?: string | null;
  pinned?: boolean;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
  _count?: { messages: number };
};
export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedModels: string[];
  allowedRoles: string[];
  temperature: number;
  maxOutputTokens: number;
  enabled: boolean;
};
