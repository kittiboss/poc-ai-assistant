import { attachedFiles } from '../attachments/attachments.service';
import type { GatewayMessage } from '../gateway/gateway.service';

/** What the model reads for a message that only sends files; the stored message stays empty. */
export const filesOnlyTurn = (filenames: string[]) => `[Attached without a message: ${filenames.join(', ')}]`;

/**
 * Failed and empty turns are kept for the user's history but never replayed to a
 * provider: several providers (Gemini included) reject empty content parts. A turn
 * that only sent files is replayed as the note that names them.
 */
export function toGatewayHistory(messages: Array<{ role: string; content: string; status: string; metadata?: unknown }>): GatewayMessage[] {
  return messages
    .map((message) => {
      const files = message.content.trim() ? [] : attachedFiles(message.metadata);
      return files.length ? { ...message, content: filesOnlyTurn(files.map((file) => file.filename)) } : message;
    })
    .filter((message) => message.status !== 'ERROR' && message.content.trim() !== '')
    .map((message) => ({ role: message.role.toLowerCase() as GatewayMessage['role'], content: message.content }));
}
