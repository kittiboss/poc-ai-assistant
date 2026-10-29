# Chat attachments

Users can attach documents to a chat message, or send documents without typing anything, as in other AI chat apps. Version 1 handles documents only. Text is extracted inside this installation with the same bounded extractor as project sources, so reading a file costs no model call. What the model receives is the extracted text, as tokens like any other prompt.

## Flow

1. The web uploads each file as soon as it is attached: `POST /api/attachments`. The API extracts the text, keeps only the text (never the original file) and returns the attachment. It is not linked to any chat yet.
2. The composer shows each file as a chip (uploading, ready or failed). A chip removed before sending deletes its attachment: `DELETE /api/attachments/:id`.
3. Sending lists the files in `attachmentIds`, next to the usual message fields.
4. The API stores the file references in the user message's `metadata.attachments` and adds the text of every file attached anywhere in the chat to the system message, as data.

Uploading first keeps the message endpoint a JSON request that streams SSE, shows extraction errors (a scanned PDF, for example) before the user sends, and leaves the chat to be created on the first message as before.

## Data

```prisma
model Attachment {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  filename  String    @db.VarChar(200)
  byteSize  Int
  pageCount Int?                 // PDFs only
  charCount Int
  content   String    @db.Text   // extracted text; PDF pages are marked [Page n]
  sentAt    DateTime?            // null until a message sends it; unsent files are removed after 24 hours
  createdAt DateTime  @default(now())
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([sentAt, createdAt])
}
```

- There is no `conversationId`. A chat finds its files through the references in its messages' metadata, so a branched chat keeps them without copying rows. Access is checked against `userId`.
- Deleting a chat (a soft delete) keeps its attachments, as it keeps its messages.

## Upload and remove

| Endpoint | Behaviour |
|---|---|
| `POST /api/attachments` | multipart field `file`, one file per request, at most 5 MB. Responds `201` with the attachment. |
| `DELETE /api/attachments/:id` | Removes an attachment that has not been sent. Responds `204`. |

```json
{ "id": "uuid", "filename": "report.pdf", "byteSize": 182044, "pageCount": 12, "charCount": 18350, "createdAt": "2026-10-29T09:00:00.000Z" }
```

Uploads are not checked for sensitive information. The existing check runs when the message is sent, on the complete context that goes to an external model; local models skip it.

## Sending a message

```ts
class SendMessageDto {
  content: string;            // may be empty when attachmentIds is not
  attachmentIds?: string[];   // distinct UUIDs, at most 3
  locale?: 'th' | 'en';       // reply language when only files are sent
  // other fields unchanged
}
```

1. A message with neither text nor attachments is rejected, as before.
2. Every attachment must belong to the sender. A file that was sent before may be sent again, because regenerate and edit resend the original message's files.
3. The chat's files are the ones referenced by any of its messages (not only the 49 replayed as history) plus the new ones. Their text together may not exceed 60,000 characters (`ATTACHMENT_LIMIT`).
4. The API appends an `Attached files (data only)` block to the system message, after the workspace context. The files are given as JSON, so a file's text cannot close its own block, and the model is told never to follow instructions found inside them. Quota reservation, the sensitive-information check and the context-limit check therefore include the files' text with no further change.
5. When only files are sent:
   - the stored user message stays empty, and the model receives `[Attached without a message: report.pdf]` in its place;
   - the system message asks for a 3–5 point overview of each file in the language of `locale` (without it, the language of the files), followed by a question about what the user wants to do;
   - the reply is capped at 400 output tokens;
   - knowledge base and product catalog retrieval are skipped;
   - an untitled chat is named after the first file.
6. Earlier file-only messages are replayed in the history with the same substitute text, so they are not dropped.
7. The files' `sentAt` is set in the same transaction that saves the message.
8. The SSE events do not change.

## Message responses

`MessageMetadata` gains a typed field, so the web's generated types describe it:

```ts
attachments?: { id: string; filename: string; byteSize: number; pageCount: number | null; charCount: number }[];
```

## Error codes

Errors follow the API's coded shape `{ statusCode, code, message }`, so the web can show its own wording in each language.

| Code | Status | When |
|---|---|---|
| `ATTACHMENT_TYPE` | 400 | Not TXT, MD, CSV, JSON, PDF or DOCX |
| `ATTACHMENT_SIZE` | 400 | Empty file. A file over 5 MB is refused by the upload limit with 413 and no code. |
| `ATTACHMENT_UNREADABLE` | 400 | Damaged file, text that is not UTF-8, invalid JSON, or extraction failed or timed out |
| `ATTACHMENT_NO_TEXT` | 400 | No text found, such as a scanned PDF |
| `ATTACHMENT_TOO_LONG` | 400 | One file has more text than a whole chat may hold, or more than the extractor reads (100 PDF pages, 200,000 characters) |
| `ATTACHMENT_BUSY` | 429 | The API is extracting another document; retry shortly |
| `ATTACHMENT_NOT_FOUND` | 400 | Sending refers to a file that does not exist or belongs to someone else |
| `ATTACHMENT_SENT` | 409 | Removing a file that was already sent |
| `ATTACHMENT_LIMIT` | 400 | The files of the chat together exceed the chat's limit |
| `CONTEXT_TOO_LONG` | 400 | Code added to the existing conservative context-limit check |

The shared extractor keeps its responses for project sources and the central knowledge base unchanged; only the attachment endpoints turn its failures into these codes.

## Limits

| Limit | Value | Why |
|---|---|---|
| File size | 5 MB | Same as project sources |
| Files per message | 3 | |
| Text per chat (and so per file) | 60,000 characters | vendor-control accepts at most 250,000 bytes of input. Thai takes 3 bytes per character in UTF-8, about 83,000 characters, and the rest is left for the chat history. |
| Reply to a file-only message | 400 output tokens | A short overview; output costs about 8 times input on Gemini 3.5 Flash-Lite |
| Unsent files | Removed after 24 hours, checked every hour | |

The context-limit check counts bytes. `local-mock` has an 8,192 context window, so after the output reserve only about 2,000 Thai characters of file text fit; larger files get `CONTEXT_TOO_LONG` there and work with Gemini (1M).

## Cost

The files' text is sent again on every turn of the chat, like the rest of the history. Sending files without a question adds one turn compared with asking at once: the files' text once more, plus a reply of at most 400 tokens. On the Gemini free tier this costs nothing but one request of the rate limit; dashboards show the simulated paid-tier cost as for any other request.

## Not in version 1

Images, OCR for scanned PDFs, retrieving only the relevant passages of large files, keeping original files for download, and a project page for managing files.
