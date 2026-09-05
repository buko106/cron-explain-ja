import { describe, expect, it } from "vitest";
import { CronSyntaxError, explain, explainDetailed } from "../src/index";
import { type ExplainFixture, loadFixtures } from "./helpers/fixtures";

const fixtures = loadFixtures<ExplainFixture>("explain.jsonl");

describe("explain（フィクスチャ）", () => {
  it.each(fixtures.map((fixture) => [fixture.expr, fixture] as const))("%s", (_expr, fixture) => {
    expect(explain(fixture.expr)).toBe(fixture.casual);
    if (fixture.formal !== undefined) {
      expect(explain(fixture.expr, { style: "formal" })).toBe(fixture.formal);
    }
    if (fixture.h24 !== undefined) {
      expect(explain(fixture.expr, { hour: "24h" })).toBe(fixture.h24);
    }
    if (fixture.extensions !== undefined) {
      expect(explainDetailed(fixture.expr).extensions.sort()).toEqual(
        [...fixture.extensions].sort(),
      );
    }
  });
});

describe("explain（オプション）", () => {
  it("tz を指定すると末尾に付く", () => {
    expect(explain("0 9 * * *", { tz: "Asia/Tokyo" })).toBe("毎日午前9時（Asia/Tokyo）");
  });

  it("collapseWeekdays: false で「平日」に畳まない", () => {
    expect(explain("0 9 * * 1-5", { collapseWeekdays: false })).toBe(
      "毎週月曜日から金曜日までの午前9時",
    );
  });

  it("seconds: true で 6 フィールドとして解釈する", () => {
    expect(explain("*/30 * * * * *", { seconds: true })).toBe("30秒ごと");
    expect(explain("0 0 9 * * *", { seconds: true })).toBe("毎日午前9時");
    expect(explain("15 0 9 * * *", { seconds: true })).toBe("毎日午前9時の15秒");
  });

  it("秒付きの式を seconds なしで渡すとエラーになる", () => {
    expect(() => explain("0 0 9 * * *")).toThrow(CronSyntaxError);
  });
});

describe("explainDetailed", () => {
  it("フィールド別の内訳を返す", () => {
    const detail = explainDetailed("0 9 * * 1-5");
    expect(detail.text).toBe("平日の午前9時");
    expect(detail.expression).toBe("0 9 * * 1-5");
    expect(detail.fields.minute).toEqual({ raw: "0", kind: "value", values: [0], text: "0分" });
    expect(detail.fields.hour.text).toBe("午前9時");
    expect(detail.fields.dayOfMonth.text).toBe("毎日");
    expect(detail.fields.month.text).toBe("毎月");
    expect(detail.fields.dayOfWeek).toEqual({
      raw: "1-5",
      kind: "range",
      values: [1, 2, 3, 4, 5],
      text: "平日",
    });
    expect(detail.next).toHaveLength(3);
    expect(detail.notes).toEqual([]);
  });

  it("式を正規化する", () => {
    expect(explainDetailed("0 0 1 JAN 7").expression).toBe("0 0 1 1 0");
    expect(explainDetailed("@monthly").expression).toBe("0 0 1 * *");
  });

  it("拡張構文には note を付け、next は空になる", () => {
    const detail = explainDetailed("0 0 L * *");
    expect(detail.extensions).toEqual(["L"]);
    expect(detail.notes.length).toBeGreaterThan(0);
    expect(detail.next).toEqual([]);
    expect(detail.fields.dayOfMonth.kind).toBe("extension");
    expect(detail.fields.dayOfMonth.values).toEqual([]);
  });

  it("秒フィールドを含められる", () => {
    const detail = explainDetailed("30 0 9 * * *", { seconds: true });
    expect(detail.fields.second?.text).toBe("30秒");
    expect(detail.expression).toBe("30 0 9 * * *");
  });
});

describe("explain（エラー）", () => {
  it.each([
    ["", "空の式"],
    ["0 9 * *", "フィールド不足"],
    ["0 25 * * *", "範囲外"],
    ["0 9 * * 8", "曜日の範囲外"],
    ["a b c d e", "数値でない"],
    ["@reboot", "非対応マクロ"],
    ["*/0 * * * *", "刻み幅 0"],
  ])("%s は CronSyntaxError", (expression) => {
    expect(() => explain(expression)).toThrow(CronSyntaxError);
  });

  it("エラーはフィールドと位置を持つ", () => {
    try {
      explain("0 25 * * *");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CronSyntaxError);
      if (error instanceof CronSyntaxError) {
        expect(error.field).toBe("hour");
        expect(error.position).toBe(2);
      }
    }
  });
});
