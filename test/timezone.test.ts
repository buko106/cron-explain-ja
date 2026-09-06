import { describe, expect, it } from "vitest";
import { createMemoryIO } from "../src/cli/io";
import { run } from "../src/cli/run";
import { formatExpression, parseExpression, resolveTimeZone, shiftExpression } from "../src/cron";
import { CronTimeZoneError, explain, explainDetailed, parse } from "../src/index";

const TOKYO = "Asia/Tokyo";

function io(options?: Parameters<typeof createMemoryIO>[0]) {
  return createMemoryIO(options);
}

describe("parse: 日本語（既定 Asia/Tokyo）→ UTC の cron 式", () => {
  it.each([
    ["毎日午後1時", "0 4 * * *"],
    ["毎日午前9時", "0 0 * * *"],
    ["毎日午前3時", "0 18 * * *"],
    ["平日の朝9時", "0 0 * * 1-5"],
    ["毎週月曜日の午前10時", "0 1 * * 1"],
    ["15分ごと", "*/15 * * * *"],
  ])("%s → %s", (text, expression) => {
    expect(parse(text).expression).toBe(expression);
  });

  it("localExpression は日本語が字面どおり指した時刻", () => {
    const result = parse("毎日午後1時");
    expect(result.localExpression).toBe("0 13 * * *");
    expect(result.expression).toBe("0 4 * * *");
    expect(result.tz).toBe(TOKYO);
  });

  it("tz を指定すると別のゾーンとして読む", () => {
    expect(parse("毎日午後1時", { tz: "UTC" }).expression).toBe("0 13 * * *");
    expect(parse("毎日午後1時", { tz: "Europe/Moscow" }).expression).toBe("0 10 * * *");
  });

  it("日付をまたぐ指定は曜日もずらす", () => {
    // JST 月曜 05:00 は UTC 日曜 20:00
    expect(parse("毎週月曜日の午前5時").expression).toBe("0 20 * * 0");
  });
});

describe("explain: UTC の cron 式 → 日本語（既定 Asia/Tokyo）", () => {
  it.each([
    ["0 4 * * *", "毎日午後1時"],
    ["0 9 * * *", "毎日午後6時"],
    ["0 0 * * 1-5", "平日の午前9時"],
    ["*/15 * * * *", "15分ごと"],
    // UTC 20:00 月曜 = JST 火曜 05:00。曜日も 1 つ進む
    ["0 20 * * 1", "毎週火曜日の午前5時"],
    // UTC 20:00 の 1 日 = JST 2 日の 05:00
    ["0 20 1 * *", "毎月2日の午前5時"],
  ])("%s → %s", (expression, text) => {
    expect(explain(expression)).toBe(text);
  });

  it("tz: 'UTC' なら書き換えない", () => {
    expect(explain("0 9 * * *", { tz: "UTC" })).toBe("毎日午前9時");
    expect(explain("0 9 * * 1-5", { tz: "UTC" })).toBe("平日の午前9時");
  });

  it("30 分・45 分きざみのゾーンも扱える", () => {
    expect(explain("0 4 * * *", { tz: "Asia/Kolkata" })).toBe("毎日午前9時30分");
    expect(explain("0 4 * * *", { tz: "Asia/Kathmandu" })).toBe("毎日午前9時45分");
  });

  it("刻みの構造を保つ", () => {
    const detail = explainDetailed("0 */2 * * *");
    expect(detail.localExpression).toBe("0 1-23/2 * * *");
    expect(detail.text).toBe("毎日午前1時から午後11時まで2時間ごと（毎時0分）");
  });

  it("showTimeZone でゾーン名を併記する", () => {
    expect(explain("0 4 * * *", { showTimeZone: true })).toBe("毎日午後1時（Asia/Tokyo）");
  });

  it("小文字や別名のゾーン名も受け付ける", () => {
    expect(explain("0 4 * * *", { tz: "asia/tokyo" })).toBe("毎日午後1時");
    expect(explain("0 4 * * *", { tz: "JST", showTimeZone: true })).toBe(
      "毎日午後1時（Asia/Tokyo）",
    );
  });

  it("'local' は実行環境のゾーン名に解決する", () => {
    // 実行環境のゾーンは選べないので、名前の解決だけを見る
    expect(resolveTimeZone("local")).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(resolveTimeZone("local")).not.toBe("local");
  });
});

describe("explainDetailed", () => {
  it("expression は入力(UTC)、localExpression と fields は書き換え後", () => {
    const detail = explainDetailed("0 4 * * 1-5");
    expect(detail.expression).toBe("0 4 * * 1-5");
    expect(detail.localExpression).toBe("0 13 * * 1-5");
    expect(detail.tz).toBe(TOKYO);
    expect(detail.fields.hour.raw).toBe("13");
    expect(detail.fields.hour.values).toEqual([13]);
    expect(detail.text).toBe("平日の午後1時");
  });

  it("next は UTC 解釈の絶対時刻", () => {
    const [first] = explainDetailed("0 4 * * *").next;
    expect(first?.toISOString().slice(11)).toBe("04:00:00.000Z");
  });
});

