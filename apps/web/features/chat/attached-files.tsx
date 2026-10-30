'use client';

import { FileCard } from '@ant-design/x';
import { useFormatter, useTranslations } from 'next-intl';
import type { AttachmentRef } from '@/lib/api/types';

/** How much of a file the model reads, such as "2 pages · 46 characters". */
export function useAttachmentSize() {
  const t = useTranslations('chat');
  const format = useFormatter();
  return (file: AttachmentRef) =>
    t(file.pageCount ? 'attachPagesChars' : 'attachChars', {
      pages: file.pageCount ?? 0,
      chars: format.number(file.charCount),
    });
}

/** The files a sent message attached, shown above its text. */
export function AttachedFiles({ files }: { files: AttachmentRef[] }) {
  const t = useTranslations('chat');
  const size = useAttachmentSize();
  return (
    <ul aria-label={t('attachedFiles')} className="flex flex-wrap justify-end gap-2">
      {files.map((file) => (
        <li key={file.id}>
          <FileCard name={file.filename} byte={file.byteSize} description={size(file)} />
        </li>
      ))}
    </ul>
  );
}
