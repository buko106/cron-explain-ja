import { describe, expect, it } from "vitest";
import { explain, explainDetailed, parse, validate } from "../src/index";
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
function signature(expression: string): string {
  const { fields } = explainDetailed(expression);
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
  // 拡張構文と秒付きは日本語で一意に表せないため除く（§3.3）
  const targets = [
    ...new Set(
      explainFixtures
        .filter(
          (fixture) =>
            fixture.error === undefined &&
            fixture.extensions === undefined &&
            fixture.seconds !== true,
        )
        .map((fixture) => fixture.expr),
    ),
  ];

  it.each(targets)("%s", (expression) => {
    const text = explain(expression);
    const result = parse(text);
    expect(result.expression).not.toBeNull();
    if (result.expression === null) return;
    expect(validate(result.expression).valid).toBe(true);
    expect(signature(result.expression), `${text} → ${result.expression}`).toBe(
      signature(expression),
    );
  });

  it.each([{ hour: "24h" }, { style: "formal" }] as const)("%o でも意味が変わらない", (options) => {
    for (const expression of targets) {
      const text = explain(expression, options);
      const result = parse(text);
      expect(result.expression, `${expression} → ${text}`).not.toBeNull();
      if (result.expression === null) continue;
      expect(signature(result.expression), `${expression} → ${text} → ${result.expression}`).toBe(
        signature(expression),
      );
    }
  });
});
