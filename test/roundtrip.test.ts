import { describe, expect, it } from "vitest";
import { explain, explainDetailed, parse, validate } from "../src/index";
import type { ExplainOptions } from "../src/types";
import { type ExplainFixture, loadFixtures, type ParseFixture } from "./helpers/fixtures";

const parseFixtures = loadFixtures<ParseFixture>("parse.jsonl").filter(
  (fixture) => fixture.expr !== null,
);
const explainFixtures = [
  ...loadFixtures<ExplainFixture>("explain.jsonl"),
  ...loadFixtures<ExplainFixture>("explain-real.jsonl"),
];

/**
 * 式が実際に動く値の集合。
 * `0-6` と `*`、曜日の `7` と `0` のような表記の違いは吸収し、意味だけを比べる。
 */
function signature(expression: string, options: ExplainOptions = {}): string {
  const { fields } = explainDetailed(expression, options);
  return JSON.stringify([
    fields.minute.values,
    fields.hour.values,
    fields.dayOfMonth.values,
    fields.month.values,
    fields.dayOfWeek.values,
  ]);
}

describe("往復: parse → explain → parse", () => {
  it.each(parseFixtures.map((fixture) => fixture.text))("%s", (text) => {
    const first = parse(text);
    expect(first.expression).not.toBeNull();
    if (first.expression === null) return;

    const second = parse(explain(first.expression));
    expect(second.expression).toBe(first.expression);
  });
});

describe("往復: explain → parse", () => {
  // parse は 5 フィールドしか作れないので、日本語で一意に表せない式は除く（§3.3）。
  // ただし `?` は「制約なし」で `*` と同じ集合、秒が 0 の式は文に秒が出てこないので、
  // 5 フィールドの意味だけなら比べられる。L / # / W は値に展開できないため除く
  const comparable = (fixture: ExplainFixture): boolean => {
    if (fixture.error !== undefined) return false;
    if (!(fixture.extensions ?? []).every((extension) => extension === "?")) return false;
    return fixture.seconds !== true || fixture.expr.startsWith("0 ");
  };
  const targets = [
    ...new Map(
      explainFixtures
        .filter(comparable)
        .map<[string, ExplainOptions]>((fixture) => [
          fixture.expr,
          fixture.seconds === true ? { seconds: true } : {},
        ]),
    ),
  ];

  it.each(targets)("%s", (expression, options) => {
    const text = explain(expression, options);
    const result = parse(text);
    expect(result.expression).not.toBeNull();
    if (result.expression === null) return;
    expect(validate(result.expression).valid).toBe(true);
    expect(signature(result.expression), `${text} → ${result.expression}`).toBe(
      signature(expression, options),
    );
  });

  it.each([{ hour: "24h" }, { style: "formal" }] as const)("%o でも意味が変わらない", (style) => {
    for (const [expression, options] of targets) {
      const text = explain(expression, { ...options, ...style });
      const result = parse(text);
      expect(result.expression, `${expression} → ${text}`).not.toBeNull();
      if (result.expression === null) continue;
      expect(signature(result.expression), `${expression} → ${text} → ${result.expression}`).toBe(
        signature(expression, options),
      );
    }
  });
});
