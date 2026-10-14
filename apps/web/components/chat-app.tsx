'use client';
import { Check, Copy, LoaderCircle, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Send, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { useApi } from '../lib/api';
import type { Conversation, Message, Model } from '../lib/types';
import { Shell } from './shell';
import { Badge, Button, Card, Select, Textarea, cn } from './ui';

export function ChatApp() {
  const api = useApi();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => setConversations(await api.request<Conversation[]>('/conversations')), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    Promise.all([api.request<Model[]>('/models'), api.request<Conversation[]>('/conversations')]).then(([nextModels, nextConversations]) => {
      setModels(nextModels); setConversations(nextConversations);
      setModelId(nextModels.find((model) => model.available)?.id || nextModels[0]?.id || '');
    }).catch((cause) => setError(cause.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [active?.messages]);

  const open = async (id: string) => {
    try { setError(''); setActive(await api.request<Conversation>(`/conversations/${id}`)); } catch (cause) { setError((cause as Error).message); }
  };
  const create = async () => {
    try { const conversation = await api.request<Conversation>('/conversations', { method: 'POST', body: '{}' }); setConversations((items) => [conversation, ...items]); setActive({ ...conversation, messages: [] }); } catch (cause) { setError((cause as Error).message); }
  };
  const rename = async (conversation: Conversation) => {
    const title = window.prompt('Conversation name', conversation.title)?.trim();
    if (!title) return;
    const updated = await api.request<Conversation>(`/conversations/${conversation.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    setConversations((items) => items.map((item) => item.id === updated.id ? { ...item, title: updated.title } : item));
    if (active?.id === updated.id) setActive((value) => value ? { ...value, title: updated.title } : value);
  };
  const remove = async (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
    await api.request(`/conversations/${conversation.id}`, { method: 'DELETE' });
    setConversations((items) => items.filter((item) => item.id !== conversation.id));
    if (active?.id === conversation.id) setActive(null);
  };

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || generating || !modelId) return;
    setInput(''); setError(''); setGenerating(true);
    let conversation = active;
    try {
      if (!conversation) {
        conversation = await api.request<Conversation>('/conversations', { method: 'POST', body: '{}' });
        setConversations((items) => [conversation!, ...items]);
      }
      const userMessage: Message = { id: crypto.randomUUID(), role: 'USER', content: prompt, status: 'COMPLETED', createdAt: new Date().toISOString() };
      const assistantId = crypto.randomUUID();
      const assistant: Message = { id: assistantId, role: 'ASSISTANT', content: '', status: 'STREAMING', modelId, createdAt: new Date().toISOString() };
      const optimistic = { ...conversation, messages: [...(conversation.messages || []), userMessage, assistant] };
      setActive(optimistic);
      abortRef.current = new AbortController();
      const response = await fetch(`${api.apiBase}/conversations/${conversation.id}/messages`, {
        method: 'POST', signal: abortRef.current.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.accessToken}` },
        body: JSON.stringify({ content: prompt, modelId, requestId: crypto.randomUUID() }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message || `Generation failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1];
          const raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw) as { text?: string; message?: string };
          if (event === 'token' && data.text) {
            assistantText += data.text;
            setActive((current) => current ? { ...current, messages: current.messages?.map((message) => message.id === assistantId ? { ...message, content: assistantText } : message) } : current);
          }
          if (event === 'error') throw new Error(data.message || 'Generation failed');
        }
        if (done) break;
      }
      setActive((current) => current ? { ...current, messages: current.messages?.map((message) => message.id === assistantId ? { ...message, status: 'COMPLETED' } : message) } : current);
      await loadConversations();
    } catch (cause) {
      const aborted = (cause as Error).name === 'AbortError';
      setError(aborted ? 'Generation stopped. The partial response was preserved.' : (cause as Error).message);
      setActive((current) => current ? { ...current, messages: current.messages?.map((message) => message.status === 'STREAMING' ? { ...message, status: aborted ? 'INTERRUPTED' : 'ERROR' } : message) } : current);
    } finally { setGenerating(false); abortRef.current = null; }
  };

  const filtered = useMemo(() => conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())), [conversations, search]);
  const selectedModel = models.find((model) => model.id === modelId);
  const sidebar = <>
    <div className="space-y-3 p-3"><Button className="w-full" onClick={create}><Plus size={17}/> New chat</Button><div className="relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className="h-10 w-full rounded-xl bg-slate-100 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30 dark:bg-slate-900"/></div></div>
    <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">{filtered.map((conversation) => <div key={conversation.id} className={cn('group flex items-center rounded-xl pr-1', active?.id === conversation.id ? 'bg-violet-50 dark:bg-violet-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-900')}><button onClick={() => open(conversation.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"><MessageSquare size={15} className="shrink-0 text-slate-400"/><span className="truncate">{conversation.title}</span></button><button title="Rename" onClick={() => rename(conversation)} className="hidden p-1 text-slate-400 hover:text-brand group-hover:block"><Pencil size={14}/></button><button title="Delete" onClick={() => remove(conversation)} className="hidden p-1 text-slate-400 hover:text-red-600 group-hover:block"><Trash2 size={14}/></button></div>)}</div>
  </>;

  return <Shell active="chat" sidebar={sidebar}><div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-950"><div><h1 className="font-semibold">{active?.title || 'New conversation'}</h1><p className="text-xs text-slate-500">Private to your company account</p></div><div className="flex items-center gap-3"><Select value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id} disabled={!model.available}>{model.displayName} · {model.provider} · {model.local ? '$0 external API' : 'external pricing'} · {model.status}</option>)}</Select>{selectedModel && <Badge tone={selectedModel.available ? 'green' : 'red'}>{selectedModel.local ? 'LOCAL' : 'EXTERNAL'} · {selectedModel.status}</Badge>}</div></header>
    <section className="flex-1 overflow-auto"><div className="mx-auto max-w-3xl space-y-7 px-6 py-10">{!active?.messages?.length && <EmptyState models={models}/>} {active?.messages?.map((message) => <MessageBubble key={message.id} message={message}/>)}<div ref={bottomRef}/></div></section>
    <footer className="shrink-0 bg-gradient-to-t from-[#f7f8fc] via-[#f7f8fc] p-5 pt-2 dark:from-[#0d1017] dark:via-[#0d1017]"><div className="mx-auto max-w-3xl">{error && <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300">{error}</div>}<Card className="flex items-end gap-2 p-2 shadow-lg"><Textarea rows={1} value={input} disabled={generating} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Message your enterprise assistant…" className="max-h-40 min-h-11 border-0 shadow-none focus:ring-0"/>{generating ? <Button variant="secondary" className="h-11 w-11 shrink-0 px-0" onClick={() => abortRef.current?.abort()} title="Stop generation"><Square size={16}/></Button> : <Button className="h-11 w-11 shrink-0 px-0" onClick={send} disabled={!input.trim() || !selectedModel?.available} title="Send"><Send size={17}/></Button>}</Card><p className="mt-2 text-center text-[11px] text-slate-500">AI responses may be inaccurate. Local inference still uses compute, memory, disk, and electricity.</p></div></footer>
  </div></Shell>;
}

function EmptyState({ models }: { models: Model[] }) { return <div className="py-20 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-brand dark:bg-violet-950"><MessageSquare/></div><h2 className="mt-5 text-2xl font-semibold">How can I help?</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Choose an available model and start a private conversation. {models.filter((model) => model.available).length} model(s) available.</p></div>; }
function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const mine = message.role === 'USER';
  return <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}><div className={cn('group relative max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6', mine ? 'bg-brand text-white' : 'border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900')}>
    {mine ? <div className="whitespace-pre-wrap">{message.content}</div> : <div className="prose max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{message.content || (message.status === 'STREAMING' ? '…' : '')}</ReactMarkdown></div>}
    {!mine && message.content && <button onClick={() => { navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="absolute -right-9 top-1 hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 group-hover:block dark:hover:bg-slate-800" title="Copy response">{copied ? <Check size={15}/> : <Copy size={15}/>}</button>}
    {message.status !== 'COMPLETED' && <div className={cn('mt-2 flex items-center gap-1 text-[11px]', mine ? 'text-white/70' : message.status === 'ERROR' ? 'text-red-500' : 'text-slate-400')}>{message.status === 'STREAMING' && <LoaderCircle className="animate-spin" size={11}/>} {message.status.toLowerCase()}</div>}
  </div></div>;
}

