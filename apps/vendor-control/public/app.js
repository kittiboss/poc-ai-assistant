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
async function refresh() {
  const [tenants, prices, versions] = await Promise.all([
    api("/tenants"),
    api("/prices"),
    api("/prices/history"),
  ]);
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
