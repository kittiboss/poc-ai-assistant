"use client";
import { useMemo, useState } from "react";
import { parseCsv, toCsv } from "@enterprise/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, Input, Select } from "../../components/ui/primitives";
import { download } from "../../lib/download";

export function DataAnalysis() {
  const [table, setTable] = useState<string[][]>([]),
    [error, setError] = useState("");
  const [filter, setFilter] = useState(""),
    [sort, setSort] = useState(0),
    [descending, setDescending] = useState(false);
  const [group, setGroup] = useState(0),
    [metric, setMetric] = useState(1),
    [chart, setChart] = useState("bar");
  const [operation, setOperation] = useState("sum");
  const rows = useMemo(
    () =>
      table
        .slice(1)
        .filter((r) =>
          r.some((c) => c.toLowerCase().includes(filter.toLowerCase())),
        )
        .sort((a, b) => {
          const numeric =
            a[sort]?.trim() &&
            b[sort]?.trim() &&
            Number.isFinite(Number(a[sort])) &&
            Number.isFinite(Number(b[sort]));
          return (
            (numeric
              ? Number(a[sort]) - Number(b[sort])
              : (a[sort] || "").localeCompare(b[sort] || "")) *
            (descending ? -1 : 1)
          );
        }),
    [table, filter, sort, descending],
  );
  const values = rows
    .map((r) => r[metric])
    .filter((v) => v?.trim() && Number.isFinite(Number(v)))
    .map(Number);
  const total = values.reduce((a, b) => a + b, 0);
  const grouped = useMemo(() => {
    const groups = new Map<string, number[]>();
    rows.forEach((r) => {
      if (r[metric]?.trim() && Number.isFinite(Number(r[metric])))
        groups.set(r[group], [
          ...(groups.get(r[group]) || []),
          Number(r[metric]),
        ]);
    });
    return [...groups].map(([name, ns]) => ({
      name,
      value:
        operation === "count"
          ? ns.length
          : operation === "min"
            ? Math.min(...ns)
            : operation === "max"
              ? Math.max(...ns)
              : ns.reduce((a, b) => a + b, 0) /
                (operation === "average" ? ns.length : 1),
    }));
  }, [rows, group, metric, operation]);
  const data = grouped.slice(0, 50),
    axes = (
      <>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
      </>
    );
  const summary = `Analyze this CSV summary (do not infer rows not supplied):\nColumns: ${JSON.stringify(table[0])}\nFiltered rows: ${rows.length}\nNumeric column: ${table[0]?.[metric]}\nSum: ${total}; Average: ${values.length ? total / values.length : "N/A"}\nFirst 5 rows:\n${toCsv([table[0] || [], ...rows.slice(0, 5)])}\nGrouped ${operation} (first 50 groups):\n${JSON.stringify(data)}`;
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-semibold">CSV analysis</h2>
      <p className="text-sm text-slate-500">
        Processed in your browser. Up to 2 MB, 10,000 rows and 100 columns. Use
        “Explain in chat” to review and send a small summary to your selected
        model.
      </p>
      <input
        aria-label="Upload CSV for analysis"
        type="file"
        accept=".csv"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 2_000_000)
              throw new Error("CSV is limited to 2 MB");
            setTable(parseCsv(await file.text()));
            setFilter("");
            setSort(0);
            setGroup(0);
            setMetric(0);
            setError("");
          } catch (cause) {
            setError((cause as Error).message);
          }
        }}
      />
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {table.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3">
            <Input
              aria-label="Filter CSV rows"
              placeholder="Filter rows"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-xs"
            />
            <Select
              aria-label="Sort CSV column"
              value={sort}
              onChange={(e) => setSort(Number(e.target.value))}
            >
              {table[0].map((h, i) => (
                <option key={i} value={i}>
                  Sort: {h || `Column ${i + 1}`}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => setDescending(!descending)}
            >
              {descending ? "Descending" : "Ascending"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Select
              aria-label="Group by column"
              value={group}
              onChange={(e) => setGroup(Number(e.target.value))}
            >
              {table[0].map((h, i) => (
                <option key={i} value={i}>
                  Group: {h || i + 1}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Numeric column"
              value={metric}
              onChange={(e) => setMetric(Number(e.target.value))}
            >
              {table[0].map((h, i) => (
                <option key={i} value={i}>
                  Value: {h || i + 1}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Aggregate operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
            >
              {["sum", "average", "min", "max", "count"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <Select
              aria-label="Chart type"
              value={chart}
              onChange={(e) => setChart(e.target.value)}
            >
              {["bar", "line", "pie"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          </div>
          <p className="text-sm">
            {rows.length} rows · {values.length} numeric values · Sum{" "}
            {total.toLocaleString()} · Average{" "}
            {values.length ? (total / values.length).toLocaleString() : "—"} ·
            Min {values.length ? Math.min(...values) : "—"} · Max{" "}
            {values.length ? Math.max(...values) : "—"}
          </p>
          {chart === "pie" && data.some((d) => d.value < 0) ? (
            <p>Pie charts require non-negative values. Choose bar or line.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {chart === "line" ? (
                  <LineChart data={data}>
                    {axes}
                    <Line dataKey="value" stroke="#7c3aed" />
                  </LineChart>
                ) : chart === "pie" ? (
                  <PieChart>
                    <Tooltip />
                    <Pie data={data} dataKey="value" nameKey="name" label>
                      {data.map((_, i) => (
                        <Cell
                          key={i}
                          fill={
                            ["#7c3aed", "#059669", "#d97706", "#2563eb"][i % 4]
                          }
                        />
                      ))}
                    </Pie>
                  </PieChart>
                ) : (
                  <BarChart data={data}>
                    {axes}
                    <Bar dataKey="value" fill="#7c3aed" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Chart shows first 50 groups; preview shows first 100 rows. Exports
            include all filtered rows / groups. Blank or non-numeric cells are
            excluded from numeric aggregates.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                download("filtered.csv", toCsv([table[0], ...rows]), "text/csv")
              }
            >
              Export filtered CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  "groups.csv",
                  toCsv([
                    ["Group", operation],
                    ...grouped.map((r) => [r.name, r.value]),
                  ]),
                  "text/csv",
                )
              }
            >
              Export aggregates
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                sessionStorage.setItem("chat-draft", summary.slice(0, 19000));
                window.location.assign("/");
              }}
            >
              Explain in chat
            </Button>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {table[0].map((h, i) => (
                    <th className="p-2" key={i}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td className="border-t p-2" key={j}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
