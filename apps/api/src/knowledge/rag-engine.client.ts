import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { vendorGateway } from "../models/model-policies";

/** Vendor-managed deployments keep their knowledge in the platform's central RAG engine. */
export const ragEngineEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  vendorGateway(env) && Boolean(env.RAG_ENGINE_URL);

export type KnowledgeLimits = {
  enabled: boolean;
  embeddingModels: string[];
  allowedTypes: string[];
  maxDocuments: number;
  maxFileMb: number;
  maxTextMb: number;
  maxChunksPerDocument: number;
  maxTotalChunks: number;
  maxTopK: number;
};
export type KnowledgeSettings = {
  embeddingModel: string;
  topK: number;
  minScore: number;
  chunkSize: number;
  chunkOverlap: number;
};
export type IndexVersion = { version: number; model: string };
export type EngineConfig = {
  tenant: string;
  limits: KnowledgeLimits;
  settings: KnowledgeSettings;
  effective: { topK: number; minScore: number };
  /** Why search is off right now (turned off by the vendor, model no longer in the plan…). */
  problem: string | null;
  /** The index search uses; null until the first one is complete. */
  active: IndexVersion | null;
  /** The index being built; differs from active while a settings change re-indexes. */
  target: IndexVersion;
  usage: {
    documents: number;
    textBytes: number;
    chunks: number;
    pendingChunks: number;
    pausedDocuments: number;
    sensitiveDocuments: number;
  };
};
export type PauseReason =
  | "CREDIT_EXHAUSTED"
  | "POLICY"
  | "DAILY_LIMIT"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "ERROR";
export type EngineNext = IndexVersion & {
  documentId?: string;
  /** The tenant user whose quotas and policies apply to these embedding calls. */
  requestedBy?: { userId: string; roles: string[] };
  items: Array<{ chunkId: string; title: string; text: string }>;
  remaining: number;
  problem?: string | null;
};
export type EngineSearch = {
  model: string | null;
  version: number | null;
  topK: number;
  citations: Array<{
    chunkId: string;
    documentId: string;
    filename: string;
    title: string;
    page: number | null;
    content: string;
    score: number;
  }>;
};

type Init = { method?: string; body?: unknown; timeoutMs?: number };

/**
 * Calls the central RAG engine with this deployment's platform credential (the same one
 * vendor-control meters). The engine identifies the tenant from it; nothing here names a tenant.
 */
@Injectable()
export class RagEngineClient {
  enabled() {
    return ragEngineEnabled();
  }

  async request<T>(path: string, init: Init = {}): Promise<T> {
    const url = process.env.RAG_ENGINE_URL;
    const key = process.env.LITELLM_API_KEY;
    if (!this.enabled() || !url || !key)
      throw new NotFoundException(
        "The central knowledge base is not configured in this deployment",
      );
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          ...(init.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      });
    } catch {
      throw new BadGatewayException("Knowledge service unavailable");
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: { type?: string; message?: string };
    };
    if (response.ok) return body as T;
    const payload = {
      statusCode: response.status,
      message: body.error?.message ?? "Knowledge service request failed",
      code: body.error?.type?.toUpperCase(),
    };
    switch (response.status) {
      case 400:
        throw new BadRequestException(payload);
      case 403:
        throw new ForbiddenException(payload);
      case 404:
        throw new NotFoundException(payload);
      case 409:
        throw new ConflictException(payload);
      case 413:
        throw new PayloadTooLargeException(payload);
      default:
        throw new BadGatewayException(
          response.status === 401
            ? "The knowledge service did not accept this deployment's platform credential"
            : "Knowledge service unavailable",
        );
    }
  }
}
