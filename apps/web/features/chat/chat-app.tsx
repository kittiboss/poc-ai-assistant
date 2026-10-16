'use client';
import { Check, Copy, LoaderCircle, MessageSquare, Pencil, Plus, Search, Send, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Shell } from '@/components/layout/shell';
import { Badge, Button, Card, Select, Textarea } from '@/components/ui/primitives';
import { useEnumLabel } from '@/i18n/use-enum-label';
import { ApiError } from '@/lib/api/client';
import type { Message, Model } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';
import {
  isConversationId,
  useConversation,
  useConversations,
  useDeleteConversation,
  useModels,
  useRenameConversation,
} from './chat-queries';
import { useSendMessage } from './use-send-message';

/** `/` is a new chat and `/c/<id>` an existing one; the id comes from the URL. */
export function ChatApp() {
  const { id: activeId } = useParams<{ id?: string }>();
  const router = useRouter();
  const t = useTranslations('chat');
  const enums = useEnumLabel();
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);
  const selectedModelId = useUIStore((state) => state.selectedModelId);
  const setSelectedModelId = useUIStore((state) => state.setSelectedModelId);
  const search = useUIStore((state) => state.conversationSearch);
  const setSearch = useUIStore((state) => state.setConversationSearch);
  const stream = useUIStore((state) => state.stream);
  const chatError = useUIStore((state) => state.chatError);
  const setChatError = useUIStore((state) => state.setChatError);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const models = useModels();
  const conversations = useConversations();
  const conversation = useConversation(activeId, stream?.conversationId === activeId);
  const renameConversation = useRenameConversation();
  const deleteConversation = useDeleteConversation();
  const send = useSendMessage();

  const messages = conversation.data?.messages;
  // Braces matter: scroll methods return a Promise in current browsers, and React would treat it as the effect cleanup.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const reportError = (cause: unknown) => setChatError((cause as Error).message);
  const leaveSidebar = () => {
    setMobileNavOpen(false);
    setChatError('');
  };
  // The chat itself is created with the first message, so no empty chats pile up in the list.
  const newChat = () => {
    leaveSidebar();
    router.push('/');
  };
  const rename = (id: string, current: string) => {
    const next = window.prompt(t('renamePrompt'), current)?.trim();
    if (!next) return;
    renameConversation.mutateAsync({ id, title: next }).catch(reportError);
  };
  const remove = async (id: string, current: string) => {
    if (!window.confirm(t('deleteConfirm', { title: current }))) return;
    try {
      await deleteConversation.mutateAsync(id);
      if (id === activeId) router.push('/');
    } catch (cause) {
      reportError(cause);
    }
  };
  const submit = () => {
    const prompt = input.trim();
    if (!prompt || generating || !modelId) return;
    setInput('');
    void send({ conversationId: activeId, prompt, modelId });
  };

  const filtered = (conversations.data ?? []).filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));
  const sidebar = (
    <>
      <div className="space-y-3 p-3">
        <Button className="w-full" onClick={newChat}>
          <Plus size={17} /> {t('newChat')}
        </Button>
        <div className="relative">
          <Search className="absolute top-2.5 left-3 text-fg-tertiary" size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('search')}
            className="h-10 w-full rounded-brand bg-fill-tertiary pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
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
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
            >
              <MessageSquare size={15} className="shrink-0 text-fg-tertiary" />
              <span className="truncate">{item.title}</span>
            </Link>
            <button
              title={t('rename')}
              onClick={() => rename(item.id, item.title)}
              className="hidden p-1 text-fg-tertiary group-focus-within:block group-hover:block hover:text-primary pointer-coarse:block"
            >
              <Pencil size={14} />
            </button>
            <button
              title={t('delete')}
              onClick={() => remove(item.id, item.title)}
              className="hidden p-1 text-fg-tertiary group-focus-within:block group-hover:block hover:text-error pointer-coarse:block"
            >
              <Trash2 size={14} />
            </button>
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
          className="w-40 sm:w-64 lg:w-auto"
          value={modelId}
          onChange={(event) => setSelectedModelId(event.target.value)}
        >
          {modelList.map((model) => (
            <option key={model.id} value={model.id} disabled={!model.available}>
              {t('modelOption', {
                name: model.displayName,
                provider: model.provider,
                location: model.local ? t('modelLocal') : t('modelExternal'),
                status: enums.modelStatus(model.status),
              })}
            </option>
          ))}
        </Select>
        {selectedModel && (
          <Badge className="hidden xl:inline-flex" tone={selectedModel.available ? 'success' : 'error'}>
            {t('modelBadge', {
              location: enums.label('location', selectedModel.local ? 'LOCAL' : 'EXTERNAL'),
              status: enums.modelStatus(selectedModel.status),
            })}
          </Badge>
        )}
      </div>
    </>
  );

  return (
    <Shell active="chat" sidebar={sidebar} header={header}>
      <div className="flex h-full flex-col">
        <section className="flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl space-y-7 px-4 py-6 md:px-6 md:py-10">
            {notFound ? (
              <NotFound />
            ) : activeId && conversation.isPending ? (
              <div className="grid place-items-center py-20">
                <LoaderCircle className="animate-spin text-primary" />
              </div>
            ) : activeId && conversation.isError ? null : (
              <>
                {!messages?.length && <EmptyState models={modelList} />}
                {messages?.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        </section>
        <footer className="shrink-0 bg-linear-to-t from-layout via-layout px-3 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:px-5">
          <div className="mx-auto max-w-3xl">
            {selectedModel && !selectedModel.local && (
              <div className="mb-2 rounded-brand bg-warning-soft px-3 py-2 text-xs text-warning-text">
                {t('externalNotice', { provider: selectedModel.provider })}
              </div>
            )}
            {error && <div className="mb-2 rounded-brand bg-error-soft px-3 py-2 text-sm text-error-text">{error}</div>}
            <Card className="flex items-end gap-2 p-2 shadow-lg">
              <Textarea
                rows={1}
                value={input}
                disabled={generating || notFound}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={t('placeholder')}
                className="max-h-40 min-h-11 border-0 shadow-none focus:ring-0"
              />
              {generating ? (
                <Button
                  variant="secondary"
                  className="h-11 w-11 shrink-0 px-0"
                  onClick={() => stream?.abort.abort()}
                  title={t('stop')}
                >
                  <Square size={16} />
                </Button>
              ) : (
                <Button
                  className="h-11 w-11 shrink-0 px-0"
                  onClick={submit}
                  disabled={!input.trim() || !selectedModel?.available || notFound}
                  title={t('send')}
                >
                  <Send size={17} />
                </Button>
              )}
            </Card>
            <p className="mt-2 text-center text-[11px] text-fg-secondary">{t('disclaimer')}</p>
          </div>
        </footer>
      </div>
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
function MessageBubble({ message }: { message: Message }) {
  const t = useTranslations('chat');
  const enums = useEnumLabel();
  const [copied, setCopied] = useState(false);
  const mine = message.role === 'USER';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'group relative max-w-[86%] rounded-brand-lg px-4 py-3 text-sm leading-6',
          mine ? 'bg-primary text-on-primary' : 'border border-line-secondary bg-surface',
        )}
      >
        {mine ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="prose max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {message.content || (message.status === 'STREAMING' ? '…' : '')}
            </ReactMarkdown>
          </div>
        )}
        {!mine && message.content && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="absolute top-1 -right-9 hidden rounded-brand-sm p-2 text-fg-tertiary group-focus-within:block group-hover:block hover:bg-fill-tertiary pointer-coarse:block"
            title={t('copy')}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
        {message.status !== 'COMPLETED' && (
          <div
            className={cn(
              'mt-2 flex items-center gap-1 text-[11px]',
              mine ? 'text-on-primary/70' : message.status === 'ERROR' ? 'text-error' : 'text-fg-tertiary',
            )}
          >
            {message.status === 'STREAMING' && <LoaderCircle className="animate-spin" size={11} />}{' '}
            {enums.label('messageStatus', message.status)}
          </div>
        )}
      </div>
    </div>
  );
}
