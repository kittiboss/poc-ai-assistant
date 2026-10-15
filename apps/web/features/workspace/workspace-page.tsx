"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/layout/shell";
import {
  Button,
  Card,
  Input,
  Select,
  Textarea,
} from "../../components/ui/primitives";
import { useApi } from "../../lib/api";
import { download } from "../../lib/download";
import type { Project, PromptTemplate } from "../../lib/types";
import { DataAnalysis } from "./data-analysis";

type Memory = { id: string; content: string; enabled: boolean };
export function WorkspacePage() {
  const api = useApi();
  const [tab, setTab] = useState("Projects"),
    [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState("");
  const [name, setName] = useState(""),
    [instructions, setInstructions] = useState(""),
    [personal, setPersonal] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]),
    [memory, setMemory] = useState(""),
    [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [tool, setTool] = useState("calculator"),
    [toolInput, setToolInput] = useState(""),
    [toolResult, setToolResult] = useState<{
      text: string;
      filename?: string;
      content?: string;
      mime?: string;
    }>();
  const [preview, setPreview] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [p, pref, t] = await Promise.all([
      api.request<Project[]>("/workspace/projects"),
      api.request<{ instructions: string; memories: Memory[] }>(
        "/workspace/preferences",
      ),
      api.request<PromptTemplate[]>("/workspace/templates"),
    ]);
    setProjects(p);
    setPersonal(pref.instructions);
    setMemories(pref.memories);
    setTemplates(t);
  }
  useEffect(() => {
    load().catch((e) => setNotice(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const project = projects.find((p) => p.id === selected);
  const act = async (action: () => Promise<unknown>, message = "Saved") => {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(message);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function choose(id: string) {
    setSelected(id);
    const p = projects.find((p) => p.id === id);
    setName(p?.name || "");
    setInstructions(p?.instructions || "");
    setPreview("");
  }
  return (
    <Shell active="workspace">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-3xl font-semibold">Projects & tools</h1>
        <div className="flex flex-wrap gap-2">
          {[
            "Projects",
            "Instructions & memory",
            "Prompt library",
            "CSV analysis",
            "Local tools",
          ].map((t) => (
            <Button
              key={t}
              variant={tab === t ? "primary" : "secondary"}
              onClick={() => setTab(t)}
            >
              {t}
            </Button>
          ))}
        </div>
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800"
          >
            {notice}
          </p>
        )}
        {tab === "Projects" && (
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="space-y-3 p-5">
              <h2 className="font-semibold">Your projects</h2>
              <Button variant="secondary" onClick={() => choose("")}>
                New project
              </Button>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`block w-full rounded-xl p-3 text-left text-sm ${selected === p.id ? "bg-violet-100 text-violet-900" : "bg-slate-50 dark:bg-slate-950"}`}
                  onClick={() => choose(p.id)}
                >
                  {p.name}
                  <span className="block text-xs opacity-60">
                    {p.sources.length} documents
                  </span>
                </button>
              ))}
            </Card>
            <Card className="space-y-4 p-5 lg:col-span-2">
              <h2 className="font-semibold">
                {selected ? "Project settings" : "Create a project"}
              </h2>
              <label className="block text-sm">
                Name
                <Input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Instructions
                <Textarea
                  rows={5}
                  maxLength={6000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="How should the assistant help in this project?"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    act(async () => {
                      const p = await api.request<Project>(
                        selected
                          ? `/workspace/projects/${selected}`
                          : "/workspace/projects",
                        {
                          method: selected ? "PATCH" : "POST",
                          body: JSON.stringify({ name, instructions }),
                        },
                      );
                      await load();
                      setSelected(p.id);
                    })
                  }
                >
                  Save project
                </Button>
                {selected && (
                  <>
                    <Link
                      className="rounded-xl border px-4 py-2 text-sm"
                      href={`/?project=${selected}`}
                    >
                      Chat in project
                    </Link>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this project and all indexed source text? Chats will remain ungrouped.",
                          )
                        )
                          void act(async () => {
                            await api.request(
                              `/workspace/projects/${selected}`,
                              { method: "DELETE" },
                            );
                            choose("");
                            await load();
                          }, "Project and source text deleted; chats preserved");
                      }}
                    >
                      Delete project
                    </Button>
                  </>
                )}
              </div>
              {project && (
                <>
                  <hr />
                  <h3 className="font-semibold">Reference documents</h3>
                  <p className="text-xs text-slate-500">
                    TXT, MD, CSV, JSON, text PDF or DOCX · 5 MB/file · 20
                    documents/project · 100 PDF pages · no OCR. Stored locally;
                    selected excerpts are sent to the chosen model when you
                    chat.
                  </p>
                  <input
                    aria-label="Upload project document"
                    disabled={busy}
                    type="file"
                    accept=".txt,.md,.csv,.json,.pdf,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) {
                        setNotice("File limit is 5 MB");
                        return;
                      }
                      const form = new FormData();
                      form.append("file", file);
                      void act(async () => {
                        await api.request(
                          `/workspace/projects/${selected}/sources`,
                          { method: "POST", body: form },
                        );
                        await load();
                      }, "Document indexed");
                    }}
                  />
                  {project.sources.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"
                    >
                      <span>
                        {s.filename} · {(s.byteSize / 1024).toFixed(1)} KB
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() =>
                            act(async () => {
                              const source = await api.request<{
                                chunks: {
                                  content: string;
                                  page: number | null;
                                }[];
                              }>(`/workspace/sources/${s.id}`);
                              setPreview(
                                source.chunks
                                  .map(
                                    (c) =>
                                      `${c.page ? `Page ${c.page}\n` : ""}${c.content}`,
                                  )
                                  .join("\n\n"),
                              );
                            }, "Source preview opened")
                          }
                        >
                          Preview
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${s.filename} from future retrieval? Existing response citations remain until chat retention removes them.`,
                              )
                            )
                              void act(async () => {
                                await api.request(
                                  `/workspace/sources/${s.id}`,
                                  { method: "DELETE" },
                                );
                                await load();
                                setPreview("");
                              }, "Source removed");
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {preview && (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-950">
                      {preview}
                    </pre>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
        {tab === "Instructions & memory" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="space-y-4 p-5">
              <h2 className="font-semibold">Personal instructions</h2>
              <p className="text-sm text-slate-500">
                Applies to your future messages, together with project
                instructions and the selected persona.
              </p>
              <Textarea
                rows={8}
                maxLength={6000}
                value={personal}
                onChange={(e) => setPersonal(e.target.value)}
              />
              <Button
                disabled={busy}
                onClick={() =>
                  act(() =>
                    api.request("/workspace/preferences", {
                      method: "PATCH",
                      body: JSON.stringify({ instructions: personal }),
                    }),
                  )
                }
              >
                Save instructions
              </Button>
            </Card>
            <Card className="space-y-4 p-5">
              <h2 className="font-semibold">Explicit memories</h2>
              <p className="text-sm text-slate-500">
                Only memories you add are saved. Enabled memories accompany
                future prompts; disable or delete at any time. Up to 20
                memories.
              </p>
              <Textarea
                rows={2}
                value={memory}
                maxLength={500}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="Preferred language: Thai"
              />
              <Button
                disabled={busy || !memory.trim()}
                onClick={() =>
                  act(async () => {
                    await api.request("/workspace/memories", {
                      method: "POST",
                      body: JSON.stringify({ content: memory, enabled: true }),
                    });
                    setMemory("");
                    await load();
                  })
                }
              >
                Add memory
              </Button>
              {memories.map((m) => (
                <div key={m.id} className="space-y-2 rounded-xl border p-3">
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) =>
                        act(async () => {
                          await api.request(`/workspace/memories/${m.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              content: m.content,
                              enabled: e.target.checked,
                            }),
                          });
                          await load();
                        })
                      }
                    />
                    {m.content}
                  </label>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const content = window.prompt("Edit memory", m.content);
                        if (content)
                          void act(async () => {
                            await api.request(`/workspace/memories/${m.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                content,
                                enabled: m.enabled,
                              }),
                            });
                            await load();
                          });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        act(async () => {
                          await api.request(`/workspace/memories/${m.id}`, {
                            method: "DELETE",
                          });
                          await load();
                        }, "Memory deleted")
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}
        {tab === "Prompt library" && (
          <div className="grid gap-4 md:grid-cols-2">
            {!templates.length && (
              <p>
                No templates yet. Administrators can add personas in Admin
                console → Workspace controls.
              </p>
            )}
            {templates.map((t) => (
              <Card key={t.id} className="space-y-3 p-5">
                <h2 className="font-semibold">{t.name}</h2>
                <p className="text-sm">{t.description}</p>
                <details>
                  <summary className="cursor-pointer text-sm">
                    View instructions
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap text-xs">
                    {t.systemPrompt}
                  </pre>
                </details>
                <Link
                  className="inline-block rounded-xl bg-brand px-4 py-2 text-sm text-white"
                  href={`/?template=${t.id}`}
                >
                  Use persona
                </Link>
              </Card>
            ))}
          </div>
        )}
        {tab === "CSV analysis" && <DataAnalysis />}
        {tab === "Local tools" && (
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Run a tool</h2>
            <p className="text-sm text-slate-500">
              Tools run locally on explicit request. They do not call an AI
              provider. Search / FAQ uses only documents in your selected
              project.
            </p>
            <div className="flex flex-wrap gap-3">
              <Select
                aria-label="Tool"
                value={tool}
                onChange={(e) => {
                  setTool(e.target.value);
                  setToolResult(undefined);
                }}
              >
                {[
                  "calculator",
                  "time",
                  "search",
                  "faq",
                  "usage",
                  "prices",
                  "csv",
                  "markdown",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
              <Select
                aria-label="Tool project"
                value={selected}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Textarea
              aria-label="Tool input"
              rows={6}
              maxLength={20000}
              value={toolInput}
              onChange={(e) => setToolInput(e.target.value)}
              placeholder={
                tool === "calculator"
                  ? "(125 + 75) * 1.07"
                  : "Query, CSV or Markdown content"
              }
            />
            <Button
              disabled={busy}
              onClick={() =>
                act(
                  async () =>
                    setToolResult(
                      await api.request("/workspace/tools", {
                        method: "POST",
                        body: JSON.stringify({
                          tool,
                          input: toolInput,
                          ...(selected ? { projectId: selected } : {}),
                        }),
                      }),
                    ),
                  "Tool completed",
                )
              }
            >
              Run tool
            </Button>
            {toolResult && (
              <>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-950">
                  {toolResult.text}
                </pre>
                {toolResult.filename && (
                  <Button
                    onClick={() =>
                      download(
                        toolResult.filename!,
                        toolResult.content || "",
                        toolResult.mime,
                      )
                    }
                  >
                    Download {toolResult.filename}
                  </Button>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}
