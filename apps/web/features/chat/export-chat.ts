import type { ConversationDetail, Message } from '@/lib/api/types';
import { download } from '@/lib/download';

export type ExportFormat = 'md' | 'json';

/** Saves a chat as Markdown (with its source excerpts) or as the raw JSON the API returned. */
export function exportChat(chat: ConversationDetail, format: ExportFormat) {
  if (format === 'json') return download('conversation.json', JSON.stringify(chat, null, 2), 'application/json');
  const sources = (message: Message) =>
    message.citations
      .map(
        (source) =>
          `[${source.label}] ${source.filename}${source.page ? `, page ${source.page}` : ''}\n> ${source.content.replace(/\n/g, '\n> ')}`,
      )
      .join('\n\n');
  const files = (message: Message) =>
    message.metadata.attachments?.length
      ? `Attached: ${message.metadata.attachments.map((file) => file.filename).join(', ')}\n\n`
      : '';
  const body = chat.messages
    .map(
      (message) =>
        `## ${message.role}${message.modelId ? ` (${message.modelId})` : ''}\n\n${files(message)}${message.content}\n\n${sources(message)}`,
    )
    .join('\n\n');
  download('conversation.md', `# ${chat.title}\n\n${body}`, 'text/markdown');
}
