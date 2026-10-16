/** CSV parser with quoted fields, escaped quotes, CRLF and embedded newlines. */
export function parseCsv(text: string, maxRows = 10000): string[][] {
  if (text.length > 2_000_000) throw new Error("CSV is limited to 2 MB");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  const cell = () => {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > 100) throw new Error("CSV is limited to 100 columns");
  };
  const line = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > maxRows + 1)
      throw new Error(`CSV is limited to ${maxRows} data rows`);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ",") cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting");
      field += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length || closed) line();
  if (!rows.length) throw new Error("CSV is empty");
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width))
    throw new Error("CSV rows must have the same number of columns");
  return rows;
}

/** Defend spreadsheet downloads against formula injection. */
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const toCsv = (rows: unknown[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function sensitiveFindings(text: string): string[] {
  const rules: [string, RegExp][] = [
    [
      "API key / access token",
      /\b(?:AIza[\w-]{20,}|sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|AQ\.[\w-]{24,})\b/i,
    ],
    ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    [
      "Password / secret assignment",
      /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["']?[^\s"']{4,}/i,
    ],
    ["Email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    [
      "Phone / identity number",
      /(?:^|[^\d])(?:\+?66[ -]?\d[\d -]{7,10}|0[689]\d[ -]?\d{3}[ -]?\d{4}|\d{13})(?!\d)/,
    ],
  ];
  return rules
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

/** Arithmetic only. No eval, property lookup, function invocation or executable code. */
export function calculate(expression: string): number {
  if (
    !expression.trim() ||
    expression.length > 200 ||
    /[^\d\s.+*/()%\-]/.test(expression)
  )
    throw new Error("Use numbers, parentheses and + - * / % only");
  const tokens = expression.match(/(?:\d*\.\d+|\d+\.?\d*)|[()+*/%\-]/g) || [];
  let i = 0;
  function atom(): number {
    if (tokens[i] === "+") {
      i++;
      return atom();
    }
    if (tokens[i] === "-") {
      i++;
      return -atom();
    }
    if (tokens[i] === "(") {
      i++;
      const n = sum();
      if (tokens[i++] !== ")") throw new Error("Unbalanced parentheses");
      return n;
    }
    const token = tokens[i++];
    if (!token || !/^(?:\d*\.\d+|\d+\.?\d*)$/.test(token))
      throw new Error("Invalid expression");
    return Number(token);
  }
  function product(): number {
    let n = atom();
    while (["*", "/", "%"].includes(tokens[i])) {
      const op = tokens[i++],
        v = atom();
      n = op === "*" ? n * v : op === "/" ? n / v : n % v;
    }
    return n;
  }
  function sum(): number {
    let n = product();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++],
        v = product();
      n = op === "+" ? n + v : n - v;
    }
    return n;
  }
  const result = sum();
  if (i !== tokens.length || !Number.isFinite(result))
    throw new Error("Invalid or non-finite result");
  return result;
}
