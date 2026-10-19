import { BadGatewayException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

export type GatewayMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type GatewayUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

/** Client-safe messages; provider detail is logged server-side (LiteLLM already redacts message bodies). */
export function gatewayError(status: number) {
  if (status === 429) return new HttpException('The AI provider rate limit or free-tier quota was reached. Wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
  if (status === 401 || status === 403) return new BadGatewayException('The AI provider rejected the configured server credential.');
  if (status === 400 || status === 404 || status === 422) return new BadGatewayException('The AI provider rejected the request.');
  if (status === 408 || status === 504) return new BadGatewayException('The AI provider timed out.');
  return new BadGatewayException(`AI gateway error (${status}).`);
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private readonly url = process.env.LITELLM_URL || 'http://localhost:4000';
  private readonly key = process.env.LITELLM_MASTER_KEY || 'local-litellm-key-change-me';

  maxOutputTokens() {
    const configured = Number(process.env.AI_MAX_OUTPUT_TOKENS || 1024);
    return Number.isFinite(configured) ? Math.min(4096, Math.max(1, Math.trunc(configured))) : 1024;
  }

  /** Route names LiteLLM currently serves. Reads gateway config only; never calls a model provider. */
  async routes(): Promise<Set<string>> {
    try {
      const headers = { Authorization: `Bearer ${this.key}` };
      const ready = await fetch(`${this.url}/health/readiness`, { headers, signal: AbortSignal.timeout(1500) });
      if (!ready.ok) return new Set();
      const response = await fetch(`${this.url}/v1/models`, { headers, signal: AbortSignal.timeout(1500) });
      if (!response.ok) return new Set();
      const json = (await response.json()) as { data?: Array<{ id: string }> };
      return new Set((json.data || []).map((item) => item.id));
    } catch { return new Set(); }
  }

  async stream(
    model: string,
    messages: GatewayMessage[],
    signal: AbortSignal,
    onText: (text: string) => void,
    options: { temperature?: number; maxOutputTokens?: number } = {},
  ): Promise<GatewayUsage | undefined> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
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
      throw gatewayError(response.status);
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
    let event: { choices?: Array<{ delta?: { content?: string } }>; usage?: GatewayUsage; error?: { code?: number | string; message?: string } };
    try { event = JSON.parse(data); } catch { return undefined; /* ignore gateway keepalive/non-JSON frames */ }
    // LiteLLM reports provider failures that occur after streaming began as an error frame.
    if (event.error) {
      this.logger.warn(`Gateway stream error for ${model}: ${String(event.error.message || '').slice(0, 300)}`);
      throw gatewayError(Number(event.error.code) || 502);
    }
    const text = event.choices?.[0]?.delta?.content;
    if (text) onText(text);
    return event.usage;
  }
}
