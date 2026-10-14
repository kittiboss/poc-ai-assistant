import type { GatewayMessage } from '../gateway/gateway.service';

/**
 * Failed and empty turns are kept for the user's history but never replayed to a
 * provider: several providers (Gemini included) reject empty content parts.
 */
export function toGatewayHistory(messages: Array<{ role: string; content: string; status: string }>): GatewayMessage[] {
  return messages
    .filter((message) => message.status !== 'ERROR' && message.content.trim() !== '')
    .map((message) => ({ role: message.role.toLowerCase() as GatewayMessage['role'], content: message.content }));
}
