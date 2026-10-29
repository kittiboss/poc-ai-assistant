'use client';

import { Attachments, FileCard, Sender } from '@ant-design/x';
import { App, Button, Upload, type GetProp, type GetRef, type UploadFile, type UploadProps } from 'antd';
import { Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import type { Attachment, AttachmentRef } from '@/lib/api/types';
import { useAttachmentSize } from './attached-files';
import { useAttachmentApi } from './chat-queries';

const MAX_LENGTH = 20000;
// The API's limits (docs/CHAT_ATTACHMENTS.md), checked here too so a file over them is never uploaded.
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = ['txt', 'md', 'csv', 'json', 'pdf', 'docx'];
// The picker offers only these. Dropped and pasted files are not filtered, so beforeUpload can say
// why a wrong type is not attached instead of skipping it silently.
const ACCEPT = { format: EXTENSIONS.map((extension) => `.${extension}`).join(','), filter: 'native' } as const;

const fits = (file: File) =>
  EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? '') && file.size <= MAX_FILE_BYTES;

/** A file in the composer; `response` is the attachment once the API has read it. */
export type ComposerFile = UploadFile<Attachment>;
type RcFile = Parameters<GetProp<UploadProps, 'beforeUpload'>>[0];

interface ChatComposerProps {
  /** A reply is streaming: the send button becomes a stop button */
  generating: boolean;
  /** False while no available model is selected */
  canSend: boolean;
  disabled?: boolean;
  /** The prompt may be empty when files are sent. Resolves to false when the message was refused unsaved. */
  onSend: (prompt: string, attachments: AttachmentRef[]) => Promise<boolean>;
  onStop: () => void;
}

export function ChatComposer({ generating, canSend, disabled = false, onSend, onStop }: ChatComposerProps) {
  const t = useTranslations('chat');
  const size = useAttachmentSize();
  const { message: toast } = App.useApp();
  const attachmentApi = useAttachmentApi();
  // The draft and the attached files survive switching chats, because the chat layout stays mounted.
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const senderRef = useRef<GetRef<typeof Sender>>(null);
  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null);
  // Uploads in flight, so removing a file stops its upload.
  const uploads = useRef(new Map<string, AbortController>());
  const getDropContainer = useCallback(() => senderRef.current?.nativeElement, []);

  // Files the API has read go with the message; a refused one stays behind with its reason.
  const ready = files.flatMap((file) => (file.status === 'done' && file.response ? [file.response] : []));
  const canSubmit =
    canSend &&
    !generating &&
    !files.some((file) => file.status === 'uploading') &&
    Boolean(draft.trim() || ready.length);

  const describe = (file: ComposerFile) =>
    file.status === 'uploading'
      ? t('attachReading')
      : file.status === 'error'
        ? file.error?.message
        : file.response && size(file.response);

  // A file the API would refuse for its type, size or number is not added. This also keeps images
  // out: Ant Design X waits forever for a preview of an image the browser cannot decode.
  const beforeUpload = (file: RcFile, batch: RcFile[]) => {
    if (!fits(file)) {
      toast.error(`${file.name}: ${t(file.size > MAX_FILE_BYTES ? 'attachError.SIZE' : 'attachError.TYPE')}`);
      return Upload.LIST_IGNORE;
    }
    const position = files.length + batch.filter(fits).indexOf(file);
    if (position >= MAX_FILES) {
      if (position === MAX_FILES) toast.warning(t('attachLimit', { max: MAX_FILES }));
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const customRequest: UploadProps['customRequest'] = ({ file, onSuccess, onError }) => {
    const upload = file as RcFile;
    const controller = new AbortController();
    uploads.current.set(upload.uid, controller);
    attachmentApi
      .upload(upload, controller.signal)
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
  };

  // Each pasted file is uploaded on its own, so their number is counted here; beforeUpload checks the rest.
  const pasteFiles = (pasted: FileList) => {
    let room = MAX_FILES - files.length;
    for (const file of Array.from(pasted)) {
      if (fits(file) && room-- <= 0) {
        toast.warning(t('attachLimit', { max: MAX_FILES }));
        break;
      }
      attachmentsRef.current?.upload(file);
    }
  };

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
          if (accepted) return;
          setDraft((current) => current || value);
          setFiles((current) => (current.length ? current : sentFiles));
        });
      }}
      onPasteFile={pasteFiles}
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
                <FileCard
                  name={file.name}
                  byte={file.size}
                  description={describe(file)}
                  title={file.status === 'error' ? file.error?.message : undefined}
                  classNames={
                    file.status === 'error'
                      ? { file: 'border border-error-border bg-error-soft', description: 'line-clamp-2 text-error' }
                      : undefined
                  }
                />
                <span className="absolute top-1 right-1">
                  <Button
                    size="small"
                    shape="circle"
                    icon={<X size={12} />}
                    title={t('attachRemove', { name: file.name })}
                    aria-label={t('attachRemove', { name: file.name })}
                    onClick={() => removeFile(file)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Sender.Header>
      }
      // Attachments runs the uploads and the drop area; the attach button opens its file picker.
      prefix={
        <Attachments
          ref={attachmentsRef}
          items={files}
          accept={ACCEPT}
          multiple
          disabled={disabled}
          getDropContainer={getDropContainer}
          placeholder={(type) => (type === 'drop' ? { title: t('attachDrop') } : {})}
          beforeUpload={beforeUpload}
          customRequest={customRequest}
          onChange={({ fileList }) => setFiles(fileList)}
        >
          <Button
            type="text"
            icon={<Paperclip size={16} />}
            title={t('attach')}
            aria-label={t('attach')}
            disabled={disabled || files.length >= MAX_FILES}
          />
        </Attachments>
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
