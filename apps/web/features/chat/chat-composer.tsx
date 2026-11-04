'use client';

import { Attachments, FileCard, Sender } from '@ant-design/x';
import { App, Button, Image, Spin, Upload, type GetProp, type GetRef, type UploadFile, type UploadProps } from 'antd';
import { Camera, Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Attachment, AttachmentRef } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useAttachmentSize } from './attached-files';
import { useAttachmentApi } from './chat-queries';
import {
  IMAGE_EXTENSIONS,
  IMAGE_TYPES,
  MAX_CHAT_IMAGES,
  MAX_SOURCE_IMAGE_BYTES,
  isImage,
  prepareImage,
} from './prepare-image';

const MAX_LENGTH = 20000;
// The API's limits (docs/CHAT_ATTACHMENTS.md), checked here too so a file over them is never uploaded.
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = ['txt', 'md', 'csv', 'json', 'pdf', 'docx'];
// The picker offers only these. Dropped and pasted files are not filtered, so beforeUpload can say
// why a wrong type is not attached instead of skipping it silently. Image types are listed by MIME
// type as well, so a phone offers its photos.
const accept = (images: boolean) =>
  ({
    format: [...EXTENSIONS, ...(images ? IMAGE_EXTENSIONS : [])]
      .map((extension) => `.${extension}`)
      .concat(images ? IMAGE_TYPES : [])
      .join(','),
    filter: 'native',
  }) as const;

/** A file in the composer; `response` is the attachment once the API has read it. */
export type ComposerFile = UploadFile<Attachment>;
type RcFile = Parameters<GetProp<UploadProps, 'beforeUpload'>>[0];

/** Whether the selected model reads images, another model does, or no model in this deployment. */
export type ImageSupport = 'accepted' | 'otherModel' | 'unavailable';

/** A phone or tablet, where a camera button helps; on a desktop it would only open the file picker. */
function useCoarsePointer() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(pointer: coarse)');
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );
}

interface ChatComposerProps {
  /** A reply is streaming: the send button becomes a stop button */
  generating: boolean;
  /** False while no available model is selected */
  canSend: boolean;
  disabled?: boolean;
  images: ImageSupport;
  /** How many more images the chat holds */
  imageRoom: number;
  /** The prompt may be empty when files are sent. Resolves to false when the message was refused unsaved. */
  onSend: (prompt: string, attachments: AttachmentRef[]) => Promise<boolean>;
  onStop: () => void;
}

