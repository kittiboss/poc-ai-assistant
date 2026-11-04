'use client';

import { FileCard } from '@ant-design/x';
import { useFormatter, useTranslations } from 'next-intl';
import type { AttachmentRef } from '@/lib/api/types';

/** How much of a file the model reads, such as "2 pages · 46 characters", or an image's size in pixels. */
export function useAttachmentSize() {
  const t = useTranslations('chat');
  const format = useFormatter();
  return (file: AttachmentRef) =>
    file.kind === 'IMAGE'
      ? t('attachImageSize', { width: format.number(file.width ?? 0), height: format.number(file.height ?? 0) })
      : t(file.pageCount ? 'attachPagesChars' : 'attachChars', {
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
          {/* Without a type, FileCard shows an image's name as an empty picture. */}
          <FileCard name={file.filename} byte={file.byteSize} description={size(file)} type="file" />
        </li>
      ))}
    </ul>
  );
}
