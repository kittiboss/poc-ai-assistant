'use client';
import { Alert, App, Button, Checkbox, Dropdown, Select } from 'antd';
import { Download, LoaderCircle, MessageSquare, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { StatusTag } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { ApiError } from '@/lib/api/client';
import type { Message, Model } from '@/lib/api/types';
import { useUIStore } from '@/stores/ui-store-provider';
import { ChatComposer } from './chat-composer';
import {
  isConversationId,
  type Rating,
  useBranchConversation,
  useConversation,
  useFeedback,
  useKnowledgeStatus,
  useModels,
} from './chat-queries';
import { useChatList, useChatMenu } from './chat-sidebar';
import { exportChat } from './export-chat';
import type { MessageActions } from './message-bubble';
import { MessageList } from './message-list';
import { PromptDialog } from './prompt-dialog';
import { useSendMessage } from './use-send-message';

type Dialog = { kind: 'edit'; message: Message } | { kind: 'feedback'; message: Message; rating: Rating };

/** `/` is a new chat and `/c/<id>` an existing one; the id comes from the URL. */
export function ChatApp() {
  const { id: activeId } = useParams<{ id?: string }>();
  const router = useRouter();
  const t = useTranslations('chat');
  const enums = useEnumLabel();
  const { message: toast } = App.useApp();
  const selectedModelId = useUIStore((state) => state.selectedModelId);
  const setSelectedModelId = useUIStore((state) => state.setSelectedModelId);
  const stream = useUIStore((state) => state.stream);
  const chatError = useUIStore((state) => state.chatError);
  const setChatError = useUIStore((state) => state.setChatError);
  const [useProductCatalog, setUseProductCatalog] = useState(true);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const models = useModels();
  const catalog = useKnowledgeStatus();
  // The sidebar's list, for the title until the chat itself has loaded.
  const { conversations } = useChatList();
  const conversation = useConversation(activeId, stream?.conversationId === activeId);
  const { chatMenu, dialog: renameDialog } = useChatMenu();
  const branchConversation = useBranchConversation();
  const feedback = useFeedback();
  const send = useSendMessage();

  const messages = conversation.data?.messages ?? [];
  const modelList = useMemo(() => models.data ?? [], [models.data]);
  const modelNames = useMemo(() => new Map(modelList.map((model) => [model.id, model.displayName])), [modelList]);
  const modelId = selectedModelId || modelList.find((model) => model.available)?.id || modelList[0]?.id || '';
  const selectedModel = modelList.find((model) => model.id === modelId);
  const catalogOn = useProductCatalog && Boolean(catalog.data?.available);
  const generating = stream !== null;
  const notFound =
    (activeId !== undefined && !isConversationId(activeId)) ||
    (conversation.error instanceof ApiError && [400, 404].includes(conversation.error.status));
  const loadError = [models.error, conversations.error, notFound ? null : conversation.error].find(Boolean);
  const error = chatError || loadError?.message;
  const title =
    conversation.data?.title ?? conversations.data?.find((item) => item.id === activeId)?.title ?? t('newConversation');
  const reportError = (cause: unknown) => toast.error((cause as Error).message);

  // Branch, edit and regenerate copy the chat into a new one, so the original stays as it was.
  const branch = async (message: Message, before = false) => {
    if (!activeId) return undefined;
    setChatError('');
    const copy = await branchConversation.mutateAsync({ id: activeId, messageId: message.id, before });
    router.push(`/c/${copy.id}`);
    return copy;
  };
  const resend = async (userMessage: Message, prompt: string) => {
    const copy = await branch(userMessage, true);
    if (copy) await send({ conversationId: copy.id, prompt, modelId, useProductCatalog: catalogOn });
  };
  const submitFeedback = async (message: Message, rating: Rating, comment: string) => {
    if (!activeId) return;
    try {
      await feedback.mutateAsync({ conversationId: activeId, messageId: message.id, rating, comment });
      setDialog(null);
      toast.success(t('feedbackSaved'));
    } catch (cause) {
      reportError(cause);
    }
  };
  const handlers: MessageActions = {
    branch: (message) =>
      branch(message)
        .then(() => toast.success(t('branched')))
        .catch(reportError),
    edit: (message) => setDialog({ kind: 'edit', message }),
    regenerate: (message) => {
      const index = messages.findIndex((item) => item.id === message.id);
      const userMessage = messages.slice(0, index).findLast((item) => item.role === 'USER');
      if (userMessage) resend(userMessage, userMessage.content).catch(reportError);
    },
    rate: (message, rating) => setDialog({ kind: 'feedback', message, rating }),
  };
  // The bubbles get one object for the life of the page, which calls the latest handlers; a new
  // object each render would re-render every memoized bubble on each streamed chunk.
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  const messageActions = useMemo<MessageActions>(
    () => ({
      branch: (message) => handlersRef.current.branch(message),
      edit: (message) => handlersRef.current.edit(message),
      regenerate: (message) => handlersRef.current.regenerate(message),
      rate: (message, rating) => handlersRef.current.rate(message, rating),
    }),
    [],
  );

  const detail = conversation.data;
  // Only the title, the export menu and the chat's own menu, so the title keeps its room on a phone.
  const header = (
    <>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold">{title}</h1>
        <p className="hidden truncate text-xs text-fg-secondary sm:block">{t('private')}</p>
      </div>
      {detail && (
        <div className="-mr-1 flex shrink-0 items-center gap-1">
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'md', label: t('exportMarkdown'), onClick: () => exportChat(detail, 'md') },
                { key: 'json', label: t('exportJson'), onClick: () => exportChat(detail, 'json') },
              ],
            }}
          >
            <Button type="text" icon={<Download size={16} />} title={t('export')} aria-label={t('export')} />
          </Dropdown>
          <Dropdown menu={{ items: chatMenu(detail) }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              icon={<MoreHorizontal size={16} />}
              title={t('chatActions')}
              aria-label={t('chatActions')}
            />
          </Dropdown>
        </div>
      )}
    </>
  );

  // The model and the product catalog for the next message, right above the composer. The status tag
  // needs a wide composer; a container query, because the sidebar changes the width too.
  const composerOptions = (
    <div className="@container">
      <div className="flex items-center gap-2 @sm:gap-3">
        <Select
          aria-label={t('chatModel')}
          className="max-w-96 min-w-0 flex-1"
          value={modelId || undefined}
          disabled={generating}
          onChange={setSelectedModelId}
          popupMatchSelectWidth={false}
          options={modelList.map((model) => ({
            value: model.id,
            disabled: !model.available,
            label: t('modelOption', {
              name: model.displayName,
              provider: model.provider,
              location: model.local ? t('modelLocal') : t('modelExternal'),
              status: enums.modelStatus(model.status),
            }),
          }))}
        />
        <Checkbox
          checked={catalogOn}
          disabled={generating || !catalog.data?.available}
          onChange={(event) => setUseProductCatalog(event.target.checked)}
          title={
            catalog.data?.available
              ? t('productCatalogReady', { count: catalog.data.indexed })
              : t('productCatalogUnavailable', { problem: catalog.data?.problem ?? t('productCatalogNotReady') })
          }
          className="shrink-0 whitespace-nowrap"
        >
          {t('productCatalog')}
        </Checkbox>
        {selectedModel && (
          <StatusTag tone={selectedModel.available ? 'success' : 'error'} className="hidden shrink-0 @xl:inline-flex">
            {t('modelBadge', {
              location: enums.label('location', selectedModel.local ? 'LOCAL' : 'EXTERNAL'),
              status: enums.modelStatus(selectedModel.status),
            })}
          </StatusTag>
        )}
      </div>
    </div>
  );

  return (
    <Shell active="chat" header={header}>
      <div className="flex h-full flex-col">
        <MessageList
          messages={notFound ? [] : messages}
          actions={messageActions}
          canChange={!generating}
          modelNames={modelNames}
        >
          {notFound ? (
            <NotFound />
          ) : activeId && conversation.isPending ? (
            <div className="grid place-items-center py-20">
              <LoaderCircle className="animate-spin text-primary" />
            </div>
          ) : activeId && conversation.isError ? null : (
            !messages.length && <EmptyState models={modelList} />
          )}
        </MessageList>
        <footer className="shrink-0 bg-linear-to-t from-layout via-layout px-3 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:px-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {catalogOn && catalog.data?.embeddingModel.local === false && (
              <Alert
                type="warning"
                title={t('productCatalogExternal', {
                  provider: catalog.data.embeddingModel.provider ?? t('productCatalogExternalProvider'),
                  model: catalog.data.embeddingModel.displayName,
                })}
              />
            )}
            {selectedModel && !selectedModel.local && (
              <Alert type="warning" title={t('externalNotice', { provider: selectedModel.provider })} />
            )}
            {error && (
              <Alert type="error" title={error} closable={Boolean(chatError)} onClose={() => setChatError('')} />
            )}
            {composerOptions}
            <ChatComposer
              generating={generating}
              canSend={Boolean(selectedModel?.available)}
              disabled={notFound}
              onSend={(prompt) =>
                void send({ conversationId: activeId, prompt, modelId, useProductCatalog: catalogOn })
              }
              onStop={() => stream?.abort.abort()}
            />
            <p className="text-center text-[11px] text-fg-secondary">{t('disclaimerSources')}</p>
          </div>
        </footer>
      </div>
      {renameDialog}
      {dialog?.kind === 'edit' && (
        <PromptDialog
          key={dialog.message.id}
          title={t('editResend')}
          label={t('editPrompt')}
          initialValue={dialog.message.content}
          multiline
          requiredMessage={t('messageRequired')}
          maxLength={20000}
          okText={t('send')}
          onSubmit={(value) => {
            setDialog(null);
            resend(dialog.message, value).catch(reportError);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'feedback' && (
        <PromptDialog
          key={`${dialog.message.id}:${dialog.rating}`}
          title={dialog.rating === 1 ? t('helpful') : t('unhelpful')}
          label={t('feedbackPrompt')}
          initialValue={dialog.message.feedbackComment ?? ''}
          multiline
          maxLength={1000}
          okText={t('sendFeedback')}
          saving={feedback.isPending}
          onSubmit={(value) => void submitFeedback(dialog.message, dialog.rating, value)}
          onClose={() => setDialog(null)}
        />
      )}
    </Shell>
  );
}

function NotFound() {
  const t = useTranslations('chat');
  return (
    <div className="py-20 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-brand-lg bg-fill-tertiary text-fg-tertiary">
        <MessageSquare />
      </div>
      <h2 className="mt-5 text-2xl font-semibold">{t('notFound')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-fg-secondary">{t('notFoundBody')}</p>
      <Link href="/" className="mt-6 inline-block font-medium text-primary underline">
        {t('startNew')}
      </Link>
    </div>
  );
}

function EmptyState({ models }: { models: Model[] }) {
  const t = useTranslations('chat');
  return (
    <div className="py-20 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-brand-lg bg-primary-soft text-primary">
        <MessageSquare />
      </div>
      <h2 className="mt-5 text-2xl font-semibold">{t('emptyTitle')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-fg-secondary">
        {t('emptyBody', { count: models.filter((model) => model.available).length })}
      </p>
    </div>
  );
}
