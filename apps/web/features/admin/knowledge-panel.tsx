"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card } from "../../components/ui/primitives";
import { useApi } from "../../lib/api";
import type { IndexRun, KnowledgeStatus } from "../../lib/types";

type ImportResult = { rows: number; created: number; updated: number };
type ReindexStart = IndexRun & { started: boolean; estimatedSeconds: number };

const runSummary = (run: IndexRun) =>
  run.error
    ? `Indexing stopped after ${run.embedded} of ${run.pending} product(s): ${run.error} Products already embedded stay searchable; index again to continue.`
    : `Embedded ${run.embedded} product(s) in ${run.batches} request(s)${run.removed ? `; removed ${run.removed} passage(s) for deleted products` : ""}.`;

/** Product-catalog RAG: import the CSV, then embed new or changed products with the configured model. */
export function KnowledgePanel({ refreshKey }: { refreshKey?: unknown }) {
  const api = useApi();
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const load = () =>
    api
      .request<KnowledgeStatus>("/knowledge/status")
      .then((next) => {
        setStatus(next);
        return next;
      })
      .catch((cause) => {
        setMessage((cause as Error).message);
        return null;
      });
  useEffect(() => {
    void load();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Indexing runs in the background (external models are paced to the provider's quota): poll until it ends.
  useEffect(() => {
    if (!status?.indexing) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (next && !next.indexing && next.lastRun)
          setMessage(runSummary(next.lastRun));
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [status?.indexing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function importCsv() {
    const csv = file.current?.files?.[0];
    if (!csv) return;
    setBusy(true);
    setMessage("");
    setErrors([]);
    try {
      const body = new FormData();
      body.append("file", csv);
      // Raw fetch so row-level validation errors in the response body can be listed.
      const response = await fetch(
        `${api.apiBase}/admin/knowledge/products/import`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${api.accessToken}` },
          body,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrors(Array.isArray(payload.errors) ? payload.errors : []);
        throw new Error(
          Array.isArray(payload.message)
            ? payload.message.join(", ")
            : payload.message || `Import failed (${response.status})`,
        );
      }
      const result = payload as ImportResult;
      setMessage(
        `Imported ${result.rows} rows (${result.created} new, ${result.updated} updated). Index the catalog to make changes searchable.`,
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      if (file.current) file.current.value = "";
      setBusy(false);
      await load();
    }
  }

  async function reindex() {
    if (!status) return;
    const pending = status.stale;
    if (
      status.embeddingModel.local === false &&
      pending > 0 &&
      !window.confirm(
        `Send ${pending} product description(s) to ${status.embeddingModel.provider} (${status.embeddingModel.displayName}) in ${Math.ceil(pending / 100)} request(s)? Requests count toward the daily external limits.`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    setErrors([]);
    try {
      const run = await api.request<ReindexStart>("/admin/knowledge/reindex", {
        method: "POST",
      });
      setMessage(
        run.started
          ? `Indexing ${run.pending} product(s) in ${run.batches} request(s)${run.estimatedSeconds ? ` — about ${Math.max(1, Math.round(run.estimatedSeconds / 60))} minute(s), paced to the provider's free-tier quota` : ""}…`
          : run.removed
            ? `Removed ${run.removed} passage(s) for deleted products; nothing else changed.`
            : "Already up to date: no product changed since the last index.",
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <div>
          <h2 className="font-semibold">Product catalog (RAG)</h2>
          <p className="text-xs text-slate-500">
            Chat retrieves matching products when users turn on “Product
            catalog”. Embedding model:{" "}
            <span className="font-medium">
              {status?.embeddingModel.displayName ?? "…"}
            </span>
            {status && status.embeddingModel.local !== null && (
              <Badge tone={status.embeddingModel.local ? "green" : "amber"}>
                {status.embeddingModel.local ? "LOCAL" : "EXTERNAL"}
              </Badge>
            )}{" "}
            (set by RAG_EMBEDDING_MODEL; enable it in the model registry).
          </p>
        </div>
        {status && (
          <Badge tone={status.available ? "green" : "red"}>
            {status.available ? "Available in chat" : "Unavailable"}
          </Badge>
        )}
      </div>
      {status?.indexing && status.lastRun && (
        <div className="px-5 pt-4">
          <p className="text-xs text-slate-500">
            Indexing {status.lastRun.embedded} / {status.lastRun.pending} with{" "}
            {status.lastRun.embeddingModel}…
          </p>
          <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-2 rounded-full bg-brand transition-all"
              style={{
                width: `${(status.lastRun.embedded / Math.max(1, status.lastRun.pending)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="grid gap-4 p-5 sm:grid-cols-4">
        <Stat label="Products" value={status?.products} />
        <Stat label="Indexed" value={status?.indexed} />
        <Stat label="New or changed" value={status?.stale} />
        <Stat label="Deleted, still indexed" value={status?.orphaned} />
      </div>
      {status?.problem && (
        <p className="px-5 text-xs text-amber-700 dark:text-amber-300">
          Not ready: {status.problem}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 p-5">
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          aria-label="Products CSV"
          className="text-xs"
          disabled={busy}
        />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void importCsv()}
        >
          Import CSV
        </Button>
        <Button
          disabled={busy || !status?.ready || status.indexing}
          onClick={() => void reindex()}
        >
          {busy ? "Working…" : "Index catalog"}
        </Button>
        <p className="text-xs text-slate-500">
          CSV columns must match prisma/data/schema.sql; rows are upserted by
          product_id.
        </p>
      </div>
      {message && (
        <p role="status" className="px-5 pb-3 text-sm">
          {message}
        </p>
      )}
      {Boolean(errors.length) && (
        <ul className="mx-5 mb-5 list-disc rounded-xl bg-red-50 p-3 pl-8 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {errors.slice(0, 20).map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        {value?.toLocaleString() ?? "–"}
      </p>
    </div>
  );
}
