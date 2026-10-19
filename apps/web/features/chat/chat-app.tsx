'use client';
import { Alert, App, Button, Checkbox, Dropdown, Input, Select, type MenuProps } from 'antd';
import {
  Archive,
  ArchiveRestore,
  Download,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { StatusTag } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { ApiError } from '@/lib/api/client';
import type { ConversationChange, ConversationSummary, Message, Model } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';
import { ChatComposer } from './chat-composer';
import {
  isConversationId,
  type Rating,
  useBranchConversation,
  useConversation,
  useConversations,
  useDeleteConversation,
  useFeedback,
  useModels,
  useUpdateConversation,
} from './chat-queries';
import { exportChat } from './export-chat';
import type { MessageActions } from './message-bubble';
import { MessageList } from './message-list';
import { PromptDialog } from './prompt-dialog';
import { useSendMessage } from './use-send-message';

type Dialog =
  | { kind: 'rename'; item: ConversationSummary }
  | { kind: 'edit'; message: Message }
  | { kind: 'feedback'; message: Message; rating: Rating };

/** `/` is a new chat and `/c/<id>` an existing one; the id comes from the URL. */
export function ChatApp() {
  const { id: activeId } = useParams<{ id?: string }>();
  const router = useRouter();
  const t = useTranslations('chat');
  const enums = useEnumLabel();
  const { message: toast, modal } = App.useApp();
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);
  const selectedModelId = useUIStore((state) => state.selectedModelId);
  const setSelectedModelId = useUIStore((state) => state.setSelectedModelId);
  const search = useUIStore((state) => state.conversationSearch);
  const setSearch = useUIStore((state) => state.setConversationSearch);
  const stream = useUIStore((state) => state.stream);
  const chatError = useUIStore((state) => state.chatError);
  const setChatError = useUIStore((state) => state.setChatError);
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Search runs on the server (titles and message content), so it waits for a pause in typing.
  const [searchQuery, setSearchQuery] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const models = useModels();
  const conversations = useConversations({ search: searchQuery, archived });
  const conversation = useConversation(activeId, stream?.conversationId === activeId);
  const updateConversation = useUpdateConversation();
  const deleteConversation = useDeleteConversation();
  const branchConversation = useBranchConversation();
  const feedback = useFeedback();
  const send = useSendMessage();

  const messages = conversation.data?.messages ?? [];
  const modelList = useMemo(() => models.data ?? [], [models.data]);
  const modelNames = useMemo(() => new Map(modelList.map((model) => [model.id, model.displayName])), [modelList]);
  const modelId = selectedModelId || modelList.find((model) => model.available)?.id || modelList[0]?.id || '';
  const selectedModel = modelList.find((model) => model.id === modelId);
  const generating = stream !== null;
  const notFound =
    (activeId !== undefined && !isConversationId(activeId)) ||
    (conversation.error instanceof ApiError && [400, 404].includes(conversation.error.status));
  const loadError = [models.error, conversations.error, notFound ? null : conversation.error].find(Boolean);
  const error = chatError || loadError?.message;
  const title =
    conversation.data?.title ?? conversations.data?.find((item) => item.id === activeId)?.title ?? t('newConversation');
  const reportError = (cause: unknown) => toast.error((cause as Error).message);

  const leaveSidebar = () => {
    setMobileNavOpen(false);
    setChatError('');
  };
  // The chat itself is created with the first message, so no empty chats pile up in the list.
  const newChat = () => {
    leaveSidebar();
    router.push('/');
  };
  const update = async (item: ConversationSummary, change: ConversationChange, done?: string) => {
    try {
      await updateConversation.mutateAsync({ id: item.id, change });
      if (done) toast.success(done);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    }
  };
  const confirmDelete = (item: ConversationSummary) =>
    modal.confirm({
      title: t('deleteTitle'),
      content: t('deleteConfirm', { title: item.title }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteConversation.mutateAsync(item.id);
          toast.success(t('deleted'));
          if (item.id === activeId) router.push('/');
        } catch (cause) {
          reportError(cause);
        }
      },
    });

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
    if (copy) await send({ conversationId: copy.id, prompt, modelId });
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

  const rowMenu = (item: ConversationSummary): MenuProps['items'] => [
    {
      key: 'pin',
      icon: item.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      label: item.pinned ? t('unpin') : t('pin'),
      onClick: () => void update(item, { pinned: !item.pinned }),
    },
    {
      key: 'rename',
      icon: <Pencil size={14} />,
      label: t('rename'),
      onClick: () => setDialog({ kind: 'rename', item }),
    },
    {
      key: 'archive',
      icon: item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
      label: item.archived ? t('restore') : t('archive'),
      onClick: () =>
        void update(item, { archived: !item.archived }, item.archived ? t('restoredToast') : t('archivedToast')),
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <Trash2 size={14} />,
      label: t('delete'),
      danger: true,
      onClick: () => confirmDelete(item),
    },
  ];

  const sidebar = (
    <>
      <div className="space-y-3 p-3">
        <Button type="primary" size="large" block icon={<Plus size={17} />} onClick={newChat}>
          {t('newChat')}
        </Button>
        <Input
          size="large"
          variant="filled"
          allowClear
          aria-label={t('searchLabel')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchContent')}
          prefix={<Search size={16} className="text-fg-tertiary" />}
        />
        <Checkbox checked={archived} onChange={(event) => setArchived(event.target.checked)} className="text-xs">
          {t('showArchived')}
        </Checkbox>
      </div>
      <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">
        {conversations.data?.map((item) => (
          <div
            key={item.id}
            className={cn(
              'group flex items-center rounded-brand pr-1',
              activeId === item.id ? 'bg-primary-soft' : 'hover:bg-fill-quaternary',
            )}
          >
            <Link
              href={`/c/${item.id}`}
              onClick={leaveSidebar}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm text-fg"
            >
              {item.pinned ? (
                <Pin size={15} className="shrink-0 text-primary" aria-label={t('pinned')} />
              ) : (
                <MessageSquare size={15} className="shrink-0 text-fg-tertiary" />
              )}
              <span className="truncate">{item.title}</span>
            </Link>
            <Dropdown menu={{ items: rowMenu(item) }} trigger={['click']} placement="bottomRight">
              <Button
                type="text"
                size="small"
                title={t('chatActions')}
                aria-label={t('chatActions')}
                icon={<MoreHorizontal size={15} />}
                // Stays visible while its menu is open.
                className="hidden text-fg-tertiary group-focus-within:inline-flex group-hover:inline-flex pointer-coarse:inline-flex [&.ant-dropdown-open]:inline-flex"
              />
            </Dropdown>
          </div>
        ))}
        {conversations.data?.length === 0 && (searchQuery || archived) && (
          <p className="px-3 py-2 text-xs text-fg-tertiary">{searchQuery ? t('noMatches') : t('noArchived')}</p>
        )}
      </div>
    </>
  );

  const detail = conversation.data;
  const header = (
    <>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold">{title}</h1>
        <p className="hidden truncate text-xs text-fg-secondary sm:block">{t('private')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {detail && (
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
        )}
        <Select
          aria-label={t('chatModel')}
          className="w-36 sm:w-64 lg:w-96"
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
        {selectedModel && (
          <StatusTag tone={selectedModel.available ? 'success' : 'error'} className="hidden xl:inline-flex">
            {t('modelBadge', {
              location: enums.label('location', selectedModel.local ? 'LOCAL' : 'EXTERNAL'),
              status: enums.modelStatus(selectedModel.status),
            })}
          </StatusTag>
        )}
      </div>
    </>
  );

  return (
    <Shell active="chat" sidebar={sidebar} header={header}>
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
            {selectedModel && !selectedModel.local && (
              <Alert type="warning" title={t('externalNotice', { provider: selectedModel.provider })} />
            )}
            {error && (
              <Alert type="error" title={error} closable={Boolean(chatError)} onClose={() => setChatError('')} />
            )}
            <ChatComposer
              generating={generating}
              canSend={Boolean(selectedModel?.available)}
              disabled={notFound}
              onSend={(prompt) => void send({ conversationId: activeId, prompt, modelId })}
              onStop={() => stream?.abort.abort()}
            />
            <p className="text-center text-[11px] text-fg-secondary">{t('disclaimerSources')}</p>
          </div>
        </footer>
      </div>
      {dialog?.kind === 'rename' && (
        <PromptDialog
          key={dialog.item.id}
          title={t('renameTitle')}
          label={t('renamePrompt')}
          initialValue={dialog.item.title}
          requiredMessage={t('titleRequired')}
          maxLength={120}
          saving={updateConversation.isPending}
          onSubmit={async (value) => {
            if (await update(dialog.item, { title: value }, t('renamed'))) setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
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
