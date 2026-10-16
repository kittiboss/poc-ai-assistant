'use client';
import { FileDown, FileJson, LoaderCircle, MessageSquare, Plus, Search, Send, Square } from 'lucide-react';
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
import type { ConversationChange, ConversationDetail, ConversationSummary, Message, Model } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { download } from '@/lib/download';
import { useUIStore } from '@/stores/ui-store-provider';
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
  const [archived, setArchived] = useState(false);
  // Search runs on the server (titles and message content), so it waits for a pause in typing.
  const [searchQuery, setSearchQuery] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const models = useModels();
  const conversations = useConversations({ search: searchQuery, archived });
  const conversation = useConversation(activeId, stream?.conversationId === activeId);
  const updateConversation = useUpdateConversation();
  const deleteConversation = useDeleteConversation();
  const branchConversation = useBranchConversation();
  const feedback = useFeedback();
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
  const update = (id: string, change: ConversationChange) =>
    updateConversation.mutateAsync({ id, change }).catch(reportError);
  const rename = (item: ConversationSummary) => {
    const next = window.prompt(t('renamePrompt'), item.title)?.trim();
    if (next) void update(item.id, { title: next });
  };
  const remove = async (item: ConversationSummary) => {
    if (!window.confirm(t('deleteConfirm', { title: item.title }))) return;
    try {
      await deleteConversation.mutateAsync(item.id);
      if (item.id === activeId) router.push('/');
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
  const edit = (message: Message) => {
    const content = window.prompt(t('editPrompt'), message.content)?.trim();
    if (content) resend(message, content).catch(reportError);
  };
  const regenerate = (message: Message) => {
    const index = messages?.findIndex((item) => item.id === message.id) ?? -1;
    const userMessage = messages
      ?.slice(0, index)
      .reverse()
      .find((item) => item.role === 'USER');
    if (userMessage) resend(userMessage, userMessage.content).catch(reportError);
  };
  const rate = (message: Message, rating: Rating) => {
    if (!activeId) return;
    const comment = window.prompt(t('feedbackPrompt'), message.feedbackComment || '');
    if (comment === null) return;
    feedback.mutateAsync({ conversationId: activeId, messageId: message.id, rating, comment }).catch(reportError);
  };

  const actions = (message: Message) => (
    <div className="mt-3 flex flex-wrap gap-1 text-xs">
      <ActionButton onClick={() => navigator.clipboard.writeText(message.content).catch(reportError)}>
        {t('copyText')}
      </ActionButton>
      <ActionButton disabled={generating} onClick={() => branch(message).catch(reportError)}>
        {t('branch')}
      </ActionButton>
      {message.role === 'USER' && !message.metadata.tool ? (
        <ActionButton disabled={generating} onClick={() => edit(message)}>
          {t('editResend')}
        </ActionButton>
      ) : message.role === 'ASSISTANT' ? (
        <>
          {!message.metadata.tool && (
            <ActionButton disabled={generating} onClick={() => regenerate(message)}>
              {t('regenerate')}
            </ActionButton>
          )}
          {([1, -1] as const).map((rating) => (
            <ActionButton
              key={rating}
              disabled={generating}
              aria-label={rating === 1 ? t('helpful') : t('unhelpful')}
              className={message.feedback === rating ? 'bg-primary-soft text-primary' : undefined}
              onClick={() => rate(message, rating)}
            >
              {rating === 1 ? '👍' : '👎'}
            </ActionButton>
          ))}
        </>
      ) : null}
    </div>
  );

  const sidebar = (
    <>
      <div className="space-y-3 p-3">
        <Button className="w-full" onClick={newChat}>
          <Plus size={17} /> {t('newChat')}
        </Button>
        <div className="relative">
          <Search className="absolute top-2.5 left-3 text-fg-tertiary" size={16} />
          <input
            aria-label={t('searchLabel')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('searchContent')}
            className="h-10 w-full rounded-brand bg-fill-tertiary pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <label className="flex gap-2 text-xs">
          <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />{' '}
          {t('showArchived')}
        </label>
      </div>
      <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">
        {conversations.data?.map((item) => (
          <div
            key={item.id}
            className={cn('rounded-brand p-2', activeId === item.id ? 'bg-primary-soft' : 'hover:bg-fill-quaternary')}
          >
            <Link href={`/c/${item.id}`} onClick={leaveSidebar} className="block truncate text-sm">
              {item.pinned ? '★ ' : ''}
              {item.title}
            </Link>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-fg-secondary">
              <button onClick={() => update(item.id, { pinned: !item.pinned })}>
                {item.pinned ? t('unpin') : t('pin')}
              </button>
              <button onClick={() => update(item.id, { archived: !item.archived })}>
                {item.archived ? t('restore') : t('archive')}
              </button>
              <button onClick={() => rename(item)}>{t('rename')}</button>
              <button onClick={() => remove(item)}>{t('delete')}</button>
            </div>
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
      <div className="flex shrink-0 items-center gap-2">
        {conversation.data && (
          <>
            <button
              title={t('exportMarkdown')}
              onClick={() => exportChat(conversation.data, 'md')}
              className="flex h-9 items-center gap-1 rounded-brand px-2 text-xs text-fg-secondary hover:bg-fill-tertiary"
            >
              <FileDown size={15} />
              <span className="hidden sm:inline">Markdown</span>
            </button>
            <button
              title={t('exportJson')}
              onClick={() => exportChat(conversation.data, 'json')}
              className="flex h-9 items-center gap-1 rounded-brand px-2 text-xs text-fg-secondary hover:bg-fill-tertiary"
            >
              <FileJson size={15} />
              <span className="hidden sm:inline">JSON</span>
            </button>
          </>
        )}
        <Select
          aria-label={t('chatModel')}
          className="w-36 sm:w-64 lg:w-auto"
          disabled={generating}
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
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-6 md:py-10">
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
                  <MessageBubble
                    key={message.id}
                    message={message}
                    actions={message.status === 'STREAMING' ? undefined : actions(message)}
                  />
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
            {error && (
              <div role="alert" className="mb-2 rounded-brand bg-error-soft px-3 py-2 text-sm text-error-text">
                {error}
              </div>
            )}
            <Card className="flex items-end gap-2 p-2 shadow-lg">
              <Textarea
                aria-label={t('messageLabel')}
                rows={1}
                maxLength={20000}
                value={input}
                disabled={generating || notFound}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
            <p className="mt-2 text-center text-[11px] text-fg-secondary">{t('disclaimerSources')}</p>
          </div>
        </footer>
      </div>
    </Shell>
  );
}

function exportChat(chat: ConversationDetail, format: 'md' | 'json') {
  if (format === 'json') return download('conversation.json', JSON.stringify(chat, null, 2), 'application/json');
  const sources = (message: Message) =>
    message.citations
      .map(
        (source) =>
          `[${source.label}] ${source.filename}${source.page ? `, page ${source.page}` : ''}\n> ${source.content.replace(/\n/g, '\n> ')}`,
      )
      .join('\n\n');
  const body = chat.messages
    .map(
      (message) =>
        `## ${message.role}${message.modelId ? ` (${message.modelId})` : ''}\n\n${message.content}\n\n${sources(message)}`,
    )
    .join('\n\n');
  download('conversation.md', `# ${chat.title}\n\n${body}`, 'text/markdown');
}

function ActionButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn('rounded-brand-sm px-2 py-1 hover:bg-fill-tertiary disabled:opacity-50', className)}
    />
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

function MessageBubble({ message, actions }: { message: Message; actions?: React.ReactNode }) {
  const t = useTranslations('chat');
  const enums = useEnumLabel();
  const mine = message.role === 'USER';
  const { tool, filename } = message.metadata;
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[95%] min-w-0 rounded-brand-lg px-4 py-3 text-sm leading-6',
          mine ? 'bg-primary text-on-primary' : 'w-full border border-line-secondary bg-surface',
        )}
      >
        {mine ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 text-xs text-fg-secondary">
              {message.status === 'STREAMING' && <LoaderCircle className="animate-spin" size={11} />}
              {tool ? t('localTool', { tool }) : message.modelId}
              <Badge tone={message.status === 'ERROR' ? 'error' : 'neutral'}>
                {enums.label('messageStatus', message.status)}
              </Badge>
            </div>
            <div className="prose max-w-none overflow-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {message.content || (message.status === 'STREAMING' ? '…' : '')}
              </ReactMarkdown>
            </div>
            {message.citations.length > 0 && (
              <details className="mt-4 rounded-brand bg-fill-quaternary p-3">
                <summary className="cursor-pointer text-xs font-semibold">{t('sources')}</summary>
                {message.citations.map((source) => (
                  <details key={source.id} className="mt-3">
                    <summary className="cursor-pointer text-xs">
                      [{source.label}] {source.filename}
                      {source.page ? ` · ${t('sourcePage', { page: source.page })}` : ''}
                    </summary>
                    <p className="mt-2 text-xs whitespace-pre-wrap text-fg-secondary">{source.content}</p>
                  </details>
                ))}
              </details>
            )}
            {message.usage && (
              <p className="mt-3 text-[11px] text-fg-secondary">
                {t('usageLine', {
                  input: message.usage.inputTokens,
                  output: message.usage.outputTokens,
                  duration: message.usage.durationMs,
                  kind: enums.label('usageKind', message.usage.usageKind),
                  currency: message.usage.currency,
                  cost: Number(message.usage.actualProviderCost).toFixed(6),
                  charge: Number(message.usage.customerCharge).toFixed(6),
                })}
              </p>
            )}
            {filename && (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => download(filename, message.metadata.content || '', message.metadata.mime)}
              >
                {t('downloadFile', { filename })}
              </Button>
            )}
          </>
        )}
        {actions}
      </div>
    </div>
  );
}
