import { attachedFiles } from '../attachments/attachments.service';
import type { ContentPart, GatewayMessage } from '../gateway/gateway.service';

/** What the model reads for a message that only sends files; the stored message stays empty. */
export const filesOnlyTurn = (filenames: string[]) => `[Attached without a message: ${filenames.join(', ')}]`;

/** An image of the chat as the model receives it. */
export type ImageData = { filename: string; url: string };

/**
 * Failed and empty turns are kept for the user's history but never replayed to a
 * provider: several providers (Gemini included) reject empty content parts. A turn
 * that only sent files is replayed as the note that names them.
 *
 * Each of the chat's `images` goes once, after the text of the first replayed turn that
 * attached it. Images of turns too old to be replayed go with the earliest replayed user
 * turn, so they stay in the model's context like the chat's documents.
 */
export function toGatewayHistory(
  messages: Array<{ role: string; content: string; status: string; metadata?: unknown }>,
  images = new Map<string, ImageData>(),
): GatewayMessage[] {
  const turns = messages
    .map((message) => {
      const files = attachedFiles(message.metadata);
      return {
        role: message.role.toLowerCase() as GatewayMessage['role'],
        status: message.status,
        content: message.content.trim() || !files.length ? message.content : filesOnlyTurn(files.map((file) => file.filename)),
        images: files.map((file) => file.id).filter((id) => images.has(id)),
      };
    })
    .filter((turn) => turn.status !== 'ERROR' && turn.content.trim() !== '');
  const placed = new Set<string>();
  for (const turn of turns) {
    turn.images = turn.images.filter((id) => !placed.has(id));
    for (const id of turn.images) placed.add(id);
  }
  const first = turns.find((turn) => turn.role === 'user');
  if (first) first.images = [...[...images.keys()].filter((id) => !placed.has(id)), ...first.images];
  return turns.map(({ role, content, images: ids }) => ({ role, content: ids.length ? withImages(content, ids.map((id) => images.get(id)!)) : content }));
}

/** The turn's text, then each image after a label that lets a reply name it. */
const withImages = (text: string, images: ImageData[]): ContentPart[] => [
  { type: 'text', text },
  ...images.flatMap(({ filename, url }): ContentPart[] => [
    { type: 'text', text: `[Image: ${filename}]` },
    { type: 'image_url', image_url: { url } },
  ]),
];
