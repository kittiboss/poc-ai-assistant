-- Images attached to chat messages. The file itself is kept in object storage under storageKey;
-- the row keeps its type and size. Existing attachments are documents.
CREATE TYPE "AttachmentKind" AS ENUM ('DOCUMENT', 'IMAGE');

ALTER TABLE "Attachment" ADD COLUMN "kind" "AttachmentKind" NOT NULL DEFAULT 'DOCUMENT',
ADD COLUMN "mimeType" VARCHAR(50),
ADD COLUMN "width" INTEGER,
ADD COLUMN "height" INTEGER,
ADD COLUMN "storageKey" VARCHAR(200);

CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");
