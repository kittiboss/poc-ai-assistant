const $ = (id) => document.getElementById(id);
const dollars = (value) => `$${Number(value).toFixed(9)}`;
async function api(path, method = "GET", body) {
  const response = await fetch(`/admin${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result;
}
function row(target, values) {
  const tr = document.createElement("tr");
  for (const value of values) {
    const td = document.createElement("td");
    if (value instanceof Node) td.append(value);
    else td.textContent = value;
    tr.append(td);
  }
  target.append(tr);
}
function button(label, action) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () =>
    run(async () => {
      b.disabled = true;
      try {
        await action();
      } finally {
        b.disabled = false;
      }
    });
  return b;
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    $("status").textContent = e.message;
  }
}
async function history(id) {
  const data = await api(`/tenants/${id}/billing`);
  $("history").hidden = false;
  $("history-title").textContent = `${id} · credit history`;
  $("ledger").replaceChildren();
  for (const t of data.transactions)
    row($("ledger"), [
      t.id,
      new Date(t.createdAt).toLocaleString(),
      t.kind,
      dollars(t.amount),
      t.reference,
    ]);
  $("requests").replaceChildren();
  for (const r of data.requests)
    row($("requests"), [
      r.request_id,
      `${r.model} / ${r.kind}`,
      r.state,
      `${r.input_tokens ?? "—"} / ${r.output_tokens ?? "—"}`,
      `${r.charge === null ? "Pending" : dollars(r.charge)} / v${r.price_id}`,
    ]);
}
let ragTenants = [];
/** Fill the limits form with the selected tenant's current limits. */
function showRag() {
  const tenant = ragTenants.find((t) => t.id === $("rag-tenant").value);
  if (!tenant) return;
  const form = $("rag-limits");
  for (const input of form.querySelectorAll("input")) {
    const value = tenant.rag[input.name];
    if (input.type === "checkbox")
      input.checked = Array.isArray(value)
        ? value.includes(input.value)
        : value === true;
    else input.value = value;
  }
}
function renderRag(tenants, usage) {
  ragTenants = tenants;
  const used = new Map((usage?.tenants ?? []).map((u) => [u.tenant, u]));
  const mb = (bytes) => (Number(bytes) / 1048576).toFixed(2);
  $("rag").replaceChildren();
  for (const t of tenants) {
    const u = used.get(t.id) ?? { documents: 0, textBytes: 0, chunks: 0 };
    const missing = t.rag.embeddingModels.filter(
      (m) => !t.ragEntitled.includes(m),
    );
    row($("rag"), [
      `${t.name} (${t.id})${t.rag.enabled ? "" : " · Off"}`,
      `${t.ragEntitled.join(", ") || "none"}${missing.length ? ` · not in plan: ${missing.join(", ")}` : ""}`,
      t.rag.allowedTypes.join(", "),
      usage ? `${u.documents} / ${t.rag.maxDocuments}` : `— / ${t.rag.maxDocuments}`,
      usage ? `${mb(u.textBytes)} / ${t.rag.maxTextMb}` : `— / ${t.rag.maxTextMb}`,
      usage ? `${u.chunks} / ${t.rag.maxTotalChunks}` : `— / ${t.rag.maxTotalChunks}`,
      t.rag.maxTopK,
    ]);
  }
  const selected = $("rag-tenant").value;
  $("rag-tenant").replaceChildren(
    ...tenants.map((t) => {
      const option = document.createElement("option");
      option.value = t.id;
      option.textContent = `${t.name} (${t.id})`;
      return option;
    }),
  );
  if (selected) $("rag-tenant").value = selected;
  // Do not overwrite limits the vendor is editing during the periodic refresh.
  if (!$("rag-limits").contains(document.activeElement)) showRag();
}
async function refresh() {
  const [tenants, prices, versions, ragUsage] = await Promise.all([
    api("/tenants"),
    api("/prices"),
    api("/prices/history"),
    // Usage comes from the RAG engine; limits still show while it is down.
    api("/rag/usage").catch(() => null),
  ]);
  renderRag(tenants, ragUsage);
  $("price-history").replaceChildren();
  for (const p of versions)
    row($("price-history"), [
      p.id,
      p.model,
      new Date(p.createdAt).toLocaleString(),
      `${dollars(p.inputRate)} / ${dollars(p.outputRate)}`,
      p.strategy,
    ]);
  $("tenants").replaceChildren();
  for (const t of tenants) {
    const controls = document.createElement("div");
    controls.append(
      button("History", () => history(t.id)),
      button("Grant test credit", async () => {
        const amount = prompt(
          "Simulated USD to grant (no money collected)",
          "2",
        );
        if (!amount) return;
        const receipt = await api(`/tenants/${t.id}/credits`, "POST", {
          amount,
          reference: crypto.randomUUID(),
        });
        $("status").textContent =
          `${receipt.id}: ${dollars(receipt.amount)} test credit granted. Not a tax invoice.`;
        await refresh();
        await history(t.id);
      }),
      button(t.enabled ? "Suspend" : "Resume", async () => {
        if (!confirm(`${t.enabled ? "Suspend" : "Resume"} tenant ${t.id}?`))
          return;
        await api(`/tenants/${t.id}`, "PATCH", { enabled: !t.enabled });
        await refresh();
      }),
      button("Rotate token / deploy", async () => {
        $("status").textContent =
          `Run on vendor host: npm run tenant:${t.provisioned ? "rotate" : "create"} -- ${t.id}. Token stays server-side.`;
      }),
    );
    if (Number(t.pending))
      controls.append(
        button("Settle stale reservations", async () => {
          if (
            !confirm(
              "Charge the reserved maximum for requests pending over 5 minutes? These will be labelled ESTIMATED; issue a compensating grant if investigation shows no usage.",
            )
          )
            return;
          const result = await api(`/tenants/${t.id}/reconcile`, "POST", {});
          $("status").textContent =
            `${result.settled} stale reservations settled as estimates`;
          await refresh();
        }),
      );
    row($("tenants"), [
      `${t.name} (${t.id}) · ${!t.enabled ? "Suspended" : t.provisioned ? "Active" : "Awaiting host activation"}`,
      `${dollars(t.credit.remaining)} / ${dollars(t.credit.reserved)}${t.credit.lowCredit ? " · LOW" : ""}`,
      dollars(t.credit.spent),
      `${dollars(t.simulatedProviderCost)} / ${dollars(t.credit.spent - Number(t.simulatedProviderCost))}`,
      `${t.requests} (${t.pending} pending)`,
      controls,
    ]);
  }
  $("prices").replaceChildren();
  const selected = $("models").value;
  $("models").replaceChildren();
  for (const p of prices) {
    row($("prices"), [
      p.model,
      `v${p.id}`,
      `${dollars(p.inputRate)} / ${dollars(p.outputRate)}`,
      `${dollars(p.inputCost)} / ${dollars(p.outputCost)}`,
      `${p.strategy}${p.strategy === "PERCENTAGE_MARKUP" ? ` +${p.markupPercent}%` : ""}`,
    ]);
    const option = document.createElement("option");
    option.value = p.model;
    option.textContent = p.model;
    $("models").append(option);
  }
  if (selected) $("models").value = selected;
}
$("refresh").onclick = () => run(refresh);
$("rag-tenant").onchange = showRag;
$("rag-limits").onsubmit = (event) => {
  event.preventDefault();
  const form = event.target;
  const checked = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(
      (input) => input.value,
    );
  const body = {
    enabled: form.elements.enabled.checked,
    embeddingModels: checked("embeddingModels"),
    allowedTypes: checked("allowedTypes"),
  };
  for (const name of [
    "maxDocuments",
    "maxFileMb",
    "maxTextMb",
    "maxChunksPerDocument",
    "maxTotalChunks",
    "maxTopK",
  ])
    body[name] = Number(form.elements[name].value);
  run(async () => {
    const submit = form.querySelector("button");
    submit.disabled = true;
    try {
      const tenant = $("rag-tenant").value;
      await api(`/tenants/${tenant}/rag`, "PATCH", body);
      $("status").textContent =
        `Knowledge limits saved for ${tenant}. The RAG engine applies them within 30 seconds.`;
      await refresh();
      showRag();
    } finally {
      submit.disabled = false;
    }
  });
};
for (const [id, path] of [
  ["create", "/tenants"],
  ["pricing", "/prices"],
])
  $(id).onsubmit = (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    if (id === "create") body.webPort = Number(body.webPort);
    run(async () => {
      const submit = event.target.querySelector("button");
      submit.disabled = true;
      try {
        await api(path, "POST", body);
        $("status").textContent =
          id === "create"
            ? "Tenant registered. Activate on vendor host."
            : "New pricing version saved.";
        if (id === "create")
          $("provision").textContent = `npm run tenant:create -- ${body.id}`;
        await refresh();
      } finally {
        submit.disabled = false;
      }
    });
  };
run(refresh);
setInterval(() => {
  if (!document.hidden) run(refresh);
}, 10000);