describe("書き換えられない式は失敗させる", () => {
  it.each([
    // 18:00-翌02:00 になり、日付をまたぐ時刻とまたがない時刻が混ざる
    ["0 9-17 * * 1-5", {}, "日付をまたぐ時刻とまたがない時刻"],
    // 31 日 + 1 日は月によって存在しない
    ["0 20 31 * *", {}, "月をまたぐ可能性"],
    // 月が絞られていると月末の実行が翌月へこぼれる
    ["0 20 * 1 *", {}, "月をまたぐ"],
    // 日がずれると L / # / W の意味が変わる
    ["0 20 L * *", {}, "L / # / W"],
    // +5:45 では分の繰り上がりが時刻によって変わる
    ["0,30 4 * * *", { tz: "Asia/Kathmandu" }, "分と時の組み合わせ"],
    // 夏時間があると固定のオフセットに直せない
    ["0 4 * * *", { tz: "America/New_York" }, "夏時間"],
  ])("%s は CronTimeZoneError", (expression, options, reason) => {
    expect(() => explain(expression, options)).toThrow(CronTimeZoneError);
    expect(() => explain(expression, options)).toThrow(reason);
  });

  it("解釈できないゾーン名も CronTimeZoneError", () => {
    expect(() => explain("0 4 * * *", { tz: "Nowhere/Nothing" })).toThrow(CronTimeZoneError);
    expect(() => parse("毎日午後1時", { tz: "Nowhere/Nothing" })).toThrow("Nowhere/Nothing");
  });

  it("日をまたがない式は 29-31 日でも通る", () => {
    expect(explain("0 4 31 * *")).toBe("毎月31日の午後1時");
  });
});

describe("書き換えは往復する", () => {
  const expressions = [
    "0 4 * * *",
    "0 4 * * 1-5",
    "*/15 * * * *",
    "0 */2 * * *",
    "30 20 * * 1",
    "0 20 1 * *",
    "0 0 15 6 *",
    "0 9-17 * * *",
    "0,30 4,16 * * *",
  ];

  it.each(expressions)("%s は UTC → Asia/Tokyo → UTC で戻る", (expression) => {
    const local = shiftExpression(expression, 540, TOKYO);
    const back = shiftExpression(local, -540, TOKYO);
    expect(back).toBe(formatExpression(parseExpression(expression).ast));
  });
});

describe("CLI", () => {
  it("parse は既定で UTC の式を出す", async () => {
    const memory = io();
    expect(await run(["parse", "毎日午後1時"], memory)).toBe(0);
    expect(memory.stdout).toEqual(["0 4 * * *"]);
  });

  it("parse --tz でゾーンを変えられる", async () => {
    const memory = io();
    await run(["parse", "毎日午後1時", "--tz", "UTC"], memory);
    expect(memory.stdout).toEqual(["0 13 * * *"]);
  });

  it("parse -i の質問と答えは日本語側の時刻で扱う", async () => {
    const memory = io({ answers: ["7"] });
    expect(await run(["parse", "毎日", "-i"], memory)).toBe(0);
    // JST 07:00 を答えたので UTC では前日 22:00
    expect(memory.stdout).toEqual(["0 22 * * *"]);
  });

  it("explain --detailed は書き換えの前後を見せる", async () => {
    const memory = io();
    await run(["explain", "0 4 * * 1-5", "--detailed"], memory);
    expect(memory.stdout[0]).toBe("平日の午後1時");
    expect(memory.stdout.some((line) => line.includes("UTC 0 4 * * 1-5"))).toBe(true);
    expect(memory.stdout.some((line) => line.includes("Asia/Tokyo 0 13 * * 1-5"))).toBe(true);
  });

  it("explain --show-tz でゾーン名を併記する", async () => {
    const memory = io();
    await run(["explain", "0 4 * * *", "--show-tz"], memory);
    expect(memory.stdout).toEqual(["毎日午後1時（Asia/Tokyo）"]);
  });

  it("書き換えられない式は exit 2", async () => {
    const memory = io();
    expect(await run(["explain", "0 9-17 * * 1-5"], memory)).toBe(2);
    expect(memory.stderr[0]).toContain("error");

    const parseIO = io();
    expect(await run(["parse", "毎日午後1時", "--tz", "America/New_York"], parseIO)).toBe(2);
    expect(parseIO.stderr[0]).toContain("夏時間");
  });
});
