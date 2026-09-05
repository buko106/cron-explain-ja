import { describe, expect, it } from "vitest";
import { ParseAmbiguityError, parse } from "../src/index";
import { loadFixtures, type ParseFixture } from "./helpers/fixtures";

const fixtures = loadFixtures<ParseFixture>("parse.jsonl");

describe("parse（フィクスチャ）", () => {
  it.each(fixtures.map((fixture) => [fixture.text, fixture] as const))("%s", (_text, fixture) => {
    const result = parse(fixture.text);
    expect(result.expression).toBe(fixture.expr);
    expect(result.confidence).toBeCloseTo(fixture.confidence, 5);
    if (fixture.ambiguities !== undefined) {
      expect(result.ambiguities.map((ambiguity) => ambiguity.field).sort()).toEqual(
        [...fixture.ambiguities].sort(),
      );
    }
  });
});

describe("parse（オプション）", () => {
  it("defaultHour を変えられる", () => {
    expect(parse("毎日", { defaultHour: 7 }).expression).toBe("0 7 * * *");
  });

  it("timeOfDay で曖昧語の既定値を上書きできる", () => {
    expect(parse("朝", { timeOfDay: { 朝: 5 } }).expression).toBe("0 5 * * *");
  });

  it("allowExtensions: true なら拡張構文で減点しない", () => {
    const result = parse("月末の23時", { allowExtensions: true });
    expect(result.expression).toBe("0 23 L * *");
    expect(result.confidence).toBe(1);
  });

  it("strict は曖昧な入力で ParseAmbiguityError を投げる", () => {
    expect(() => parse("毎日", { strict: true })).toThrow(ParseAmbiguityError);
    try {
      parse("毎日", { strict: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ParseAmbiguityError);
      if (error instanceof ParseAmbiguityError) {
        expect(error.result.expression).toBe("0 9 * * *");
      }
    }
  });

  it("strict でも曖昧でなければ通る", () => {
    expect(parse("平日の朝9時", { strict: true }).expression).toBe("0 9 * * 1-5");
  });

  it("strict で時間表現が無ければ例外", () => {
    expect(() => parse("こんにちは", { strict: true })).toThrow(ParseAmbiguityError);
  });
});

describe("parse（注記と曖昧さ）", () => {
  it("日と曜日の同時指定に note を付ける", () => {
    const result = parse("火曜日の15日");
    expect(result.notes.some((note) => note.includes("OR"))).toBe(true);
  });

  it("時刻範囲の終端に note を付ける", () => {
    const result = parse("9時から18時まで30分ごと");
    expect(result.notes.some((note) => note.includes("18時台"))).toBe(true);
  });

  it("時間帯の語と合わない時刻に note を付ける", () => {
    const result = parse("朝22時");
    expect(result.expression).toBe("0 22 * * *");
    expect(result.notes.some((note) => note.includes("朝"))).toBe(true);
  });

  it("「毎年」は月が未指定なら 1 月にして曖昧さを返す", () => {
    const result = parse("毎年");
    expect(result.expression).toBe("0 9 1 1 *");
    expect(result.ambiguities.map((ambiguity) => ambiguity.field).sort()).toEqual([
      "hour",
      "month",
    ]);
  });

  it("曖昧さには候補が付く", () => {
    const [ambiguity] = parse("朝").ambiguities;
    expect(ambiguity?.field).toBe("hour");
    expect(ambiguity?.candidates.map((candidate) => candidate.value)).toEqual([6, 7, 8, 9, 10]);
  });

  it("間隔と時刻の併用は曖昧として扱う", () => {
    const result = parse("9時に15分ごと");
    expect(result.ambiguities.some((ambiguity) => ambiguity.field === "hour")).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });

  it("トークン列を返す", () => {
    const { tokens } = parse("平日の朝9時");
    expect(tokens.map((token) => token.type)).toEqual(["DOW_SET", "SEP", "TIME_OF_DAY", "TIME"]);
  });

  it("解釈できない語は減点する", () => {
    const result = parse("毎日9時ぴよぴよ");
    expect(result.expression).toBe("0 9 * * *");
    expect(result.confidence).toBeLessThan(1);
  });
});

describe("parse（範囲と刻み）", () => {
  it.each([
    ["毎月5日から3日ごとの午前0時", "0 0 5-31/3 * *"],
    ["月初から3日ごとの午前0時", "0 0 */3 * *"],
    ["1月から3か月ごとの1日の午前0時", "0 0 1 */3 *"],
    ["3ヶ月ごとの1日の午前0時", "0 0 1 */3 *"],
    ["6か月おきの1日の午前0時", "0 0 1 */6 *"],
    ["午前9時から午後5時まで毎分", "* 9-17 * * *"],
    ["9時から17時まで5分から55分まで10分ごと", "5-55/10 9-17 * * *"],
    ["1日から3日までと10日から12日までの午前0時", "0 0 1-3,10-12 * *"],
    ["毎月1日から3日までと15日の午前0時", "0 0 1-3,15 * *"],
    ["正午と午前0時", "0 0,12 * * *"],
    ["朝と夕方", "0 9,18 * * *"],
  ])("%s → %s", (text, expected) => {
    expect(parse(text).expression).toBe(expected);
  });

  it("「1月毎日」を「1か月ごと」と切らない", () => {
    expect(parse("1月毎日午前0時").expression).toBe("0 0 * 1 *");
  });
});

describe("parse（同じフィールドへの二重指定）", () => {
  const conflict = (note: string) => note.includes("2 通り");

  it.each([
    ["毎時1分と5分ごと", "*/5 * * * *", "分"],
    ["5分ごとに1分と3分", "1,3 * * * *", "分"],
    ["毎月1日と3日ごとの午前0時", "0 0 */3 * *", "日"],
    ["3日ごとの1日の午前0時", "0 0 1 * *", "日"],
    ["月末の3日ごとの午前0時", "0 0 L * *", "日"],
    ["1月と3か月ごとの1日の午前0時", "0 0 1 */3 *", "月"],
    ["3か月ごとの1月の午前0時", "0 0 1 1 *", "月"],
    ["30分ごとに15分ごと", "*/15 * * * *", "分"],
  ])("%s は後勝ちにして note と減点を付ける", (text, expected, label) => {
    const result = parse(text);
    expect(result.expression).toBe(expected);
    expect(result.notes.filter(conflict).some((note) => note.includes(label))).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });

  it("範囲として書かれていれば二重指定にしない", () => {
    const result = parse("毎月1日から3日ごとの午前0時");
    expect(result.notes.some(conflict)).toBe(false);
    expect(result.confidence).toBe(1);
  });
});

describe("parse（複数の時刻）", () => {
  it("分が揃わない時刻の並びは組み合わせになると note を付ける", () => {
    const result = parse("毎日9時と18時30分");
    expect(result.expression).toBe("0,30 9,18 * * *");
    expect(result.notes.some((note) => note.includes("組み合わせ"))).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  // 「9時」が持つ 0 分は書かれた値ではない。別に書かれた分がそのまま分フィールドになる
  it.each([
    ["毎日午前9時台の0分と30分", "0,30 9 * * *"],
    ["毎日午前9時台と午後6時台の0分と30分", "0,30 9,18 * * *"],
    ["毎日午後2時台の10分と44分", "10,44 14 * * *"],
    ["毎日午後2時台の0分から5分まで", "0-5 14 * * *"],
    ["毎日午前9時から午後5時まで毎時0分と30分", "0,30 9-17 * * *"],
    ["毎日午後2時台と午後6時台の5分ごと", "*/5 14,18 * * *"],
  ])("%s → %s", (text, expected) => {
    expect(parse(text).expression).toBe(expected);
  });

  it("時刻の側にも分が書かれていれば二重指定として扱う", () => {
    const result = parse("毎日9時30分と45分");
    expect(result.expression).toBe("45 9 * * *");
    expect(result.notes.some((note) => note.includes("2 通り"))).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });
});

describe("parse（時の範囲が複数）", () => {
  it.each([
    ["毎日午前0時から午前2時までと午後8時から午後11時まで毎時0分", "0 0-2,20-23 * * *"],
    ["毎日午前0時から午前2時までと午後8時から午後11時まで毎分", "* 0-2,20-23 * * *"],
    [
      "午前1時から午前3時まで、午前10時から午後0時まで、午後8時から午後10時まで毎時0分",
      "0 1-3,10-12,20-22 * * *",
    ],
    // 刻みは書かれた範囲それぞれに掛かる
    ["午前0時から午前2時までと午後8時から午後11時まで2時間ごと", "0 0-2/2,20-23/2 * * *"],
    // 範囲と単独の時が混ざっても、どちらも落とさない
    ["午前0時から午前2時までと午後8時の2時間ごと", "0 0-2/2,20 * * *"],
    // 「まで」が来なかった「から」は範囲を作らない
    ["9時と17時から", "0 9,17 * * *"],
  ])("%s → %s", (text, expected) => {
    expect(parse(text).expression).toBe(expected);
  });

  it("終端の note は「まで」ごとに付ける", () => {
    const result = parse("毎日午前0時から午前2時までと午後8時から午後11時まで毎時0分");
    expect(result.notes.filter((note) => note.includes("時台まで"))).toHaveLength(2);
    expect(result.confidence).toBe(0.8);
  });
});

describe("parse（時間帯の語の位置）", () => {
  // 「朝」を 17 時の修飾語として吸うと、9-17 が 17 だけになったまま confidence 1.0 になる
  it("範囲の始点に置かれた時間帯の語を読む", () => {
    const result = parse("朝から17時まで");
    expect(result.expression).toBe("0 9-17 * * *");
    expect(result.ambiguities.some((ambiguity) => ambiguity.question.includes("朝"))).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });

  it("範囲の終点に置かれた時間帯の語も読む", () => {
    expect(parse("9時から夕方まで").expression).toBe("0 9-18 * * *");
  });

  it("時刻の直前にあれば従来どおり修飾語として読む", () => {
    expect(parse("朝9時から夕方5時まで").expression).toBe("0 9-17 * * *");
  });
});

describe("parse（「N時台」）", () => {
  // 「台」はその時の中という意味なので、間隔と並んでも読み方は 1 つしかない
  it("「N時台」と間隔の併用は曖昧にしない", () => {
    const result = parse("毎日午前9時台の10分ごと");
    expect(result.expression).toBe("*/10 9 * * *");
    expect(result.ambiguities).toEqual([]);
    expect(result.confidence).toBe(1);
  });

  it("時が一点を指すときは曖昧のまま", () => {
    const result = parse("毎日午前9時に10分ごと");
    expect(result.expression).toBe("*/10 9 * * *");
    expect(result.ambiguities.some((ambiguity) => ambiguity.field === "hour")).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });

  // 「9時台の2時間ごと」は時の刻みなので、「台」があっても読み方が決まらない
  it("時間単位の間隔との併用は曖昧のまま", () => {
    const result = parse("毎日午前9時台の2時間ごと");
    expect(result.ambiguities.some((ambiguity) => ambiguity.field === "hour")).toBe(true);
  });
});

describe("parse（頻度語と間隔の組み合わせ）", () => {
  // 「毎分」だけを見て時の刻みを捨てると、2 時間ごとが黙って毎時になる
  it.each([
    ["2時間ごとの毎分", "* */2 * * *"],
    ["午前9時から午後5時まで2時間ごとの毎分", "* 9-17/2 * * *"],
    ["午前9時台の毎分", "* 9 * * *"],
    // 「毎日」が書かれていれば日は決まっている。1 日に寄せない
    ["3か月ごとの毎日毎分", "* * * */3 *"],
    ["毎月毎日午前0時", "0 0 * * *"],
  ])("%s → %s", (text, expected) => {
    expect(parse(text).expression).toBe(expected);
  });

  it("「Nか月ごと」だけなら日を補って曖昧さを返す", () => {
    const result = parse("3か月ごとの午前0時");
    expect(result.expression).toBe("0 0 1 */3 *");
    expect(result.ambiguities.some((ambiguity) => ambiguity.field === "dayOfMonth")).toBe(true);
  });
});

describe("parse（週単位の刻み）", () => {
  it("cron で表せないことを note にして減点する", () => {
    const result = parse("2週間ごとの月曜日の午前0時");
    expect(result.expression).toBe("0 0 * * 1");
    expect(result.notes.some((note) => note.includes("週単位"))).toBe(true);
    expect(result.confidence).toBe(0.7);
  });
});
