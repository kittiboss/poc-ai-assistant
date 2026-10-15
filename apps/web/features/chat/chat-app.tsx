'use client';
import { FileDown, FileJson } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { useApi } from '@/lib/api';
import { download } from '@/lib/download';
import type { Conversation, Message, Model } from '@/lib/types';
import { Shell } from '@/components/layout/shell';
import { Badge, Button, Card, Select, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';

export function ChatApp() {
  const api = useApi();
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);
  const sending = useRef(false);
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [active, setActive] = useState<Conversation | null>(null);
  const [models, setModels] = useState<Model[]>([]),
    [modelId, setModelId] = useState('');
  // AuthGate renders this only in the browser, so sessionStorage is available here.
  const [input, setInput] = useState(() => sessionStorage.getItem('chat-draft') || ''),
    [search, setSearch] = useState(''),
    [archived, setArchived] = useState(false);
  const [generating, setGenerating] = useState(false),
    [error, setError] = useState('');
  const aborters = useRef<AbortController[]>([]),
    bottom = useRef<HTMLDivElement>(null);
  const loadSequence = useRef(0);

  async function refreshChats() {
    const seq = ++loadSequence.current;
    const params = new URLSearchParams({ search, archived: String(archived) });
    const list = await api.request<Conversation[]>(`/conversations?${params}`);
    if (seq === loadSequence.current) setConversations(list);
  }
  useEffect(() => {
    sessionStorage.removeItem('chat-draft');
    api
      .request<Model[]>('/models')
      .then((m) => {
        setModels(m);
        setModelId(m.find((x) => x.available)?.id || '');
      })
      .catch((e) => setError(e.message));
    return () => {
      aborters.current.forEach((a) => a.abort());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(() => {
      refreshChats().catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [search, archived]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages]);
  const selectedModel = models.find((m) => m.id === modelId);
  async function guarded(fn: () => Promise<unknown>) {
    try {
      setError('');
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function open(id: string) {
    setMobileNavOpen(false);
    const chat = await api.request<Conversation>(`/conversations/${id}`);
    setActive(chat);
  }
  async function create() {
    return api.request<Conversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
  async function update(conversation: Conversation, data: Record<string, unknown>) {
    await api.request(`/conversations/${conversation.id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (active?.id === conversation.id) setActive({ ...active, ...data });
    await refreshChats();
  }
  async function branch(conversation: Conversation, message: Message, before = false) {
    return api.request<Conversation>(`/conversations/${conversation.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({ messageId: message.id, before }),
    });
  }

  async function stream(
    chat: Conversation,
    prompt: string,
    model: string,
    setter: React.Dispatch<React.SetStateAction<Conversation | null>>,
  ) {
    const assistantId = crypto.randomUUID(),
      aborter = new AbortController();
    aborters.current.push(aborter);
    const messages: Message[] = [
      ...(chat.messages || []),
      {
        id: crypto.randomUUID(),
        role: 'USER',
        content: prompt,
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantId,
        role: 'ASSISTANT',
        content: '',
        status: 'STREAMING',
        modelId: model,
        createdAt: new Date().toISOString(),
      },
    ];
    setter({ ...chat, messages });
    const requestId = crypto.randomUUID();
    const request = (acknowledgeSensitive = false) =>
      fetch(`${api.apiBase}/conversations/${chat.id}/messages`, {
        method: 'POST',
        signal: aborter.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.accessToken}`,
        },
        body: JSON.stringify({
          content: prompt,
          modelId: model,
          requestId,
          acknowledgeSensitive,
        }),
      });
    try {
      let response = await request();
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (
          payload.code === 'SENSITIVE_CONTEXT' &&
          payload.canAcknowledge &&
          window.confirm(`${payload.message}\n\nSend this context to the external model anyway?`)
        )
          response = await request(true);
        else
          throw new Error(
            Array.isArray(payload.message)
              ? payload.message.join(', ')
              : payload.message || `Generation failed (${response.status})`,
          );
      }
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Generation failed (${response.status})`);
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '',
        text = '',
        completed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1],
            raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === 'error') throw new Error(data.message || 'Generation failed');
          if (event === 'done') completed = true;
          if (event === 'token' && data.text) {
            text += data.text;
            setter((current) =>
              current?.id === chat.id
                ? {
                    ...current,
                    messages: current.messages?.map((m) => (m.id === assistantId ? { ...m, content: text } : m)),
                  }
                : current,
            );
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error('Connection ended before completion. Your saved response can be reopened.');
    } finally {
      aborters.current = aborters.current.filter((a) => a !== aborter);
      const saved = await api.request<Conversation>(`/conversations/${chat.id}`).catch(() => null);
      if (saved) setter(saved);
    }
  }
  async function send(prompt = input.trim(), target = active) {
    if (sending.current || generating || !prompt) return;
    if (!selectedModel?.available) return;
    setInput('');
    sending.current = true;
    setError('');
    setGenerating(true);
    try {
      const primary = target || (await create());
      await stream(primary, prompt, modelId, setActive);
      await refreshChats();
    } catch (e) {
      const cause = e as Error;
      setError(cause.name === 'AbortError' ? 'Generation stopped. Partial text is saved.' : cause.message);
      setInput(prompt);
    } finally {
      sending.current = false;
      setGenerating(false);
    }
  }
  async function edit(conversation: Conversation, message: Message) {
    const content = window.prompt('Edit and resend in a new branch', message.content)?.trim();
    if (!content) return;
    const chat = await branch(conversation, message, true);
    setActive(chat);
    await send(content, chat);
  }
  async function regenerate(conversation: Conversation, message: Message) {
    const index = conversation.messages?.findIndex((m) => m.id === message.id) ?? -1;
    const userMessage = conversation.messages
      ?.slice(0, index)
      .reverse()
      .find((m) => m.role === 'USER');
    if (!userMessage) return;
    const chat = await branch(conversation, userMessage, true);
    setActive(chat);
    await send(userMessage.content, chat);
  }
  function exportChat(format: 'md' | 'json') {
    if (!active) return;
    download(
      `conversation.${format}`,
      format === 'json'
        ? JSON.stringify(active, null, 2)
        : `# ${active.title}\n\n${active.messages?.map((m) => `## ${m.role}${m.modelId ? ` (${m.modelId})` : ''}\n\n${m.content}\n\n${m.citations?.map((s) => `[${s.label}] ${s.filename}${s.page ? `, page ${s.page}` : ''}\n> ${s.content.replace(/\n/g, '\n> ')}`).join('\n\n') || ''}`).join('\n\n')}`,
      format === 'json' ? 'application/json' : 'text/markdown',
    );
  }
  const actions = (chat: Conversation, message: Message) => (
    <div className="mt-3 flex flex-wrap gap-1 text-xs">
      <button
        className="rounded-brand-sm px-2 py-1 hover:bg-fill-tertiary"
        onClick={() => guarded(() => navigator.clipboard.writeText(message.content))}
      >
        Copy
      </button>
      <button
        disabled={generating}
        className="rounded-brand-sm px-2 py-1 hover:bg-fill-tertiary"
        onClick={() =>
          guarded(async () => {
            const next = await branch(chat, message);
            setActive(next);
            await refreshChats();
          })
        }
      >
        Branch
      </button>
      {message.role === 'USER' && !message.metadata?.tool ? (
        <button
          disabled={generating}
          className="rounded-brand-sm px-2 py-1 hover:bg-fill-tertiary"
          onClick={() => guarded(() => edit(chat, message))}
        >
          Edit & resend
        </button>
      ) : message.role === 'ASSISTANT' ? (
        <>
          {!message.metadata?.tool && (
            <button
              disabled={generating}
              className="rounded-brand-sm px-2 py-1 hover:bg-fill-tertiary"
              onClick={() => guarded(() => regenerate(chat, message))}
            >
              Regenerate
            </button>
          )}
          {[1, -1].map((rating) => (
            <button
              key={rating}
              disabled={generating}
              aria-label={rating === 1 ? 'Helpful response' : 'Unhelpful response'}
              className={cn(
                'rounded-brand-sm px-2 py-1',
                message.feedback === rating ? 'bg-primary-soft text-primary' : 'hover:bg-fill-tertiary',
              )}
              onClick={() =>
                guarded(async () => {
                  const comment = window.prompt(
                    'Optional feedback shared with administrators (chat text is not shared)',
                    message.feedbackComment || '',
                  );
                  if (comment === null) return;
                  await api.request(`/conversations/${chat.id}/messages/${message.id}/feedback`, {
                    method: 'POST',
                    body: JSON.stringify({ rating, comment }),
                  });
                  const refreshed = await api.request<Conversation>(`/conversations/${chat.id}`);
                  setActive(refreshed);
                })
              }
            >
              {rating === 1 ? '👍' : '👎'}
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
  const sidebar = (
    <>
      <div className="space-y-3 p-3">
        <Button
          disabled={generating}
          className="w-full"
          onClick={() => {
            setMobileNavOpen(false);
            setActive(null);
            setError('');
          }}
        >
          + New chat
        </Button>
        <input
          aria-label="Search conversation content"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles & messages"
          className="h-10 w-full rounded-brand bg-fill-tertiary px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="flex gap-2 text-xs">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn('rounded-brand p-2', active?.id === c.id ? 'bg-primary-soft' : 'hover:bg-fill-quaternary')}
          >
            <button
              disabled={generating}
              className="w-full truncate text-left text-sm"
              onClick={() => guarded(() => open(c.id))}
            >
              {c.pinned ? '★ ' : ''}
              {c.title}
            </button>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-fg-secondary">
              <button disabled={generating} onClick={() => guarded(() => update(c, { pinned: !c.pinned }))}>
                {c.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button disabled={generating} onClick={() => guarded(() => update(c, { archived: !c.archived }))}>
                {c.archived ? 'Restore' : 'Archive'}
              </button>
              <button
                disabled={generating}
                onClick={() => {
                  const title = window.prompt('Conversation name', c.title);
                  if (title?.trim()) void guarded(() => update(c, { title }));
                }}
              >
                Rename
              </button>
              <button
                disabled={generating}
                onClick={() => {
                  if (window.confirm(`Delete “${c.title}”?`))
                    void guarded(async () => {
                      await api.request(`/conversations/${c.id}`, {
                        method: 'DELETE',
                      });
                      if (active?.id === c.id) setActive(null);
                      await refreshChats();
                    });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
  const header = (
    <>
      <h1 className="min-w-0 flex-1 truncate font-semibold">{active?.title || 'New conversation'}</h1>
      <div className="flex shrink-0 items-center gap-2">
        {active && (
          <>
            <button
              title="Export Markdown"
              onClick={() => exportChat('md')}
              className="flex h-9 items-center gap-1 rounded-brand px-2 text-xs text-fg-secondary hover:bg-fill-tertiary"
            >
              <FileDown size={15} />
              <span className="hidden sm:inline">Markdown</span>
            </button>
            <button
              title="Export JSON"
              onClick={() => exportChat('json')}
              className="flex h-9 items-center gap-1 rounded-brand px-2 text-xs text-fg-secondary hover:bg-fill-tertiary"
            >
              <FileJson size={15} />
              <span className="hidden sm:inline">JSON</span>
            </button>
          </>
        )}
        <Select
          aria-label="Chat model"
          className="w-36 sm:w-64 lg:w-auto"
          disabled={generating}
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.displayName} · {m.status}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
  return (
    <Shell active="chat" sidebar={sidebar} header={header}>
      <div className="flex h-full flex-col">
        <section className="flex-1 overflow-auto px-4 py-6 md:p-5">
          {!active?.messages?.length && (
            <div className="py-16 text-center">
              <h2 className="text-2xl font-semibold">How can I help?</h2>
              <p className="mt-3 text-sm text-fg-secondary">Select a model and start a conversation.</p>
            </div>
          )}
          <div className="mx-auto max-w-3xl">
            {active && (
              <div className="min-w-0 space-y-5">
                {active.messages?.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    actions={m.status === 'STREAMING' ? undefined : actions(active, m)}
                  />
                ))}
              </div>
            )}
          </div>
          <div ref={bottom} />
        </section>
        <footer className="shrink-0 bg-gradient-to-t from-layout via-layout px-3 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:px-5">
          <div className="mx-auto max-w-3xl">
            {selectedModel && !selectedModel.local && (
              <p className="mb-2 rounded-brand bg-warning-soft p-3 text-xs text-warning-text">
                External model: conversation context and server-configured context are sent to the selected provider.
                Use non-confidential demo data.
              </p>
            )}
            {error && (
              <p role="alert" className="mb-3 rounded-brand bg-error-soft p-3 text-sm text-error-text">
                {error}
              </p>
            )}
            <Card className="flex items-end gap-2 p-2 shadow-lg">
              <Textarea
                aria-label="Message"
                rows={3}
                maxLength={20000}
                disabled={generating}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message your assistant…"
                className="border-0"
              />
              {generating ? (
                <Button variant="secondary" onClick={() => aborters.current.forEach((a) => a.abort())}>
                  Stop
                </Button>
              ) : (
                <Button onClick={() => send()} disabled={!input.trim() || !selectedModel?.available}>
                  Send
                </Button>
              )}
            </Card>
            <p className="mt-2 text-center text-[11px] text-fg-secondary">
              AI responses may be inaccurate. Verify answers and source excerpts.
            </p>
          </div>
        </footer>
      </div>
    </Shell>
  );
}

function MessageBubble({ message, actions }: { message: Message; actions?: React.ReactNode }) {
  const mine = message.role === 'USER';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[95%] min-w-0 rounded-brand-lg px-4 py-3 text-sm',
          mine ? 'bg-primary text-on-primary' : 'w-full border border-line-secondary bg-surface',
        )}
      >
        {mine ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <>
            <div className="mb-2 flex gap-2 text-xs text-fg-secondary">
              {message.metadata?.tool ? `Local tool: ${message.metadata.tool} · no model call` : message.modelId}
              <Badge>{message.status.toLowerCase()}</Badge>
            </div>
            <div className="prose max-w-none overflow-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {message.content || (message.status === 'STREAMING' ? '…' : '')}
              </ReactMarkdown>
            </div>
            {Boolean(message.citations?.length) && (
              <details className="mt-4 rounded-brand bg-fill-quaternary p-3">
                <summary className="cursor-pointer text-xs font-semibold">
                  Retrieved sources · verify against these excerpts
                </summary>
                {message.citations?.map((s) => (
                  <details key={s.id} className="mt-3">
                    <summary className="cursor-pointer text-xs">
                      [{s.label}] {s.filename}
                      {s.page ? ` · page ${s.page}` : ''}
                    </summary>
                    <p className="mt-2 text-xs whitespace-pre-wrap text-fg-secondary">{s.content}</p>
                  </details>
                ))}
              </details>
            )}
            {message.usage && (
              <p className="mt-3 text-[11px] text-fg-secondary">
                {message.usage.inputTokens} in / {message.usage.outputTokens} out · {message.usage.durationMs} ms ·{' '}
                {message.usage.usageKind} · provider {message.usage.currency}{' '}
                {Number(message.usage.actualProviderCost).toFixed(6)} · charge{' '}
                {Number(message.usage.customerCharge).toFixed(6)}
              </p>
            )}
            {message.metadata?.filename && (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() =>
                  download(message.metadata!.filename!, message.metadata!.content || '', message.metadata!.mime)
                }
              >
                Download {message.metadata.filename}
              </Button>
            )}
          </>
        )}
        {actions}
      </div>
    </div>
  );
}
