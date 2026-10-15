"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useApi } from "../../lib/api";
import { download } from "../../lib/download";
import type {
  Conversation,
  KnowledgeStatus,
  Message,
  Model,
} from "../../lib/types";
import { Shell } from "../../components/layout/shell";
import {
  Badge,
  Button,
  Card,
  Select,
  Textarea,
  cn,
} from "../../components/ui/primitives";

export function ChatApp() {
  const api = useApi();
  const sending = useRef(false);
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [active, setActive] = useState<Conversation | null>(null);
  const [models, setModels] = useState<Model[]>([]),
    [modelId, setModelId] = useState("");
  const [input, setInput] = useState(""),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const [generating, setGenerating] = useState(false),
    [error, setError] = useState("");
  const [catalog, setCatalog] = useState<KnowledgeStatus | null>(null),
    [useCatalog, setUseCatalog] = useState(true);
  const catalogOn = useCatalog && Boolean(catalog?.available);
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
    const draft = sessionStorage.getItem("chat-draft");
    if (draft) {
      setInput(draft);
      sessionStorage.removeItem("chat-draft");
    }
    api
      .request<Model[]>("/models")
      .then((m) => {
        setModels(m);
        setModelId(m.find((x) => x.available)?.id || "");
      })
      .catch((e) => setError(e.message));
    // The catalog is optional; chat works without it, so a failed status check is not an error.
    api
      .request<KnowledgeStatus>("/knowledge/status")
      .then(setCatalog)
      .catch(() => setCatalog(null));
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
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages]);
  const selectedModel = models.find((m) => m.id === modelId);
  async function guarded(fn: () => Promise<unknown>) {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function open(id: string) {
    const chat = await api.request<Conversation>(`/conversations/${id}`);
    setActive(chat);
  }
  async function create() {
    return api.request<Conversation>("/conversations", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
  async function update(
    conversation: Conversation,
    data: Record<string, unknown>,
  ) {
    await api.request(`/conversations/${conversation.id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (active?.id === conversation.id) setActive({ ...active, ...data });
    await refreshChats();
  }
  async function branch(
    conversation: Conversation,
    message: Message,
    before = false,
  ) {
    return api.request<Conversation>(
      `/conversations/${conversation.id}/branch`,
      {
        method: "POST",
        body: JSON.stringify({ messageId: message.id, before }),
      },
    );
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
        role: "USER",
        content: prompt,
        status: "COMPLETED",
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantId,
        role: "ASSISTANT",
        content: "",
        status: "STREAMING",
        modelId: model,
        createdAt: new Date().toISOString(),
      },
    ];
    setter({ ...chat, messages });
    const requestId = crypto.randomUUID();
    const request = (acknowledgeSensitive = false) =>
      fetch(`${api.apiBase}/conversations/${chat.id}/messages`, {
        method: "POST",
        signal: aborter.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${api.accessToken}`,
        },
        body: JSON.stringify({
          content: prompt,
          modelId: model,
          requestId,
          acknowledgeSensitive,
          useProductCatalog: catalogOn,
        }),
      });
    try {
      let response = await request();
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (
          payload.code === "SENSITIVE_CONTEXT" &&
          payload.canAcknowledge &&
          window.confirm(
            `${payload.message}\n\nSend this context to the external model anyway?`,
          )
        )
          response = await request(true);
        else
          throw new Error(
            Array.isArray(payload.message)
              ? payload.message.join(", ")
              : payload.message || `Generation failed (${response.status})`,
          );
      }
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.message || `Generation failed (${response.status})`,
        );
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        text = "",
        completed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1],
            raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === "error")
            throw new Error(data.message || "Generation failed");
          if (event === "done") completed = true;
          if (event === "token" && data.text) {
            text += data.text;
            setter((current) =>
              current?.id === chat.id
                ? {
                    ...current,
                    messages: current.messages?.map((m) =>
                      m.id === assistantId ? { ...m, content: text } : m,
                    ),
                  }
                : current,
            );
          }
        }
        if (done) break;
      }
      if (!completed)
        throw new Error(
          "Connection ended before completion. Your saved response can be reopened.",
        );
    } finally {
      aborters.current = aborters.current.filter((a) => a !== aborter);
      const saved = await api
        .request<Conversation>(`/conversations/${chat.id}`)
        .catch(() => null);
      if (saved) setter(saved);
    }
  }
  async function send(prompt = input.trim(), target = active) {
    if (sending.current || generating || !prompt) return;
    if (!selectedModel?.available) return;
    setInput("");
    sending.current = true;
    setError("");
    setGenerating(true);
    try {
      const primary = target || (await create());
      await stream(primary, prompt, modelId, setActive);
      await refreshChats();
    } catch (e) {
      const cause = e as Error;
      setError(
        cause.name === "AbortError"
          ? "Generation stopped. Partial text is saved."
          : cause.message,
      );
      setInput(prompt);
    } finally {
      sending.current = false;
      setGenerating(false);
    }
  }
  async function edit(conversation: Conversation, message: Message) {
    const content = window
      .prompt("Edit and resend in a new branch", message.content)
      ?.trim();
    if (!content) return;
    const chat = await branch(conversation, message, true);
    setActive(chat);
    await send(content, chat);
  }
  async function regenerate(conversation: Conversation, message: Message) {
    const index =
      conversation.messages?.findIndex((m) => m.id === message.id) ?? -1;
    const userMessage = conversation.messages
      ?.slice(0, index)
      .reverse()
      .find((m) => m.role === "USER");
    if (!userMessage) return;
    const chat = await branch(conversation, userMessage, true);
    setActive(chat);
    await send(userMessage.content, chat);
  }
  function exportChat(format: "md" | "json") {
    if (!active) return;
    download(
      `conversation.${format}`,
      format === "json"
        ? JSON.stringify(active, null, 2)
        : `# ${active.title}\n\n${active.messages?.map((m) => `## ${m.role}${m.modelId ? ` (${m.modelId})` : ""}\n\n${m.content}\n\n${m.citations?.map((s) => `[${s.label}] ${s.filename}${s.page ? `, page ${s.page}` : ""}\n> ${s.content.replace(/\n/g, "\n> ")}`).join("\n\n") || ""}`).join("\n\n")}`,
      format === "json" ? "application/json" : "text/markdown",
    );
  }
  const actions = (chat: Conversation, message: Message) => (
    <div className="mt-3 flex flex-wrap gap-1 text-xs">
      <button
        className="rounded px-2 py-1 hover:bg-slate-200/30"
        onClick={() =>
          guarded(() => navigator.clipboard.writeText(message.content))
        }
      >
        Copy
      </button>
      <button
        disabled={generating}
        className="rounded px-2 py-1 hover:bg-slate-200/30"
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
      {message.role === "USER" && !message.metadata?.tool ? (
        <button
          disabled={generating}
          className="rounded px-2 py-1 hover:bg-slate-200/30"
          onClick={() => guarded(() => edit(chat, message))}
        >
          Edit & resend
        </button>
      ) : message.role === "ASSISTANT" ? (
        <>
          {!message.metadata?.tool && (
            <button
              disabled={generating}
              className="rounded px-2 py-1 hover:bg-slate-200/30"
              onClick={() => guarded(() => regenerate(chat, message))}
            >
              Regenerate
            </button>
          )}
          {[1, -1].map((rating) => (
            <button
              key={rating}
              disabled={generating}
              aria-label={
                rating === 1 ? "Helpful response" : "Unhelpful response"
              }
              className={`rounded px-2 py-1 ${message.feedback === rating ? "bg-violet-200 text-violet-900" : "hover:bg-slate-200/30"}`}
              onClick={() =>
                guarded(async () => {
                  const comment = window.prompt(
                    "Optional feedback shared with administrators (chat text is not shared)",
                    message.feedbackComment || "",
                  );
                  if (comment === null) return;
                  await api.request(
                    `/conversations/${chat.id}/messages/${message.id}/feedback`,
                    {
                      method: "POST",
                      body: JSON.stringify({ rating, comment }),
                    },
                  );
                  const refreshed = await api.request<Conversation>(
                    `/conversations/${chat.id}`,
                  );
                  setActive(refreshed);
                })
              }
            >
              {rating === 1 ? "👍" : "👎"}
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
            setActive(null);
            setError("");
          }}
        >
          + New chat
        </Button>
        <input
          aria-label="Search conversation content"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles & messages"
          className="h-10 w-full rounded-xl bg-slate-100 px-3 text-sm dark:bg-slate-900"
        />
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Show archived
        </label>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "rounded-xl p-2",
              active?.id === c.id
                ? "bg-violet-50 dark:bg-violet-950"
                : "hover:bg-slate-100 dark:hover:bg-slate-900",
            )}
          >
            <button
              disabled={generating}
              className="w-full truncate text-left text-sm"
              onClick={() => guarded(() => open(c.id))}
            >
              {c.pinned ? "★ " : ""}
              {c.title}
            </button>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
              <button
                disabled={generating}
                onClick={() => guarded(() => update(c, { pinned: !c.pinned }))}
              >
                {c.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                disabled={generating}
                onClick={() =>
                  guarded(() => update(c, { archived: !c.archived }))
                }
              >
                {c.archived ? "Restore" : "Archive"}
              </button>
              <button
                disabled={generating}
                onClick={() => {
                  const title = window.prompt("Conversation name", c.title);
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
                        method: "DELETE",
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
  return (
    <Shell active="chat" sidebar={sidebar}>
      <div className="flex h-full flex-col">
        <header className="space-y-3 border-b bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-semibold">
              {active?.title || "New conversation"}
            </h1>
            {active && (
              <div className="flex gap-3 text-xs">
                <button onClick={() => exportChat("md")}>
                  Export Markdown
                </button>
                <button onClick={() => exportChat("json")}>Export JSON</button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="Chat model"
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
            <label
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 text-sm dark:border-slate-700",
                !catalog?.available && "opacity-60",
              )}
              title={
                catalog?.available
                  ? `Retrieve matching products from ${catalog.indexed} indexed catalog entries`
                  : `Product catalog unavailable${catalog?.problem ? `: ${catalog.problem}` : ""}`
              }
            >
              <input
                type="checkbox"
                aria-label="Product catalog"
                disabled={generating || !catalog?.available}
                checked={catalogOn}
                onChange={(e) => setUseCatalog(e.target.checked)}
              />
              Product catalog
            </label>
          </div>
        </header>
        <section className="flex-1 overflow-auto p-5">
          {!active?.messages?.length && (
            <div className="py-16 text-center">
              <h2 className="text-2xl font-semibold">How can I help?</h2>
              <p className="mt-3 text-sm text-slate-500">
                Select a model and start a conversation.
              </p>
            </div>
          )}
          <div className="mx-auto max-w-3xl">
            {active && (
              <div className="min-w-0 space-y-5">
                {active.messages?.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    actions={
                      m.status === "STREAMING" ? undefined : actions(active, m)
                    }
                  />
                ))}
              </div>
            )}
          </div>
          <div ref={bottom} />
        </section>
        <footer className="border-t bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto max-w-3xl">
            {catalogOn && catalog?.embeddingModel.local === false && (
              <p className="mb-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Product catalog search sends your message to{" "}
                {catalog.embeddingModel.provider} (
                {catalog.embeddingModel.displayName}) to find matching products.
              </p>
            )}
            {selectedModel && !selectedModel.local && (
              <p className="mb-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                External model: conversation context and server-configured
                context are sent to the selected provider. Use non-confidential
                demo data.
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <Card className="flex items-end gap-2 p-2">
              <Textarea
                aria-label="Message"
                rows={3}
                maxLength={20000}
                disabled={generating}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message your assistant…"
                className="border-0"
              />
              {generating ? (
                <Button
                  variant="secondary"
                  onClick={() => aborters.current.forEach((a) => a.abort())}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  onClick={() => send()}
                  disabled={!input.trim() || !selectedModel?.available}
                >
                  Send
                </Button>
              )}
            </Card>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              AI responses may be inaccurate. Verify answers and source
              excerpts.
            </p>
          </div>
        </footer>
      </div>
    </Shell>
  );
}

function MessageBubble({
  message,
  actions,
}: {
  message: Message;
  actions?: React.ReactNode;
}) {
  const mine = message.role === "USER";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[95%] rounded-2xl px-4 py-3 text-sm",
          mine
            ? "bg-brand text-white"
            : "w-full border bg-white dark:border-slate-800 dark:bg-slate-900",
        )}
      >
        {mine ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <>
            <div className="mb-2 flex gap-2 text-xs text-slate-500">
              {message.metadata?.tool
                ? `Local tool: ${message.metadata.tool} · no model call`
                : message.modelId}
              <Badge>{message.status.toLowerCase()}</Badge>
            </div>
            <div className="prose max-w-none overflow-auto dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {message.content || (message.status === "STREAMING" ? "…" : "")}
              </ReactMarkdown>
            </div>
            {Boolean(message.citations?.length) && (
              <details className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
                <summary className="cursor-pointer text-xs font-semibold">
                  Retrieved sources · verify against these excerpts
                </summary>
                {message.citations?.map((s) => (
                  <details key={s.id} className="mt-3">
                    <summary className="cursor-pointer text-xs">
                      [{s.label}] {s.filename}
                      {s.page ? ` · page ${s.page}` : ""}
                      {s.kind === "product" && s.score !== undefined
                        ? ` · product match ${s.score.toFixed(2)}`
                        : ""}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">
                      {s.content}
                    </p>
                  </details>
                ))}
              </details>
            )}
            {message.usage && (
              <p className="mt-3 text-[11px] text-slate-500">
                {message.usage.inputTokens} in / {message.usage.outputTokens}{" "}
                out · {message.usage.durationMs} ms · {message.usage.usageKind}{" "}
                · provider {message.usage.currency}{" "}
                {Number(message.usage.actualProviderCost).toFixed(6)} · charge{" "}
                {Number(message.usage.customerCharge).toFixed(6)}
              </p>
            )}
            {message.metadata?.filename && (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() =>
                  download(
                    message.metadata!.filename!,
                    message.metadata!.content || "",
                    message.metadata!.mime,
                  )
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
