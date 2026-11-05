import { BadGatewayException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { vendorGateway } from '../models/model-policies';

/** OpenAI-style parts; LiteLLM turns an image's data URL into the provider's inline data. */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
/** Turns without images stay strings. */
export type GatewayMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

/** The text of a message, without its images. */
export const messageText = (content: GatewayMessage['content']) =>
  typeof content === 'string' ? content : content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');

/**
 * A route the gateway serves to this key. The platform gateway marks the models this organization
 * may send images to with `vision` and the images a chat may hold; LiteLLM itself marks none.
 */
export type GatewayRoute = { vision: boolean; maxImages?: number };
/** How long the gateway's last answer about its routes stands in when it gives none (a timeout, a restart). */
export const ROUTES_GRACE_MS = 60_000;
export type GatewayBilling ={ requestId: string; charge: string; priceVersion: string; estimated: boolean; simulation: boolean };
export type GatewayUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; billing?: GatewayBilling };
/** The organization's prepaid credit held by the platform gateway, in USD. */
export type GatewayCredit = { currency: 'USD'; limit: number; spent: number; remaining: number; exhausted: boolean };

/** Codes the web turns into its own messages; the gateway's wording is never shown. */
export const GatewayErrorCode = {
  creditExhausted: 'CREDIT_EXHAUSTED',
  rateLimited: 'RATE_LIMITED',
  modelNotEntitled: 'MODEL_NOT_ENTITLED',
  // The same code as the API's own check, so the web words it the same way.
  imagesNotAllowed: 'ATTACHMENT_NEEDS_VISION',
} as const;

const coded = (status: HttpStatus, code: string, message: string) => new HttpException({ statusCode: status, code, message }, status);

/**
 * Client-safe messages; provider detail is logged server-side (LiteLLM already redacts message bodies).
 * `type` is LiteLLM's `error.type`: the platform gateway reports a spent budget as a 400, so the status alone is not enough.
 */
export function gatewayError(status: number, type?: string) {
  const error = clientError(status, type);
  // The platform gateway answers `upstream_rejected` when the provider refused the call: no tokens, no credit.
  if (type === 'upstream_rejected') providerRefusals.add(error);
  return error;
}

const providerRefusals = new WeakSet<HttpException>();

function clientError(status: number, type?: string) {
  if (type === 'budget_exceeded') return coded(HttpStatus.PAYMENT_REQUIRED, GatewayErrorCode.creditExhausted, "Your organization's prepaid AI credit is used up. Ask an administrator to add credit.");
  if (type === 'key_model_access_denied') return coded(HttpStatus.FORBIDDEN, GatewayErrorCode.modelNotEntitled, "This model is not included in your organization's plan.");
  // The platform's image limits changed after this API checked them.
  if (type === 'image_access_denied') return coded(HttpStatus.BAD_REQUEST, GatewayErrorCode.imagesNotAllowed, "Your organization's plan does not let the chosen model receive this chat's images.");
  if (status === 429) return coded(HttpStatus.TOO_MANY_REQUESTS, GatewayErrorCode.rateLimited, 'The AI provider rate limit or free-tier quota was reached. Wait a moment and try again.');
  if (status === 401 || status === 403) return new BadGatewayException('The AI provider rejected the configured server credential.');
  if (status === 400 || status === 404 || status === 422) return new BadGatewayException('The AI provider rejected the request.');
  if (status === 408 || status === 504) return new BadGatewayException('The AI provider timed out.');
  return new BadGatewayException(`AI gateway error (${status}).`);
}

/** The code of an error from `gatewayError`, if it has one. */
export function gatewayErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response ? String(response.code) : undefined;
}

/** The gateway or the provider refused the call before doing any work, so it processed no tokens. */
export const refusedByGateway = (error: unknown) =>
  gatewayErrorCode(error) !== undefined ||
  (error instanceof HttpException && (error.getStatus() === HttpStatus.TOO_MANY_REQUESTS || providerRefusals.has(error)));

