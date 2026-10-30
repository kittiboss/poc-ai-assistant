-- Documents attached to chat messages. Only the extracted text is stored; messages
-- reference attachments in their metadata. Unsent ones (sentAt IS NULL) are swept after 24 hours.
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "charCount" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Attachment_sentAt_createdAt_idx" ON "Attachment"("sentAt", "createdAt");

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
