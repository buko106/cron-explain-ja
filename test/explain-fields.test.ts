import { describe, expect, it } from "vitest";
import { explain, explainDetailed } from "../src/index";

describe("explain（フィールドの端）", () => {
  it.each([
    ["0-30/5 * * * *", "0分から30分まで5分ごと"],
    ["0 9-17/2 * * *", "毎日午前9時から午後5時まで2時間ごと（毎時0分）"],
    ["*/20 9-17/4 * * *", "毎日午前9時から午後5時まで4時間ごと（20分ごと）"],
    ["0 0 */10 * *", "毎月10日ごとの午前0時"],
    ["0 0 * * */2", "毎週日曜日、火曜日、木曜日、土曜日の午前0時"],
    ["0,30 9,18 * * *", "毎日午前9時台と午後6時台の0分と30分"],
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

  // 刻みは base の下限から数えるので、全値を含む循環範囲でも `*` とは値が違う。
  // 「Nごと」に畳むと本文と values が食い違う
  it("全値を含む循環範囲の刻みは「Nごと」に畳まない", () => {
    expect(explain("0 1-0/2 * * *")).toBe("毎日午前1時から午前0時まで2時間ごと（毎時0分）");
    expect(explainDetailed("0 1-0/2 * * *").fields.hour.values).toEqual([
      1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23,
    ]);
    expect(explain("1-0/5 * * * *")).toBe("1分から0分まで5分ごと");
    expect(explain("0 0-23/2 * * *")).toBe("2時間ごと（毎時0分）");
  });

  // `*/90` は実際には毎時 0 分に 1 回動くだけで、「90分ごと」は誤解をそのまま肯定する
  it("フィールドの幅を超える刻みは「Nごと」と説明しない", () => {
    expect(explain("*/90 * * * *")).toBe("毎時0分");
    expect(explain("0-59/90 * * * *")).toBe("毎時0分");
    expect(explain("0 */25 * * *")).toBe("毎日午前0時");
    expect(explain("0-10/15 * * * *")).toBe("毎時0分");
    expect(explainDetailed("*/90 * * * *").fields.minute.values).toEqual([0]);
  });

  // 「AからBまでNごと」を自己完結した形のまま時の節に続けると「まで」が重なる。
  // 時の中の位置として組み立て直し、時をまたがない上限（59 分）は落とす
  it("時の節に続く分の刻みは「毎時」で始めて「まで」を重ねない", () => {
    expect(explain("5/15 9-17 * * *")).toBe("毎日午前9時から午後5時まで毎時5分から15分ごと");
    expect(explain("5/15 9-17/2 * * *")).toBe(
      "毎日午前9時から午後5時まで2時間ごと（毎時5分から15分ごと）",
    );
    expect(explain("5/15 9 * * *")).toBe("毎日午前9時台の5分から15分ごと");
    // 途中で終わる範囲の上限は書かれた値なので残す
    expect(explain("0-30/5 9-17 * * *")).toBe(
      "毎日午前9時から午後5時まで毎時0分から30分まで5分ごと",
    );
    expect(explain("0-30/5 9 * * *")).toBe("毎日午前9時台の0分から30分まで5分ごと");
  });

  // 前に時の節が無ければ「毎時」を足す相手がいない。自己完結した形のまま出す
  it("時を限定しない文の分の刻みはそのまま出す", () => {
    expect(explain("5/15 * * * *")).toBe("5分から59分まで15分ごと");
    expect(explain("5-55/10 * * * *")).toBe("5分から55分まで10分ごと");
    expect(explainDetailed("5/15 9-17 * * *").fields.minute.text).toBe("5分から59分まで15分ごと");
  });

  // toRanges は 2 個の連なりも 1 範囲にするが、describeHourValues は 3 個以上でしか
  // 畳まない。閾値がずれると「午後0時と午後1時毎時0分」のように接続が抜ける
  it("連続する 2 個の時のリストも点として扱う", () => {
    expect(explain("0 12,13 * * *")).toBe("毎日正午と午後1時");
    expect(explain("* 12,13 * * *")).toBe("毎日午後0時台と午後1時台の毎分");
    expect(explain("0 9,10 * * *")).toBe("毎日午前9時と午前10時");
    expect(explain("0 12,13,14 * * *")).toBe("毎日午後0時から午後2時まで毎時0分");
  });
});
