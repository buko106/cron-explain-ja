import { CronExpressionParser } from "cron-parser";
import { describe, expect, it } from "vitest";
import { CronTimeZoneError, next } from "../src/index";

/** 2026-09-05 (土) 12:34:56 JST。ランナーのゾーンに依存しないよう UTC で書く */
const FROM = new Date("2026-09-05T03:34:56Z");

const TOKYO = "Asia/Tokyo";
const NEW_YORK = "America/New_York";

function iso(dates: Date[]): string[] {
  return dates.map((date) => date.toISOString());
}

/** 「2026-09-07 09:00」形式の壁時計 */
function wall(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const found: Record<string, string> = {};
  for (const part of parts) found[part.type] = part.value;
  return `${found.year}-${found.month}-${found.day} ${found.hour}:${found.minute}`;
}

function walls(dates: Date[], tz: string): string[] {
  return dates.map((date) => wall(date, tz));
}

describe("next", () => {
  it("既定で 3 件返す", () => {
    expect(next("0 9 * * 1-5", { from: FROM })).toHaveLength(3);
  });

  it("既定のタイムゾーンは Asia/Tokyo（実行環境のゾーンに依存しない）", () => {
    // 09:00 JST = 00:00 UTC
    expect(iso(next("0 9 * * 1-5", { from: FROM, count: 3 }))).toEqual([
      "2026-09-07T00:00:00.000Z",
      "2026-09-08T00:00:00.000Z",
      "2026-09-09T00:00:00.000Z",
    ]);
    expect(iso(next("0 9 * * 1-5", { from: FROM, count: 3, tz: TOKYO }))).toEqual(
      iso(next("0 9 * * 1-5", { from: FROM, count: 3 })),
    );
  });

  it("平日の 9 時を正しく求める", () => {
    const dates = next("0 9 * * 1-5", { from: FROM, count: 3, tz: TOKYO });
    expect(walls(dates, TOKYO)).toEqual([
      "2026-09-07 09:00",
      "2026-09-08 09:00",
      "2026-09-09 09:00",
    ]);
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

  it("IANA のゾーン名で解釈できる", () => {
    const dates = next("30 9 * * *", {
      from: new Date("2026-06-15T00:00:00Z"),
      count: 2,
      tz: NEW_YORK,
    });
    expect(walls(dates, NEW_YORK)).toEqual(["2026-06-15 09:30", "2026-06-16 09:30"]);
    // 6 月の New York は EDT (UTC-4)
    expect(iso(dates)).toEqual(["2026-06-15T13:30:00.000Z", "2026-06-16T13:30:00.000Z"]);
  });

  it("ゾーンごとに同じ壁時計を返す", () => {
    const zones = [TOKYO, "UTC", NEW_YORK, "Europe/London", "Australia/Lord_Howe"];
    for (const tz of zones) {
      const dates = next("30 9 * * *", { from: new Date("2026-06-14T12:00:00Z"), count: 1, tz });
      expect(walls(dates, tz)[0]?.slice(-5), tz).toBe("09:30");
    }
  });

  it("'local' は実行環境のゾーンで解釈する", () => {
    const [first] = next("0 9 * * *", { from: FROM, count: 1, tz: "local" });
    expect(first?.getHours()).toBe(9);
  });

  it("小文字や別名のゾーン名も受け付ける", () => {
    expect(iso(next("0 9 * * *", { from: FROM, count: 1, tz: "asia/tokyo" }))).toEqual(
      iso(next("0 9 * * *", { from: FROM, count: 1, tz: TOKYO })),
    );
  });

  it("解釈できないゾーン名は CronTimeZoneError", () => {
    expect(() => next("0 9 * * *", { tz: "Nowhere/Nothing" })).toThrow(CronTimeZoneError);
    expect(() => next("0 9 * * *", { tz: "Nowhere/Nothing" })).toThrow("Nowhere/Nothing");
  });

  it("日と曜日の同時指定は OR", () => {
    const dates = next("0 0 15 * 1", { from: new Date("2026-09-04T15:00:00Z"), count: 4 });
    expect(walls(dates, TOKYO)).toEqual([
      "2026-09-07 00:00",
      "2026-09-14 00:00",
      "2026-09-15 00:00",
      "2026-09-21 00:00",
    ]);
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
    expect(dates.map((date) => date.getUTCSeconds())).toEqual([0, 30]);
  });

  it("不正な from は空配列", () => {
    expect(next("* * * * *", { from: new Date("invalid") })).toEqual([]);
  });

  it("探索は 5 年先までで打ち切る", () => {
    // 2026-09-05 起点なら 2027-2031 の 5 回しか見つからない
    expect(next("0 0 1 1 *", { from: FROM, count: 10 })).toHaveLength(5);
  });

  it("うるう年の 2/29 を跨いで探索する", () => {
    const [first] = next("0 0 29 2 *", { from: new Date("2025-12-31T15:00:00Z"), count: 1 });
    expect(wall(first ?? new Date(0), TOKYO)).toBe("2028-02-29 00:00");
  });
});

// 夏時間の扱いは DESIGN.md §2.4 の決定。New York の 2026 年は 3/8 に春の飛び、11/1 に秋の巻き戻し。
describe("next（夏時間）", () => {
  it("存在しない壁時計は切り替え直後に寄せる", () => {
    const dates = next("30 2 * * *", {
      from: new Date("2026-03-06T12:00:00Z"),
      count: 4,
      tz: NEW_YORK,
    });
    expect(walls(dates, NEW_YORK)).toEqual([
      "2026-03-07 02:30",
      "2026-03-08 03:30", // 02:30 は存在しないので切り替え直後
      "2026-03-09 02:30",
      "2026-03-10 02:30",
    ]);
  });

  it("2 回ある壁時計は早い方で 1 回だけ返す", () => {
    const dates = next("30 1 * * *", {
      from: new Date("2026-10-30T12:00:00Z"),
      count: 3,
      tz: NEW_YORK,
    });
    expect(iso(dates)).toEqual([
      "2026-10-31T05:30:00.000Z",
      "2026-11-01T05:30:00.000Z", // EDT 側。EST 側の 06:30Z では返さない
      "2026-11-02T06:30:00.000Z",
    ]);
  });

  it("巻き戻しで同じ壁時計を 2 度返さない", () => {
    const dates = next("*/30 1 * * *", {
      from: new Date("2026-11-01T04:59:00Z"),
      count: 3,
      tz: NEW_YORK,
    });
    // 01:00 EST (06:00Z) と 01:30 EST (06:30Z) は返さず、翌日へ進む
    expect(iso(dates)).toEqual([
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T05:30:00.000Z",
      "2026-11-02T06:00:00.000Z",
    ]);
  });

  // DESIGN.md §2.4 の決定。Vixie cron / cron-parser は時が `*` の式に限り
  // 巻き戻した 1 時間をもう一度動かすが、ここでは式によらず壁時計 1 回に統一している。
  it("時が '*' の式でも巻き戻した 1 時間は繰り返さない", () => {
    const dates = next("0 * * * *", {
      from: new Date("2026-11-01T03:00:00Z"),
      count: 4,
      tz: NEW_YORK,
    });
    expect(iso(dates)).toEqual([
      "2026-11-01T04:00:00.000Z", // 00:00 EDT
      "2026-11-01T05:00:00.000Z", // 01:00 EDT
      "2026-11-01T07:00:00.000Z", // 02:00 EST（01:00 EST = 06:00Z は返さない）
      "2026-11-01T08:00:00.000Z",
    ]);
  });

  it("30 分刻みの夏時間でも壁時計が保たれる", () => {
    const tz = "Australia/Lord_Howe";
    const dates = next("0 12 * * *", { from: new Date("2026-04-03T00:00:00Z"), count: 4, tz });
    expect(walls(dates, tz)).toEqual([
      "2026-04-03 12:00",
      "2026-04-04 12:00",
      "2026-04-05 12:00",
      "2026-04-06 12:00",
    ]);
  });

  it("春の飛びの日も探索が空回りしない", () => {
    const started = Date.now();
    next("30 2 * * *", { from: new Date("2026-03-07T12:00:00Z"), count: 1, tz: NEW_YORK });
    expect(Date.now() - started).toBeLessThan(200);
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
  const zones = [TOKYO, "UTC", NEW_YORK, "Europe/London"];

  it.each(zones.flatMap((tz) => expressions.map((expression) => [tz, expression] as const)))(
    "%s / %s",
    (tz, expression) => {
      const reference = CronExpressionParser.parse(expression, { currentDate: FROM, tz });
      const expected = Array.from({ length: 5 }, () => reference.next().toDate());
      expect(iso(next(expression, { from: FROM, count: 5, tz }))).toEqual(iso(expected));
    },
  );

  // 夏時間の境界そのものを cron-parser と突き合わせる。
  // 時を固定した式では一致する（時が `*` の式は上の describe に書いたとおり意図的に異なる）
  const dstCases = [
    ["30 2 * * *", "2026-03-06T12:00:00Z"],
    ["0 2 * * *", "2026-03-06T12:00:00Z"],
    ["*/20 2 * * *", "2026-03-07T12:00:00Z"],
    ["30 1 * * *", "2026-10-30T12:00:00Z"],
    ["*/20 1 * * *", "2026-10-31T12:00:00Z"],
    ["*/30 1 * * *", "2026-11-01T04:59:00Z"],
    ["0 1 * * *", "2026-11-01T03:00:00Z"],
  ] as const;

  it.each(dstCases)("America/New_York %s（%s 起点）", (expression, from) => {
    const currentDate = new Date(from);
    const reference = CronExpressionParser.parse(expression, { currentDate, tz: NEW_YORK });
    const expected = Array.from({ length: 6 }, () => reference.next().toDate());
    expect(iso(next(expression, { from: currentDate, count: 6, tz: NEW_YORK }))).toEqual(
      iso(expected),
    );
  });
});
