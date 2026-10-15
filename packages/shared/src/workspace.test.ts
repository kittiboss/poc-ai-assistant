import { describe, expect, it } from "vitest";
import { calculate, parseCsv, sensitiveFindings, toCsv } from "./workspace";

describe("local workspace tools", () => {
  it("parses quoted commas, multiline cells, escaped quotes, BOM and CRLF without losing data", () => {
    expect(
      parseCsv('\uFEFFname,note\r\nAlice,"two, parts"\r\nBob,"a\n""quote"""'),
    ).toEqual([
      ["name", "note"],
      ["Alice", "two, parts"],
      ["Bob", 'a\n"quote"'],
    ]);
    expect(() => parseCsv("a,b\n1")).toThrow();
    expect(() => parseCsv('a,b\n"unfinished,2')).toThrow();
    expect(() => parseCsv("a\n1\n2", 1)).toThrow();
  });
  it("prevents spreadsheet formula injection in exports, including whitespace prefixed payloads", () => {
    const exported = toCsv([["=SUM(1,2)", "  @cmd", "-5", 'safe,"quoted"']]);
    expect(parseCsv(exported)[0]).toEqual([
      "'=SUM(1,2)",
      "'  @cmd",
      "'-5",
      'safe,"quoted"',
    ]);
  });
  it("calculates arithmetic precedence without evaluating arbitrary code", () => {
    expect(calculate("(125 + 75) * 1.07")).toBeCloseTo(214);
    expect(calculate("-3 + 8 / 2")).toBe(1);
    for (const value of [
      "process.exit()",
      "1/0",
      "1 2",
      "2**3",
      "(1+2",
      "constructor",
      "1e400",
    ])
      expect(() => calculate(value)).toThrow();
  });
  it("detects secrets and PII in complete outgoing context without returning matching values", () => {
    expect(
      sensitiveFindings("User: demo@example.com; password=demoonly"),
    ).toEqual(["Password / secret assignment", "Email address"]);
    expect(sensitiveFindings("public handbook about leave")).toEqual([]);
    expect(sensitiveFindings(`AQ.${"x".repeat(30)}`)).toContain(
      "API key / access token",
    );
  });
});
