'use client';

import { FileCard } from '@ant-design/x';
import { Image } from 'antd';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AttachmentRef } from '@/lib/api/types';
import { useAttachmentImages } from './chat-queries';

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

/**
 * The files a sent message attached, shown above its text: images as pictures that open in a
 * viewer, which steps through the message's images, then documents as cards.
 */
export function AttachedFiles({ files }: { files: AttachmentRef[] }) {
  const t = useTranslations('chat');
  const size = useAttachmentSize();
  const images = files.filter((file) => file.kind === 'IMAGE');
  const documents = files.filter((file) => file.kind !== 'IMAGE');
  const urls = useAttachmentImages(images.map((file) => file.id));
  // The viewer shows the images that have loaded; `viewing` is the one open, by attachment ID.
  const viewable = images.flatMap((file, index) => {
    const url = urls[index].data;
    return url ? [{ id: file.id, src: url, alt: file.filename }] : [];
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const current = viewable.findIndex((item) => item.id === viewing);

  return (
    <>
      <ul aria-label={t('attachedFiles')} className="flex flex-wrap justify-end gap-2">
        {images.map((file, index) => (
          // A fixed cap on the image sizes this item; on a very narrow screen the item crops it.
          <li key={file.id} className="max-w-full min-w-0 overflow-hidden rounded-brand-lg">
            {urls[index].isError ? (
              <FileCard name={file.filename} byte={file.byteSize} description={t('imageUnavailable')} type="file" />
            ) : (
              <AttachedImage file={file} src={urls[index].data} onOpen={() => setViewing(file.id)} />
            )}
          </li>
        ))}
        {documents.map((file) => (
          <li key={file.id}>
            {/* Without a type, FileCard shows an image's name as an empty picture. */}
            <FileCard name={file.filename} byte={file.byteSize} description={size(file)} type="file" />
          </li>
        ))}
      </ul>
      {viewable.length > 0 && (
        <Image.PreviewGroup
          items={viewable.map(({ src }) => src)}
          preview={{
            open: current >= 0,
            current: Math.max(0, current),
            // The viewer takes its alt text from here only, not from `items`.
            alt: viewable[Math.max(0, current)]?.alt,
            onOpenChange: (open) => {
              if (!open) setViewing(null);
            },
            onChange: (index) => setViewing(viewable[index]?.id ?? null),
          }}
        />
      )}
    </>
  );
}

/**
 * An image at a fixed height and its own proportions, so the message does not move when it loads;
 * a very wide one is cropped. A button, so the keyboard can open it too.
 */
function AttachedImage({ file, src, onOpen }: { file: AttachmentRef; src?: string; onOpen: () => void }) {
  const t = useTranslations('chat');
  return (
    <button
      type="button"
      title={file.filename}
      aria-label={t('imageOpen', { name: file.filename })}
      disabled={!src}
      onClick={onOpen}
      style={{ aspectRatio: file.width && file.height ? `${file.width} / ${file.height}` : undefined }}
      className="block h-32 max-w-72 min-w-12 cursor-zoom-in overflow-hidden rounded-brand-lg border border-line-secondary bg-fill-tertiary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:animate-pulse disabled:cursor-default sm:h-40 [&_.ant-image]:size-full [&_img]:size-full [&_img]:object-cover"
    >
      {src && <Image src={src} alt={file.filename} preview={false} />}
    </button>
  );
}
