'use client';
import { Alert, App, Button, Input, Select } from 'antd';
import { LoaderCircle, MessageSquare, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { StatusTag } from '@/components/ui/status-tag';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { ApiError } from '@/lib/api/client';
import type { Model } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';
import { ChatComposer } from './chat-composer';
import {
  isConversationId,
  useConversation,
  useConversations,
  useDeleteConversation,
  useModels,
  useRenameConversation,
} from './chat-queries';
import { MessageList } from './message-list';
import { RenameDialog } from './rename-dialog';
import { useSendMessage } from './use-send-message';

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
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  const models = useModels();
  const conversations = useConversations();
  const conversation = useConversation(activeId, stream?.conversationId === activeId);
  const renameConversation = useRenameConversation();
  const deleteConversation = useDeleteConversation();
  const send = useSendMessage();

  const messages = conversation.data?.messages ?? [];
  const modelList = useMemo(() => models.data ?? [], [models.data]);
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

  const leaveSidebar = () => {
    setMobileNavOpen(false);
    setChatError('');
  };
  // The chat itself is created with the first message, so no empty chats pile up in the list.
  const newChat = () => {
    leaveSidebar();
    router.push('/');
  };
  const rename = async (newTitle: string) => {
    if (!renaming) return;
    try {
      await renameConversation.mutateAsync({ id: renaming.id, title: newTitle });
      setRenaming(null);
      toast.success(t('renamed'));
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  };
  const confirmDelete = (id: string, current: string) =>
    modal.confirm({
      title: t('deleteTitle'),
      content: t('deleteConfirm', { title: current }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteConversation.mutateAsync(id);
          toast.success(t('deleted'));
          if (id === activeId) router.push('/');
        } catch (cause) {
          toast.error((cause as Error).message);
        }
      },
    });

  const filtered = (conversations.data ?? []).filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));
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
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search')}
          prefix={<Search size={16} className="text-fg-tertiary" />}
        />
      </div>
      <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">
        {filtered.map((item) => (
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
              <MessageSquare size={15} className="shrink-0 text-fg-tertiary" />
              <span className="truncate">{item.title}</span>
            </Link>
            <Button
              type="text"
              size="small"
              title={t('rename')}
              aria-label={t('rename')}
              icon={<Pencil size={14} />}
              onClick={() => setRenaming({ id: item.id, title: item.title })}
              className="hidden text-fg-tertiary group-focus-within:inline-flex group-hover:inline-flex pointer-coarse:inline-flex"
            />
            <Button
              type="text"
              size="small"
              title={t('delete')}
              aria-label={t('delete')}
              icon={<Trash2 size={14} />}
              onClick={() => confirmDelete(item.id, item.title)}
              className="hidden text-fg-tertiary group-focus-within:inline-flex group-hover:inline-flex pointer-coarse:inline-flex"
            />
          </div>
        ))}
      </div>
    </>
  );

  const header = (
    <>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold">{title}</h1>
        <p className="hidden truncate text-xs text-fg-secondary sm:block">{t('private')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Select
          aria-label={t('model')}
          className="w-40 sm:w-64 lg:w-96"
          value={modelId || undefined}
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
        <MessageList messages={notFound ? [] : messages}>
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
            <p className="text-center text-[11px] text-fg-secondary">{t('disclaimer')}</p>
          </div>
        </footer>
      </div>
      {renaming && (
        <RenameDialog
          key={renaming.id}
          initialTitle={renaming.title}
          saving={renameConversation.isPending}
          onSave={rename}
          onClose={() => setRenaming(null)}
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
