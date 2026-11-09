/**
 * vendor-control's admin API (apps/vendor-control/src/server.mjs and store.mjs). USD amounts come as
 * strings with 9 decimals (exact), except the credit summary, which comes as numbers. Counts that
 * Postgres returns as bigint arrive as strings.
 */

/** A tenant's credit (store.balance). */
export interface Credit {
  currency: 'USD';
  simulation: true;
  /** Everything ever granted */
  limit: number;
  spent: number;
  balance: number;
  /** Held for requests still running */
  reserved: number;
  /** Balance less what is held: what new requests can use */
  remaining: number;
  exhausted: boolean;
  lowCredit: boolean;
}

export interface TenantConfig {
  id: string;
  name: string;
  webPort: number;
  apiPort: number;
  initialCreditUsd?: number;
  models: string[];
  modelRateLimits?: Record<string, { rpm?: number; tpm?: number }>;
  dailyExternalLimits?: { requests: number; tokens: number };
  embeddingBatch?: { size: number; intervalMs: number };
}

/** Knowledge (RAG) limits (vendor-control/src/rag.mjs). */
export interface RagLimits {
  enabled: boolean;
  embeddingModels: string[];
  allowedTypes: string[];
  maxDocuments: number;
  maxFileMb: number;
  maxTextMb: number;
  maxChunksPerDocument: number;
  maxTotalChunks: number;
  maxTopK: number;
}

/** Chat image limits (vendor-control/src/images.mjs). */
export interface ImageLimits {
  enabled: boolean;
  models: string[];
  maxImages: number;
}

/** GET /admin/tenants */
export interface Tenant {
  id: string;
  name: string;
  enabled: boolean;
  /** Has a gateway credential: `tenant:create` has run on the vendor host */
  provisioned: boolean;
  config: TenantConfig;
  rag: RagLimits;
  /** The embedding models of `rag` that the plan includes */
  ragEntitled: string[];
  images: ImageLimits;
  /** The models of `images` that the plan includes; none when images are off */
  imagesEntitled: string[];
  credit: Credit;
  requests: string;
  pending: string;
  simulatedProviderCost: string;
  actualProviderCost: string;
}

export interface ModelUsage {
  model: string;
  external: boolean;
  requests: number;
  running: number;
  tokens: number;
}

/** GET /admin/usage/today: since 00:00 UTC */
export interface UsageToday {
  resetsAt: string;
  tenants: {
    tenant: string;
    name: string;
    /** Shared by all of the tenant's external models */
    limits: { requests: number; tokens: number } | null;
    external: { requests: number; tokens: number };
    models: ModelUsage[];
  }[];
}

/** GET /admin/rag/usage, from the RAG engine */
export interface RagUsage {
  tenants: { tenant: string; documents: number; textBytes: number; chunks: number }[];
}

export type PriceStrategy = 'PERCENTAGE_MARKUP' | 'FIXED_RATE';

/** GET /admin/prices (latest version per model) and /admin/prices/history (latest 100 versions) */
export interface Price {
  /** The version */
  id: string;
  model: string;
  inputRate: string;
  outputRate: string;
  unit: string;
  createdAt: string;
  inputCost: string;
  outputCost: string;
  strategy: PriceStrategy;
  markupPercent: number;
}

export type LedgerKind = 'OPENING' | 'TOPUP' | 'DEBIT' | 'ESTIMATED_DEBIT' | 'REJECTED';

export interface Transaction {
  /** SIM-<ledger id> */
  id: string;
  reference: string;
  kind: LedgerKind;
  amount: string;
  createdAt: string;
}

export type RequestState = 'PENDING' | 'COMPLETED' | 'ESTIMATED' | 'REJECTED';

export interface LedgerRequest {
  request_id: string;
  model: string;
  kind: 'CHAT' | 'EMBEDDING';
  state: RequestState;
  input_tokens: number | null;
  output_tokens: number | null;
  /** null while it runs */
  charge: string | null;
  price_id: string;
  created_at: string;
}

/** GET /admin/tenants/:id/billing: the latest 100 of each */
export interface Billing {
  credit: Credit;
  transactions: Transaction[];
  requests: LedgerRequest[];
}
