import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as lib from "../src/index.js";

/**
 * README の ```ts ブロックを実際に走らせて、`// 'こう出る'` の注釈が実装と
 * 合っていることを確かめる。
 *
 * 0.2.0 でタイムゾーンの既定を変えたとき、CLI 節だけ直してライブラリ節の例が
 * 12 件古いまま残った。人が README を読み直さないと気づけない類の食い違いなので、
 * 例そのものをテストに繋いでおく。
 */

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, "..", "README.md"), "utf8");

/** README のコード例 1 つ。 */
interface Example {
  /** README の行番号（1 始まり） */
  line: number;
  /** 評価する式 */
  code: string;
  /** `//` の後ろから取り出した期待値のソース */
  expected: string;
}

type Outcome = { value: unknown } | { error: unknown };

/**
 * 注釈から期待値のソースを取り出す。取れなければ `null`（説明文の注釈）。
 *
 * - `'毎日午前9時'` … 文字列。閉じ引用符より後ろ（補足の日本語）は捨てる
 * - `{ expression: '…', confidence: 1, ... }` … 書かれたキーだけ照合する
 * - `[{ field: 'hour', … }]` … 要素が文字列かオブジェクトの配列
 *
 * `[Date, Date, Date]` のような形の説明は識別子を含むので対象外にする。
 */
function expectationOf(comment: string): string | null {
  const text = comment.trim();
  if (text.startsWith("'")) {
    const end = text.indexOf("'", 1);
    return end === -1 ? null : text.slice(0, end + 1);
  }
  if (text.startsWith("{")) return balanced(text, "{", "}");
  if (text.startsWith("[")) {
    const inner = text.slice(1).trimStart();
    if (!inner.startsWith("'") && !inner.startsWith("{")) return null;
    return balanced(text, "[", "]");
  }
  return null;
}

/** `open` で始まる部分から対応する `close` までを返す。 */
function balanced(text: string, open: string, close: string): string | null {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return null;
}

/** 期待値のソースを値にする。`...`（残りは問わない）は空の展開に読み替える。 */
function evaluate(source: string): unknown {
  const literal = source.replace(/\.\.\.(?=\s*[,}])/g, "...{}");
  return new Function(`return (${literal});`)();
}

/** README の ```ts ブロックを取り出し、注釈付きの行を検証対象にする。 */
function collect(): { examples: Example[]; outcomes: Outcome[] } {
  const lines = readme.split("\n");
  const examples: Example[] = [];
  const outcomes: Outcome[] = [];
  let body: string[] | null = null;

  const run = (source: string[]): void => {
    const fn = new Function(
      "lib",
      "__check",
      `const { explain, explainDetailed, parse, validate, next } = lib;\n${source.join("\n")}`,
    );
    fn(lib, (index: number, thunk: () => unknown) => {
      try {
        outcomes[index] = { value: thunk() };
      } catch (error) {
        outcomes[index] = { error };
      }
    });
  };

  lines.forEach((line, index) => {
    if (body === null) {
      if (line.trim() === "```ts") body = [];
      return;
    }
    if (line.trim() === "```") {
      run(body);
      body = null;
      return;
    }
    if (line.trimStart().startsWith("import ")) return;

    const match = /^(.*?);\s*\/\/(.+)$/.exec(line);
    const expected = match === null ? null : expectationOf(match[2] ?? "");
    if (match === undefined || match === null || expected === null) {
      body.push(line);
      return;
    }
    const code = match[1] ?? "";
    body.push(`__check(${examples.length}, () => (${code}));`);
    examples.push({ line: index + 1, code: code.trim(), expected });
  });

  return { examples, outcomes };
}

/** 期待値に書かれたところだけを照合する。`…` は任意の文字列に一致する。 */
function assertMatches(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "string") {
    if (expected.includes("…")) {
      const pattern = expected
        .split("…")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      expect(String(actual), path).toMatch(new RegExp(`^${pattern}$`));
      return;
    }
    expect(actual, path).toBe(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const items = actual as unknown[];
    expect(items.length, `${path}.length`).toBeGreaterThanOrEqual(expected.length);
    expected.forEach((item, index) => {
      assertMatches(items[index], item, `${path}[${index}]`);
    });
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual, path).toBeTypeOf("object");
    expect(actual, path).not.toBeNull();
    const record = actual as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) {
      assertMatches(record[key], value, `${path}.${key}`);
    }
    return;
  }
  expect(actual, path).toEqual(expected);
}

const { examples, outcomes } = collect();

describe("README のコード例", () => {
  // README を書き換えたときに、検証対象が黙って減っていないことの歯止め
  it("は 20 件以上を検証している", () => {
    expect(examples.length).toBeGreaterThanOrEqual(20);
  });

  it.each(examples.map((example, index) => ({ ...example, index })))(
    "README.md:$line $code",
    ({ index, expected }) => {
      const outcome = outcomes[index];
      if (outcome === undefined) throw new Error("例が実行されていない");
      if ("error" in outcome) throw outcome.error;
      assertMatches(outcome.value, evaluate(expected), "result");
    },
  );
});
