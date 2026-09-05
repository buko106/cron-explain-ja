import { describe, expect, it } from "vitest";
import { explain, parse, validate } from "../src/index";
import { type ExplainFixture, loadFixtures, type ParseFixture } from "./helpers/fixtures";

const parseFixtures = loadFixtures<ParseFixture>("parse.jsonl").filter(
  (fixture) => fixture.expr !== null,
);
const explainFixtures = loadFixtures<ExplainFixture>("explain.jsonl");

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
  // 拡張構文と、日本語では一意に表せない式を除く
  const targets = explainFixtures
    .filter((fixture) => fixture.extensions === undefined)
    .map((fixture) => fixture.expr)
    .filter((expr) => !expr.startsWith("@"));

  it.each(targets)("%s", (expression) => {
    const text = explain(expression);
    const result = parse(text);
    expect(result.expression).not.toBeNull();
    if (result.expression === null) return;
    expect(validate(result.expression).valid).toBe(true);
  });
});
