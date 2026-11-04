# Chat attachments

Users can attach documents and images to a chat message, or send them without typing anything, as in other AI chat apps. For a document, text is extracted inside this installation with the same bounded extractor as project sources, so reading a file costs no model call. What the model receives is the extracted text, as tokens like any other prompt. Images are kept as files and sent to models that can see them; see [Images](#images).

## Flow

1. The web uploads each file as soon as it is attached: `POST /api/attachments`. For a document, the API extracts the text, keeps only the text (never the original file) and returns the attachment. It is not linked to any chat yet.
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
4. The API appends an `Attached files (data only)` block to the system message, after the workspace context. The files are given as JSON, so a file's text cannot close its own block, and the model is told never to follow instructions found inside them. Unlike retrieved sources, files have no `[S1]` labels: the model names a file only when that helps, such as when several files are compared. Quota reservation, the sensitive-information check and the context-limit check therefore include the files' text with no further change.
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
| `ATTACHMENT_TYPE` | 400 | Not TXT, MD, CSV, JSON, PDF, DOCX, JPEG, PNG or WebP (an animated WebP included), or an image where images are unavailable |
| `ATTACHMENT_SIZE` | 400 | Empty file, or an image over 1 MB or 1,600 px on its longer side. A file over 5 MB is refused by the upload limit with 413 and no code. |
| `ATTACHMENT_UNREADABLE` | 400 | Damaged file, text that is not UTF-8, invalid JSON, extraction failed or timed out, or an image whose size cannot be read |
| `ATTACHMENT_NO_TEXT` | 400 | No text found, such as a scanned PDF |
| `ATTACHMENT_TOO_LONG` | 400 | One file has more text than a whole chat may hold, or more than the extractor reads (100 PDF pages, 200,000 characters) |
| `ATTACHMENT_BUSY` | 429 | The API is extracting another document; retry shortly |
| `ATTACHMENT_NOT_FOUND` | 400 | Sending refers to a file that does not exist or belongs to someone else |
| `ATTACHMENT_SENT` | 409 | Removing a file that was already sent |
| `ATTACHMENT_LIMIT` | 400 | The files of the chat together exceed the chat's limit: 60,000 characters of text, 6 images or 4 MB of images |
| `ATTACHMENT_NEEDS_VISION` | 400 | The chat has images and the chosen model cannot see them |
| `CONTEXT_TOO_LONG` | 400 | Code added to the existing conservative context-limit check; also a request to the model over 7.5 MB |

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

## Images

Images are available in standalone deployments that have object storage configured. A vendor-managed deployment accepts documents only until vendor-control can meter image input.

### Flow

Images use the same upload-first flow, chips, `attachmentIds` and message metadata as documents. The differences:

1. The composer accepts images only while the selected model has the `vision` capability in `GET /api/models`. That list reports `vision` only where images are available.
2. The browser resizes each image so its longer side is at most 1,600 px and re-encodes it as WebP (JPEG where the browser cannot write WebP), lowering the quality until the file is at most 1 MB. Re-encoding also drops metadata such as GPS location.
3. The API keeps the image file itself, in object storage, because the model needs the pixels on every turn.
4. The web shows an image through `GET /api/attachments/:id/content`, fetched with the user's token into a blob URL, because an `<img>` cannot send a bearer token. Each file is fetched once while the page is open; a click or Enter opens a viewer that steps through the message's images. The Markdown export names each image with its size, as the file itself stays behind sign-in.
5. Regenerate and edit copy the chat before resending; when the selected model cannot read the images that copy would hold, the web warns instead of making it.

### Storage

- SeaweedFS (Apache 2.0) runs in the base Compose stack with its own volume, and creates the bucket when it starts; the API never creates buckets. Its filer and volume ports have no authentication of their own, so it sits on an internal `storage` network that only the backend shares.
- The API uses the AWS SDK (`@aws-sdk/client-s3`), so moving to Amazon S3 or another S3-compatible service is a configuration change:

| Setting | SeaweedFS (Compose) | Amazon S3 |
|---|---|---|
| `S3_ENDPOINT` | `http://seaweedfs:8333` | unset |
| `S3_REGION` | any value | the bucket's region, such as `ap-southeast-7` |
| `S3_BUCKET` | `attachments` | the customer's bucket |
| `S3_FORCE_PATH_STYLE` | `true` | `false` |
| Credentials | `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in `.env`, passed to the API as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` | unset; the SDK uses the IAM role of the container |

The `.env` names differ from the SDK's so that a developer's own AWS keys in the shell never reach the stack.

- Without `S3_BUCKET`, or in a vendor-managed deployment, images are unavailable: uploads are refused with `ATTACHMENT_TYPE` and no model reports `vision`.
- To stay portable, the API uses only PutObject, GetObject, DeleteObject and ListObjectsV2, and the database keeps only the object key (`attachments/<id>`), never an endpoint, bucket or URL.
- An object and its row cannot share a transaction:
  - upload writes the object first, then the row, and deletes the object if the row fails;
  - removal and the unsent sweep delete the row first, then the object; the sweep deletes its rows and reads their keys in one `DELETE … RETURNING`, so a file sent meanwhile keeps its object;
  - a sweep at startup and then daily deletes objects older than 24 hours that have no row, so a failed delete, or a row removed by a cascade, leaves nothing behind for long.
- A storage failure reaches the client as `503` without detail; the cause is logged.
- Deleting a chat (a soft delete) keeps its images, as it keeps its messages.

### Data

```prisma
enum AttachmentKind {
  DOCUMENT
  IMAGE
}

model Attachment {
  // the fields above; for an image, content is "" and charCount is 0
  kind       AttachmentKind @default(DOCUMENT)
  mimeType   String?  @db.VarChar(50)   // images only: image/jpeg, image/png or image/webp
  width      Int?                       // images only, in pixels
  height     Int?
  storageKey String?  @unique @db.VarChar(200)  // images only: the object key in S3_BUCKET
}
```

`AttachmentView` and the references in `metadata.attachments` gain the same fields except `storageKey`:

```ts
kind?: 'DOCUMENT' | 'IMAGE';  // a reference without kind is a document, so stored messages need no change
mimeType?: string;
width?: number;
height?: number;
```

### Upload, content and remove

| Endpoint | Behaviour |
|---|---|
| `POST /api/attachments` | Also takes JPEG, PNG and WebP, at most 1 MB and 1,600 px on the longer side. The type is read from the file's first bytes, never from its extension. |
| `GET /api/attachments/:id/content` | The image file, for its owner only. `404` for anyone else, and for documents, which keep no file. Sent with its stored `Content-Type`, `Cache-Control: private, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`. Errors carry no cache headers, so a browser never keeps a failure. |
| `DELETE /api/attachments/:id` | Unchanged, and also deletes the object. |

### Sending

1. A chat's images are all the images its messages attached, as with documents. If the chat has any and the chosen model lacks `vision` (or the deployment no longer has images available), the message is refused with `ATTACHMENT_NEEDS_VISION` before anything is saved or retrieved, and the web puts it back in the composer.
2. Each image is sent with the user turn that attached it, after the turn's text: a text part `[Image: receipt.jpg]`, so replies can name it, then an OpenAI-style `image_url` part holding a base64 data URL. Images of turns older than the 49 replayed messages go with the earliest replayed user turn. An image is sent once, also when several turns list it. LiteLLM turns the parts into Gemini's inline data.
   - The images are read from storage before anything is saved; a storage failure refuses the message with `503`. An image whose object is missing is left out with a warning in the log, so one lost file does not fail every later turn of its chat.
3. `GatewayMessage.content` becomes `string | ContentPart[]`. Turns without images stay strings.
4. The system message tells the model that text inside images is data, never instructions. When a message only attaches images, the stored content stays empty, the model receives `[Attached without a message: receipt.jpg]` followed by the image, and the overview describes what each image shows.
5. Each image counts as 1,120 tokens (Gemini 3's default media resolution, whatever the file size) in the context-limit check and the quota reservation, on top of the text's bytes, and in the usage estimate when a provider reports no usage. The base64 data never counts as text, and the sensitive-information check reads only the text parts.
6. The API refuses with `CONTEXT_TOO_LONG` a request whose text and base64 images together exceed 7.5 MB, below gemini-proxy's 8 MB. Within the chat limits a request stays under about 6.5 MB, so this only catches mistakes.
7. gemini-proxy accepts requests of at most 8 MB (it was 2 MB) and inline data only when it is a JPEG, PNG or WebP image, by its declared type and its first bytes, in either spelling Google accepts (LiteLLM writes `inline_data`). Any other inline data, and file references (`fileData`), are refused.
8. `local-mock` has `vision` for offline tests and demos, and `google-gemini` for the Gemini demo; the other seeded models stay text-only. mock-provider accepts 8 MB, adds each image of the request to its reply as its type and size in bytes (it does not look at the picture) and reports 1,120 tokens per image.

### Limits

| Limit | Value | Why |
|---|---|---|
| Image file | 1 MB, 1,600 px on the longer side | The browser resizes before upload; small text in screenshots stays readable |
| Attachments per message | 3, documents and images together | |
| Images per chat | 6 | Each image costs about 1,120 tokens on every turn |
| Image bytes per chat | 4 MB | About 5.3 MB in base64, leaving room for 1 MB of text under 7.5 MB |
| Request to the model | 7.5 MB | gemini-proxy accepts 8 MB |

`local-mock`'s 8,192 context window holds 4 images with a short message; more need Gemini (1M).

### Cost

An image costs about 1,120 input tokens on every turn while it is in the chat, whatever its file size. A chat with 6 images uses about 6,700 tokens a turn before any text: about $0.002 at Gemini 3.5 Flash-Lite's paid list price ($0.30 per 1M input tokens), and $0 on the free tier. The default external limit of 100,000 tokens a day covers about 14 such turns across all users; raise `EXTERNAL_DAILY_TOKEN_LIMIT` for a demo day if needed. Every turn sends the chat's images again, so a chat with many images answers more slowly. In a demo on 2026-11-04, Gemini 3.5 Flash-Lite counted 1,367 input tokens for a message that only sent one 1,600 × 900 image, system message included, and 1,410 for the follow-up question, which sent the image again; the image accounts for about 1,100 of them.

### Known gaps

- Images are not checked for sensitive information. The notice shown before using an external model is the only safeguard; this is recorded in [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md).
- The API stores an image as uploaded. Only the web's re-encoding removes metadata such as GPS location, so a client calling the API directly can store it.
- Object storage needs its own encryption, backup and lifecycle settings in production.

## Not in version 1

Images in vendor-managed deployments (the next piece of work), image generation, GIF and HEIC images (Safari on iPhone converts photos to JPEG when they are picked), choosing the media resolution to save tokens, OCR for scanned PDFs, retrieving only the relevant passages of large files, keeping original documents for download, and a project page for managing files.
