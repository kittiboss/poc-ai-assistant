import { BadGatewayException, Injectable } from '@nestjs/common';

export type GatewayMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type GatewayUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

@Injectable()
export class GatewayService {
  private readonly url = process.env.LITELLM_URL || 'http://localhost:4000';
  private readonly key = process.env.LITELLM_MASTER_KEY || 'local-litellm-key-change-me';

  private maxOutputTokens() {
    const configured = Number(process.env.AI_MAX_OUTPUT_TOKENS || 512);
    return Number.isFinite(configured) ? Math.min(4096, Math.max(1, Math.trunc(configured))) : 512;
  }

  async available(model: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/health/readiness`, {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return false;
      if (model === 'local-mock') return true;
      const modelResponse = await fetch(`${this.url}/v1/models`, {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(1500),
      });
      if (!modelResponse.ok) return false;
      const json = (await modelResponse.json()) as { data?: Array<{ id: string }> };
      return Boolean(json.data?.some((item) => item.id === model));
    } catch { return false; }
  }

  async stream(
    model: string,
    messages: GatewayMessage[],
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<GatewayUsage | undefined> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: this.maxOutputTokens(),
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
      throw new BadGatewayException(`AI gateway rejected the request (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
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
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; usage?: GatewayUsage };
            const text = event.choices?.[0]?.delta?.content;
            if (text) onText(text);
            if (event.usage) usage = event.usage;
          } catch { /* ignore gateway keepalive/non-JSON frames */ }
        }
      }
      if (done) break;
    }
    return usage;
  }
}

