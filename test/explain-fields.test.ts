import { describe, expect, it } from "vitest";
import { explain, explainDetailed } from "../src/index";

describe("explain（フィールドの端）", () => {
  it.each([
    ["0-30/5 * * * *", "0分から30分まで5分ごと"],
    ["0 9-17/2 * * *", "毎日午前9時から午後5時まで2時間ごと（毎時0分）"],
    ["*/20 9-17/4 * * *", "毎日午前9時から午後5時まで4時間ごと（20分ごと）"],
    ["0 0 */10 * *", "毎月10日ごとの午前0時"],
    ["0 0 * * */2", "毎週日曜日、火曜日、木曜日、土曜日の午前0時"],
    ["0,30 9,18 * * *", "毎日午前9時と午後6時台の0分と30分"],
    ["0 1,5,9 * * *", "毎日午前1時、午前5時、午前9時"],
    ["0 0-2,20-23 * * *", "毎日午前0時から午前2時までと午後8時から午後11時まで毎時0分"],
    ["* */6 * * *", "6時間ごと（毎分）"],
    ["0 0 1,L * *", "毎月1日と月末の午前0時"],
    ["0 0 * * 1#1,3#2", "第1月曜日と第2水曜日の午前0時"],
    ["0 0 1 1,7 *", "1月と7月の1日の午前0時"],
    ["0 0 15 1-3 *", "1月から3月までの15日の午前0時"],
    ["0 0 1 1 1", "毎年1月1日および月曜日の午前0時"],
    ["0 0 * 1 1-5", "1月の平日の午前0時"],
  ])("%s → %s", (expression, expected) => {
    expect(explain(expression)).toBe(expected);
  });

  it("秒フィールドのいろいろ", () => {
    expect(explain("* * * * * *", { seconds: true })).toBe("毎秒");
    expect(explain("0,30 * * * * *", { seconds: true })).toBe("毎分の0秒と30秒");
    expect(explain("30 0 * * * *", { seconds: true })).toBe("毎時0分の30秒");
  });

  it("フィールド別の説明", () => {
    const detail = explainDetailed("*/15 9-17 1,15 */3 1-5");
    expect(detail.fields.minute.text).toBe("15分ごと");
    expect(detail.fields.hour.text).toBe("午前9時から午後5時まで");
    expect(detail.fields.dayOfMonth.text).toBe("1日と15日");
    expect(detail.fields.month.text).toBe("3か月ごと");
    expect(detail.fields.dayOfWeek.text).toBe("平日");
    expect(detail.fields.dayOfWeek.kind).toBe("range");
    expect(detail.fields.month.kind).toBe("step");
    expect(detail.fields.dayOfMonth.kind).toBe("list");
  });

  it("'?' は制約なしとして説明する", () => {
    expect(explain("0 0 ? * 1")).toBe("毎週月曜日の午前0時");
    expect(explainDetailed("0 0 ? * 1").fields.dayOfMonth.text).toBe("毎日");
  });

  it("曜日をすべて含む指定は「毎日」", () => {
    expect(explain("0 0 * * 0-6")).toBe("毎日午前0時");
  });

  it("月末オフセットと直近平日", () => {
    expect(explain("0 0 L-3 * *")).toBe("毎月月末の3日前の午前0時");
    expect(explain("0 0 15W * *")).toBe("毎月15日に最も近い平日の午前0時");
    expect(explain("0 0 * * 5L")).toBe("最終金曜日の午前0時");
  });
});
