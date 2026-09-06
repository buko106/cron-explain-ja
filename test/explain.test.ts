import { describe, expect, it } from "vitest";
import { CronSyntaxError, explain, explainDetailed } from "../src/index";
import type { ExplainOptions, Explanation } from "../src/types";
import { type ExplainFixture, loadFixtures } from "./helpers/fixtures";

// このファイルは cron 式と日本語の対応そのものを見る。タイムゾーンの書き換えは
// test/timezone.test.ts の担当なので、変換の起きない UTC を既定にして呼ぶ。
function detailUtc(expression: string, options: ExplainOptions = {}): Explanation {
  return explainDetailed(expression, { ...options, tz: "UTC" });
}

function explainUtc(expression: string, options: ExplainOptions = {}): string {
  return explain(expression, { ...options, tz: "UTC" });
}

const fixtures = loadFixtures<ExplainFixture>("explain.jsonl");
const realWorld = loadFixtures<ExplainFixture>("explain-real.jsonl");

// フィクスチャは cron 式と日本語の対応そのものを固定したもの。
// タイムゾーン変換は別の関心なので、変換の起きない UTC で回す
function checkFixture(fixture: ExplainFixture): void {
  const options: ExplainOptions = fixture.seconds === true ? { seconds: true } : {};
  if (fixture.error !== undefined) {
    expect(() => explainUtc(fixture.expr, options)).toThrow(fixture.error);
    return;
  }
  expect(explainUtc(fixture.expr, options)).toBe(fixture.casual);
  if (fixture.formal !== undefined) {
    expect(explainUtc(fixture.expr, { ...options, style: "formal" })).toBe(fixture.formal);
  }
  if (fixture.h24 !== undefined) {
    expect(explainUtc(fixture.expr, { ...options, hour: "24h" })).toBe(fixture.h24);
  }
  if (fixture.extensions !== undefined) {
    expect(detailUtc(fixture.expr, options).extensions.sort()).toEqual(
      [...fixture.extensions].sort(),
    );
  }
}

describe("explain（フィクスチャ）", () => {
  it.each(fixtures.map((fixture) => [fixture.expr, fixture] as const))("%s", (_expr, fixture) => {
    checkFixture(fixture);
  });
});

// DESIGN.md §3.7: 実在の crontab から集めた式の出力を人手で確認し、そのまま固定したもの。
// 出典は各行の source を参照。
describe("explain（実在 crontab）", () => {
  it.each(realWorld.map((fixture) => [fixture.expr, fixture] as const))("%s", (_expr, fixture) => {
    checkFixture(fixture);
  });
});

describe("explain（オプション）", () => {
  it("showTimeZone でタイムゾーン名を併記する", () => {
    expect(explain("0 9 * * *", { tz: "UTC", showTimeZone: true })).toBe("毎日午前9時（UTC）");
    expect(explain("0 4 * * *", { showTimeZone: true })).toBe("毎日午後1時（Asia/Tokyo）");
  });

  it("collapseWeekdays: false で「平日」に畳まない", () => {
    expect(explainUtc("0 9 * * 1-5", { collapseWeekdays: false })).toBe(
      "毎週月曜日から金曜日までの午前9時",
    );
  });

  it("seconds: true で 6 フィールドとして解釈する", () => {
    expect(explainUtc("*/30 * * * * *", { seconds: true })).toBe("30秒ごと");
    expect(explainUtc("0 0 9 * * *", { seconds: true })).toBe("毎日午前9時");
    expect(explainUtc("15 0 9 * * *", { seconds: true })).toBe("毎日午前9時の15秒");
  });

  it("秒付きの式を seconds なしで渡すとエラーになる", () => {
    expect(() => explainUtc("0 0 9 * * *")).toThrow(CronSyntaxError);
  });
});

describe("explainDetailed", () => {
  it("フィールド別の内訳を返す", () => {
    const detail = detailUtc("0 9 * * 1-5");
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
    expect(detailUtc("0 0 1 JAN 7").expression).toBe("0 0 1 1 0");
    expect(detailUtc("@monthly").expression).toBe("0 0 1 * *");
  });

  it("拡張構文には note を付け、next は空になる", () => {
    const detail = detailUtc("0 0 L * *");
    expect(detail.extensions).toEqual(["L"]);
    expect(detail.notes.length).toBeGreaterThan(0);
    expect(detail.next).toEqual([]);
    expect(detail.fields.dayOfMonth.kind).toBe("extension");
    expect(detail.fields.dayOfMonth.values).toEqual([]);
  });

  it("秒フィールドを含められる", () => {
    const detail = detailUtc("30 0 9 * * *", { seconds: true });
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
    expect(() => explainUtc(expression)).toThrow(CronSyntaxError);
  });

  it("エラーはフィールドと位置を持つ", () => {
    try {
      explainUtc("0 25 * * *");
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
