import { describe, expect, it } from "vitest";
import {
  DOW_SPEC,
  expandField,
  formatField,
  HOUR_SPEC,
  MINUTE_SPEC,
  MONTH_SPEC,
  parseExpression,
  toRanges,
} from "../src/cron";
import { CronSyntaxError } from "../src/errors";

describe("parseExpression", () => {
  it.each([
    ["* * * * *", "any"],
    ["5 * * * *", "value"],
    ["1-5 * * * *", "range"],
    ["*/15 * * * *", "step"],
    ["1,3,5 * * * *", "list"],
  ])("%s の分フィールドは %s", (expression, kind) => {
    expect(parseExpression(expression).ast.minute.kind).toBe(kind);
  });

  it("月名・曜日名を数値にする", () => {
    const { ast } = parseExpression("0 0 1 JAN MON");
    expect(ast.month).toEqual({ kind: "value", value: 1 });
    expect(ast.dayOfWeek).toEqual({ kind: "value", value: 1 });
  });

  it("曜日の 7 を 0 に正規化する", () => {
    expect(parseExpression("0 0 * * 7").ast.dayOfWeek).toEqual({ kind: "value", value: 0 });
  });

  it.each([
    ["@yearly", "0 0 1 1 *"],
    ["@annually", "0 0 1 1 *"],
    ["@monthly", "0 0 1 * *"],
    ["@weekly", "0 0 * * 0"],
    ["@daily", "0 0 * * *"],
    ["@midnight", "0 0 * * *"],
    ["@hourly", "0 * * * *"],
  ])("マクロ %s を展開する", (macro, expanded) => {
    const parsed = parseExpression(macro);
    expect(parsed.macro).toBe(macro);
    const fields = [
      parsed.ast.minute,
      parsed.ast.hour,
      parsed.ast.dayOfMonth,
      parsed.ast.month,
      parsed.ast.dayOfWeek,
    ];
    expect(fields.map(formatField).join(" ")).toBe(expanded);
  });

  it("拡張構文を検出する", () => {
    expect(parseExpression("0 0 L * *").extensions).toEqual(["L"]);
    expect(parseExpression("0 0 15W * *").extensions).toEqual(["W"]);
    expect(parseExpression("0 0 ? * 1#2").extensions.sort()).toEqual(["#", "?"]);
    expect(parseExpression("0 0 * * 5L").extensions).toEqual(["L"]);
  });

  it("秒付き 6 フィールドを解釈する", () => {
    const { ast } = parseExpression("*/30 0 9 * * *", { seconds: true });
    expect(ast.seconds).toEqual({ kind: "step", base: { kind: "any" }, step: 30 });
  });

  it("`5/15` は 5 から最大値までの刻みとして扱う", () => {
    expect(parseExpression("5/15 * * * *").ast.minute).toEqual({
      kind: "step",
      base: { kind: "range", from: 5, to: 59 },
      step: 15,
    });
  });

  it.each([
    ["", "空"],
    ["* * * *", "フィールド不足"],
    ["* * * * * *", "秒なしで 6 フィールド"],
    ["60 * * * *", "分の範囲外"],
    ["* 24 * * *", "時の範囲外"],
    ["* * 32 * *", "日の範囲外"],
    ["* * * 13 *", "月の範囲外"],
    ["* * * * 8", "曜日の範囲外"],
    ["* * * * 1#6", "第 6 週"],
    ["* * * * L", "曜日単独の L"],
    ["L * * * *", "分フィールドの L"],
    ["*/x * * * *", "刻み幅が数値でない"],
    ["1-5/2/3 * * * *", "刻みの二重指定"],
    ["? * * * *", "分フィールドの ?"],
    ["* * L-31 * *", "L のオフセット過大"],
    ["@unknown", "未知のマクロ"],
  ])("%s は CronSyntaxError（%s）", (expression) => {
    expect(() => parseExpression(expression)).toThrow(CronSyntaxError);
  });

  it("文字列以外を渡すとエラー", () => {
    expect(() => parseExpression(undefined as unknown as string)).toThrow(CronSyntaxError);
  });
});

describe("expandField", () => {
  it("範囲を展開する", () => {
    expect(expandField(parseExpression("1-5 * * * *").ast.minute, MINUTE_SPEC)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("刻みを展開する", () => {
    expect(expandField(parseExpression("*/20 * * * *").ast.minute, MINUTE_SPEC)).toEqual([
      0, 20, 40,
    ]);
  });

  it("循環する範囲を展開する", () => {
    expect(expandField(parseExpression("0 0 * * 5-1").ast.dayOfWeek, DOW_SPEC)).toEqual([
      0, 1, 5, 6,
    ]);
    expect(expandField(parseExpression("0 0 * 11-2 *").ast.month, MONTH_SPEC)).toEqual([
      1, 2, 11, 12,
    ]);
  });

  it("リストは重複を除いて昇順にする", () => {
    expect(expandField(parseExpression("0 5,1,5,3 * * *").ast.hour, HOUR_SPEC)).toEqual([1, 3, 5]);
  });

  it("拡張構文は空配列", () => {
    expect(expandField(parseExpression("0 0 L * *").ast.dayOfMonth, MINUTE_SPEC)).toEqual([]);
  });
});

describe("formatField", () => {
  it.each(["*", "5", "1-5", "*/15", "1-10/2", "1,3,5", "L", "L-3", "15W", "1#2", "5L", "?"])(
    "%s を往復できる",
    (field) => {
      const expression =
        field === "?" || field === "L" || field === "L-3" || field === "15W"
          ? `0 0 ${field} * *`
          : field === "1#2" || field === "5L"
            ? `0 0 * * ${field}`
            : `${field} * * * *`;
      const parsed = parseExpression(expression);
      const target =
        field === "?" || field === "L" || field === "L-3" || field === "15W"
          ? parsed.ast.dayOfMonth
          : field === "1#2" || field === "5L"
            ? parsed.ast.dayOfWeek
            : parsed.ast.minute;
      expect(formatField(target)).toBe(field);
    },
  );
});

describe("toRanges", () => {
  it("連続部分をまとめる", () => {
    expect(toRanges([1, 2, 3, 5, 7, 8])).toEqual([
      [1, 3],
      [5, 5],
      [7, 8],
    ]);
    expect(toRanges([])).toEqual([]);
  });
});