export function ChatComposer({
  generating,
  canSend,
  disabled = false,
  images,
  imageRoom,
  onSend,
  onStop,
}: ChatComposerProps) {
  const t = useTranslations('chat');
  const size = useAttachmentSize();
  const { message: toast } = App.useApp();
  const attachmentApi = useAttachmentApi();
  const touch = useCoarsePointer();
  // The draft and the attached files survive switching chats, because the chat layout stays mounted.
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<ComposerFile[]>([]);
  // What each image will look like to the model: the resized file, by upload ID.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const senderRef = useRef<GetRef<typeof Sender>>(null);
  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Uploads in flight, so removing a file stops its upload.
  const uploads = useRef(new Map<string, AbortController>());
  const getDropContainer = useCallback(() => senderRef.current?.nativeElement, []);

  const previewUrls = useRef(previews);
  useEffect(() => {
    previewUrls.current = previews;
  }, [previews]);
  useEffect(() => () => Object.values(previewUrls.current).forEach((url) => URL.revokeObjectURL(url)), []);
  const forgetPreviews = (uids: string[]) => {
    for (const uid of uids) if (previewUrls.current[uid]) URL.revokeObjectURL(previewUrls.current[uid]);
    setPreviews((current) => Object.fromEntries(Object.entries(current).filter(([uid]) => !uids.includes(uid))));
  };

  const imagesAccepted = images === 'accepted';
  // Files the API has read go with the message; a refused one stays behind with its reason.
  const ready = files.flatMap((file) => (file.status === 'done' && file.response ? [file.response] : []));
  // Images attached before the user picked a model that cannot read them stay, but cannot be sent.
  const blockedImages = !imagesAccepted && ready.some((file) => file.kind === 'IMAGE');
  const canSubmit =
    canSend &&
    !generating &&
    !blockedImages &&
    !files.some((file) => file.status === 'uploading') &&
    Boolean(draft.trim() || ready.length);
  const imagesAttached = files.filter((file) => isImage(file) && file.status !== 'error').length;

  const describe = (file: ComposerFile) =>
    file.status === 'uploading'
      ? t(isImage(file) && !previews[file.uid] ? 'attachPreparing' : 'attachReading')
      : file.status === 'error'
        ? file.error?.message
        : file.response && size(file.response);

  // Why a file cannot be attached, by its type or size; undefined when it can.
  const refusal = (file: File) => {
    if (isImage(file)) {
      if (images === 'unavailable') return t('attachError.TYPE');
      if (images === 'otherModel') return t('attachNeedsVision');
      return file.size > MAX_SOURCE_IMAGE_BYTES ? t('attachError.IMAGE_SIZE') : undefined;
    }
    if (!EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? ''))
      return t(imagesAccepted ? 'attachError.TYPE_IMAGES' : 'attachError.TYPE');
    return file.size > MAX_FILE_BYTES ? t('attachError.SIZE') : undefined;
  };

  // A file the API would refuse for its type, size or number is not added.
  const beforeUpload = (file: RcFile, batch: RcFile[]) => {
    const problem = refusal(file);
    if (problem) {
      toast.error(`${file.name}: ${problem}`);
      return Upload.LIST_IGNORE;
    }
    const accepted = batch.filter((item) => !refusal(item));
    const position = files.length + accepted.indexOf(file);
    if (position >= MAX_FILES) {
      if (position === MAX_FILES) toast.warning(t('attachLimit', { max: MAX_FILES }));
      return Upload.LIST_IGNORE;
    }
    if (isImage(file)) {
      const imagePosition = imagesAttached + accepted.filter(isImage).indexOf(file);
      if (imagePosition >= imageRoom) {
        if (imagePosition === imageRoom) toast.warning(t('attachImageLimit', { max: MAX_CHAT_IMAGES }));
        return Upload.LIST_IGNORE;
      }
    }
    return true;
  };

  // An image is resized and re-encoded before it is uploaded, so its chip shows what the model will see.
  const prepare = async (file: RcFile, signal: AbortSignal) => {
    const prepared = await prepareImage(file);
    if (prepared === 'unreadable') throw new Error(t('attachError.UNREADABLE'));
    if (prepared === 'tooLarge') throw new Error(t('attachError.IMAGE_SIZE'));
    if (!signal.aborted) setPreviews((current) => ({ ...current, [file.uid]: URL.createObjectURL(prepared) }));
    return prepared;
  };

  const customRequest: UploadProps['customRequest'] = ({ file, onSuccess, onError }) => {
    const upload = file as RcFile;
    const controller = new AbortController();
    uploads.current.set(upload.uid, controller);
    (isImage(upload) ? prepare(upload, controller.signal) : Promise.resolve(upload))
      .then((prepared) => attachmentApi.upload(prepared, controller.signal))
      .then((attachment) => onSuccess?.(attachment))
      .catch((error: Error) => {
        if (!controller.signal.aborted) onError?.(error);
      })
      .finally(() => uploads.current.delete(upload.uid));
  };

  const removeFile = (file: ComposerFile) => {
    uploads.current.get(file.uid)?.abort();
    if (file.response) void attachmentApi.remove(file.response.id).catch(() => undefined);
    setFiles((current) => current.filter((item) => item.uid !== file.uid));
    forgetPreviews([file.uid]);
  };

  // Each pasted or photographed file is uploaded on its own, so their numbers are counted here;
  // beforeUpload checks the rest.
  const addFiles = (added: FileList) => {
    let room = MAX_FILES - files.length;
    let imagesLeft = imageRoom - imagesAttached;
    for (const file of Array.from(added)) {
      if (!refusal(file)) {
        if (room <= 0) {
          toast.warning(t('attachLimit', { max: MAX_FILES }));
          break;
        }
        if (isImage(file) && imagesLeft-- <= 0) {
          toast.warning(t('attachImageLimit', { max: MAX_CHAT_IMAGES }));
          continue;
        }
        room--;
      }
      attachmentsRef.current?.upload(file);
    }
  };

  const fileLimitReached = files.length >= MAX_FILES;

  return (
    <Sender
      ref={senderRef}
      aria-label={t('messageLabel')}
      value={draft}
      // The API takes up to 20,000 characters.
      onChange={(value) => setDraft(value.slice(0, MAX_LENGTH))}
      onSubmit={(value) => {
        if (!canSubmit) return;
        const sentFiles = files.filter((file) => file.status === 'done');
        setDraft('');
        // Sent files belong to the chat now, so they are cleared without removing them on the API.
        setFiles([]);
        void onSend(value.trim(), ready).then((accepted) => {
          // Refused before it was saved (too long for the model, say): give the message back, unless
          // the user has started another one, so it can be sent again without attaching the files again.
          if (accepted) {
            forgetPreviews(sentFiles.map((file) => file.uid));
            return;
          }
          setDraft((current) => current || value);
          setFiles((current) => (current.length ? current : sentFiles));
        });
      }}
      onPasteFile={addFiles}
      loading={generating}
      onCancel={onStop}
      disabled={disabled}
      placeholder={t('placeholder')}
      autoSize={{ minRows: 1, maxRows: 6 }}
      className="bg-surface shadow-lg"
      // Our own row of files: Ant Design X's list shows its remove control only on hover, as an
      // unlabelled element, so it could not be reached on a phone or with the keyboard.
      header={
        <Sender.Header open={files.length > 0} closable={false} styles={{ content: { padding: 0 } }}>
          {/* A phone swipes through the files; a wider screen wraps them, as a mouse cannot scroll sideways. */}
          <ul aria-label={t('attachedFiles')} className="flex gap-2 overflow-x-auto p-2 sm:flex-wrap">
            {files.map((file) => (
              <li key={file.uid} className="relative shrink-0">
                {isImage(file) && file.status !== 'error' ? (
                  <ImageChip
                    // The resized file's name once it is uploaded, such as photo.webp.
                    name={file.response?.filename ?? file.name}
                    src={previews[file.uid]}
                    busy={file.status === 'uploading'}
                    blocked={blockedImages}
                    description={describe(file)}
                  />
                ) : (
                  <FileCard
                    name={file.name}
                    byte={file.size}
                    // A refused image is shown as a file, with its reason.
                    type="file"
                    description={describe(file)}
                    title={file.status === 'error' ? file.error?.message : undefined}
                    classNames={
                      file.status === 'error'
                        ? { file: 'border border-error-border bg-error-soft', description: 'line-clamp-2 text-error' }
                        : undefined
                    }
                  />
                )}
                <span className="absolute top-1 right-1">
                  <Button
                    size="small"
                    shape="circle"
                    icon={<X size={12} />}
                    title={t('attachRemove', { name: file.response?.filename ?? file.name })}
                    aria-label={t('attachRemove', { name: file.response?.filename ?? file.name })}
                    onClick={() => removeFile(file)}
                  />
                </span>
              </li>
            ))}
          </ul>
          {blockedImages && <p className="px-3 pb-2 text-xs text-warning">{t('attachNeedsVision')}</p>}
        </Sender.Header>
      }
      // Attachments runs the uploads and the drop area; the attach button opens its file picker.
      prefix={
        <div className="flex items-center">
          <Attachments
            ref={attachmentsRef}
            items={files}
            accept={accept(imagesAccepted)}
            multiple
            disabled={disabled}
            getDropContainer={getDropContainer}
            placeholder={(type) =>
              type === 'drop' ? { title: t(imagesAccepted ? 'attachDropWithImages' : 'attachDrop') } : {}
            }
            beforeUpload={beforeUpload}
            customRequest={customRequest}
            onChange={({ fileList }) => setFiles(fileList)}
          >
            <Button
              type="text"
              icon={<Paperclip size={16} />}
              title={t(imagesAccepted ? 'attachWithImages' : 'attach')}
              aria-label={t(imagesAccepted ? 'attachWithImages' : 'attach')}
              disabled={disabled || fileLimitReached}
            />
          </Attachments>
          {touch && imagesAccepted && (
            <>
              <Button
                type="text"
                icon={<Camera size={16} />}
                title={t('attachCamera')}
                aria-label={t('attachCamera')}
                disabled={disabled || fileLimitReached || imagesAttached >= imageRoom}
                onClick={() => cameraRef.current?.click()}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </>
          )}
        </div>
      }
      // Named buttons (the defaults only carry an icon); send also waits for an available model and
      // for files still being read.
      suffix={(_, { components: { SendButton, LoadingButton } }) =>
        generating ? (
          <LoadingButton title={t('stop')} aria-label={t('stop')} />
        ) : (
          <SendButton title={t('send')} aria-label={t('send')} disabled={!canSubmit} />
        )
      }
    />
  );
}

/** An attached image as the model will see it; a click opens it larger. */
function ImageChip({
  name,
  src,
  busy,
  blocked,
  description,
}: {
  name: string;
  src?: string;
  busy: boolean;
  blocked: boolean;
  description?: string;
}) {
  return (
    <div
      title={description}
      aria-busy={busy || undefined}
      className={cn(
        'relative grid size-16 place-items-center overflow-hidden rounded-brand border border-line-secondary bg-fill-tertiary',
        '[&_img]:size-16 [&_img]:object-cover',
        blocked && 'opacity-50',
      )}
    >
      {src && <Image src={src} alt={name} width={64} height={64} />}
      {busy && (
        <span className="absolute inset-0 grid place-items-center bg-surface/60">
          <Spin size="small" />
        </span>
      )}
      <span className="sr-only">{description}</span>
    </div>
  );
}