const errorType = (detail: string) => {
  try {
    return (JSON.parse(detail) as { error?: { type?: string } }).error?.type;
  } catch {
    return undefined;
  }
};

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private readonly url = process.env.LITELLM_URL || 'http://localhost:4000';
  // In vendor mode this is the organization's own key issued by the platform; the dev stack uses the master key.
  private readonly key = process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || 'local-litellm-key-change-me';

  constructor() {
    if (vendorGateway() && !process.env.LITELLM_API_KEY) {
      throw new Error('MODEL_ACCESS=vendor-gateway requires LITELLM_API_KEY, the organization key issued by the platform gateway');
    }
  }

  maxOutputTokens() {
    const configured = Number(process.env.AI_MAX_OUTPUT_TOKENS || 1024);
    return Number.isFinite(configured) ? Math.min(4096, Math.max(1, Math.trunc(configured))) : 1024;
  }

  /** The gateway's last answer about its routes, and when it came. */
  private lastRoutes?: { routes: Map<string, GatewayRoute>; at: number };
  private pendingRoutes?: Promise<Map<string, GatewayRoute>>;

  /**
   * Routes LiteLLM serves to this key, by name. Reads gateway config only; never calls a model provider.
   * The gateway is asked every time. When it gives no answer (unreachable, too slow, not ready, a server
   * error), its last answer stands in for up to ROUTES_GRACE_MS after it came, so one slow moment does not
   * make every model unavailable; standing in never makes an answer last longer. An answer, a refusal
   * included, is used at once. Calls at the same time share one question.
   */
  routes(): Promise<Map<string, GatewayRoute>> {
    this.pendingRoutes ??= this.askRoutes().finally(() => {
      this.pendingRoutes = undefined;
    });
    return this.pendingRoutes;
  }

  private async askRoutes() {
    const answer = await this.fetchRoutes();
    if (answer) {
      this.lastRoutes = { routes: answer, at: Date.now() };
      return answer;
    }
    const last = this.lastRoutes;
    return last && Date.now() - last.at <= ROUTES_GRACE_MS ? last.routes : new Map<string, GatewayRoute>();
  }

  /**
   * The gateway's routes, or null when it gave no answer. The platform gateway refuses /v1/models once the
   * prepaid budget is spent, so the key's own model list is used then.
   */
  private async fetchRoutes(): Promise<Map<string, GatewayRoute> | null> {
    try {
      const headers = { Authorization: `Bearer ${this.key}` };
      const ready = await fetch(`${this.url}/health/readiness`, { headers, signal: AbortSignal.timeout(1500) });
      if (!ready.ok) return null;
      const response = await fetch(`${this.url}/v1/models`, { headers, signal: AbortSignal.timeout(1500) });
      if (!response.ok) {
        if (errorType(await response.text().catch(() => '')) === 'budget_exceeded') {
          const info = await this.keyInfo();
          return info ? new Map((info.models ?? []).map((id) => [id, { vision: false }])) : null;
        }
        // A refusal (a revoked key, say) is an answer: no routes.
        return response.status >= 500 ? null : new Map();
      }
      const json = (await response.json()) as { data?: Array<{ id: string; capabilities?: unknown; max_images?: unknown }> };
      return new Map((json.data || []).map((item) => {
        const vision = Array.isArray(item.capabilities) && item.capabilities.includes('vision');
        const maxImages = Number.isInteger(item.max_images) && (item.max_images as number) > 0 ? (item.max_images as number) : undefined;
        return [item.id, vision ? { vision, maxImages } : { vision }];
      }));
    } catch { return null; }
  }

  /**
   * The prepaid credit of this organization's gateway key, or null when the gateway sets no budget (the dev stack).
   * Read from the authoritative ledger on every check (no stale credit cache after a top-up).
   */
  credit(): Promise<GatewayCredit | null> {
    if (!vendorGateway()) return Promise.resolve(null);
    return this.keyInfo().then((info) => {
        if (!info || typeof info.max_budget !== 'number') return null;
        if (info.credit) return info.credit;
        const spent = info.spend ?? 0;
        return { currency: 'USD' as const, limit: info.max_budget, spent, remaining: Math.max(0, info.max_budget - spent), exhausted: spent >= info.max_budget };
      });
  }

  private async keyInfo() {
    try {
      const response = await fetch(`${this.url}/key/info`, { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(1500) });
      if (!response.ok) return null;
      return ((await response.json()) as { info?: { spend?: number; max_budget?: number | null; models?: string[]; credit?: GatewayCredit } }).info ?? null;
    } catch { return null; }
  }

  /**
   * Embeds texts through LiteLLM's OpenAI-compatible /v1/embeddings route; vectors come back in input order.
   * `requestDimensions` asks the provider to shorten its vectors; the result is always checked against `dimensions`.
   */
  async embed(model: string, inputs: string[], dimensions: number, requestDimensions: boolean, signal?: AbortSignal, requestId?: string): Promise<{ vectors: number[][]; usage?: GatewayUsage }> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}`, ...(requestId ? { 'X-Request-Id': requestId } : {}) },
        body: JSON.stringify({ model, input: inputs, ...(requestDimensions ? { dimensions } : {}), encoding_format: 'float' }),
        signal: signal ?? AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new BadGatewayException('AI gateway is unavailable');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`Gateway rejected ${model} embedding request with ${response.status}: ${detail.slice(0, 300)}`);
      throw gatewayError(response.status, errorType(detail));
    }
    const json = (await response.json()) as { data?: Array<{ embedding: number[]; index?: number }>; usage?: GatewayUsage; billing?: GatewayBilling };
    const data = json.data || [];
    // Some providers return index 0 for every item; fall back to response order then.
    const indexed = data.every((item, i) => item.index === undefined || item.index === i) || new Set(data.map((item) => item.index)).size !== data.length
      ? data
      : [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = indexed.map((item) => item.embedding);
    if (vectors.length !== inputs.length || vectors.some((vector) => vector.length !== dimensions)) {
      this.logger.warn(`Embedding response for ${model} had ${vectors.length} vector(s) of length ${vectors[0]?.length ?? 0}; expected ${inputs.length} × ${dimensions}`);
      throw new BadGatewayException('The embedding provider returned an unexpected response.');
    }
    return { vectors, usage: json.billing ? { ...json.usage, billing: json.billing } : json.usage };
  }

  async stream(
    model: string,
    messages: GatewayMessage[],
    signal: AbortSignal,
    onText: (text: string) => void,
    options: { temperature?: number; maxOutputTokens?: number; requestId?: string } = {},
  ): Promise<GatewayUsage | undefined> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}`, ...(options.requestId ? { 'X-Request-Id': options.requestId } : {}) },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: Math.min(options.maxOutputTokens ?? this.maxOutputTokens(), this.maxOutputTokens()),
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new BadGatewayException('AI gateway is unavailable');
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`Gateway rejected ${model} request with ${response.status}: ${detail.slice(0, 300)}`);
      throw gatewayError(response.status, errorType(detail));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: GatewayUsage | undefined;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const line of frames.flatMap((frame) => frame.split('\n'))) {
        usage = this.handleLine(model, line, onText) || usage;
      }
      if (done) break;
    }
    return usage;
  }

  private handleLine(model: string, line: string, onText: (text: string) => void): GatewayUsage | undefined {
    if (!line.startsWith('data:')) return undefined;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return undefined;
    let event: { choices?: Array<{ delta?: { content?: string } }>; usage?: GatewayUsage; billing?: GatewayBilling; error?: { code?: number | string; message?: string; type?: string } };
    try { event = JSON.parse(data); } catch { return undefined; /* ignore gateway keepalive/non-JSON frames */ }
    // LiteLLM reports provider failures that occur after streaming began as an error frame.
    if (event.error) {
      this.logger.warn(`Gateway stream error for ${model}: ${String(event.error.message || '').slice(0, 300)}`);
      throw gatewayError(Number(event.error.code) || 502, event.error.type);
    }
    const text = event.choices?.[0]?.delta?.content;
    if (text) onText(text);
    return event.billing ? { ...event.usage, billing: event.billing } : event.usage;
  }

  async customerBilling(path = '/customer/billing', body?: { amount: string; reference: string }) {
    if (!vendorGateway()) throw new HttpException('Billing is only available on vendor-managed deployments', 404);
    const response = await fetch(`${this.url}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
    }).catch(() => { throw new BadGatewayException('Billing service unavailable'); });
    if (!response.ok) throw new HttpException('Billing request could not be completed', response.status);
    return response.json();
  }
}
