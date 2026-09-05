import { CronExpressionParser } from "cron-parser";
import { describe, expect, it } from "vitest";
import { next } from "../src/index";

const FROM = new Date(2026, 8, 5, 12, 34, 56); // 2026-09-05 (土) 12:34:56 ローカル

function iso(dates: Date[]): string[] {
  return dates.map((date) => date.toISOString());
}

describe("next", () => {
  it("既定で 3 件返す", () => {
    expect(next("0 9 * * 1-5", { from: FROM })).toHaveLength(3);
  });

  it("平日の 9 時を正しく求める", () => {
    const dates = next("0 9 * * 1-5", { from: FROM, count: 3 });
    expect(
      dates.map((date) => `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}`),
    ).toEqual(["9/7 9", "9/8 9", "9/9 9"]);
  });

  it("count を指定できる", () => {
    expect(next("*/15 * * * *", { from: FROM, count: 5 })).toHaveLength(5);
  });

  it("count が 0 以下なら空", () => {
    expect(next("*/15 * * * *", { from: FROM, count: 0 })).toEqual([]);
  });

  it("UTC で解釈できる", () => {
    const [first] = next("0 0 * * *", { from: new Date("2026-09-05T12:00:00Z"), tz: "UTC" });
    expect(first?.toISOString()).toBe("2026-09-06T00:00:00.000Z");
  });

  it("日と曜日の同時指定は OR", () => {
    const dates = next("0 0 15 * 1", { from: new Date(2026, 8, 5), count: 4 });
    const days = dates.map((date) => date.getDate());
    expect(days).toEqual([7, 14, 15, 21]);
  });

  it("拡張構文では空配列", () => {
    expect(next("0 0 L * *", { from: FROM })).toEqual([]);
    expect(next("0 0 * * 1#2", { from: FROM })).toEqual([]);
    expect(next("0 0 15W * *", { from: FROM })).toEqual([]);
  });

  it("'?' は制約なしとして扱う", () => {
    expect(next("0 0 ? * 1", { from: FROM, count: 1 })).toHaveLength(1);
  });

  it("到達しない式は空配列", () => {
    expect(next("0 0 30 2 *", { from: FROM })).toEqual([]);
  });

  it("秒付きの式に対応する", () => {
    const dates = next("*/30 * * * * *", { from: FROM, seconds: true, count: 2 });
    expect(dates.map((date) => date.getSeconds())).toEqual([0, 30]);
  });

  it("不正な from は空配列", () => {
    expect(next("* * * * *", { from: new Date("invalid") })).toEqual([]);
  });

  it("探索は 5 年先までで打ち切る", () => {
    // 2026-09-05 起点なら 2027-2031 の 5 回しか見つからない
    expect(next("0 0 1 1 *", { from: FROM, count: 10 })).toHaveLength(5);
  });

  it("うるう年の 2/29 を跨いで探索する", () => {
    const [first] = next("0 0 29 2 *", { from: new Date(2026, 0, 1), count: 1 });
    expect(first?.getFullYear()).toBe(2028);
  });
});

describe("next（cron-parser との一致）", () => {
  const expressions = [
    "0 9 * * 1-5",
    "*/15 * * * *",
    "0 0 1 * *",
    "30 18 * * 5",
    "0 12 1,15 * *",
    "0 */2 * * *",
    "0 9-17 * * 1-5",
    "0 0 * 1 *",
    "0 0 1 1 *",
    "5 4 * * 0",
    "0 22 * * 1-5",
    "23 0-20/2 * * *",
    "0 0,12 1 */2 *",
    "0 4 8-14 * *",
    "0 0 15 * 1",
  ];

  it.each(expressions)("%s", (expression) => {
    const reference = CronExpressionParser.parse(expression, { currentDate: FROM });
    const expected = Array.from({ length: 5 }, () => reference.next().toDate());
    expect(iso(next(expression, { from: FROM, count: 5 }))).toEqual(iso(expected));
  });
});
