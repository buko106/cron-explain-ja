import { describe, expect, it } from "vitest";
import { formatHour, formatTime } from "../src/explain/time";
import { DOW, DOW_SET, DOW_SET_APPROX, FREQ, NTH, TIME_OF_DAY } from "../src/parse/dictionary";
import { kanjiToArabic, normalize, stripTail } from "../src/parse/normalize";
import { tokenize } from "../src/parse/tokenize";

describe("kanjiToArabic", () => {
  it.each([
    ["三時", "3時"],
    ["十時", "10時"],
    ["十五分ごと", "15分ごと"],
    ["二十三時", "23時"],
    ["三十一日", "31日"],
    ["〇時", "0時"],
    ["9時半", "9時半"],
    ["毎日", "毎日"],
  ])("%s → %s", (input, expected) => {
    expect(kanjiToArabic(input)).toBe(expected);
  });
});

describe("stripTail", () => {
  it.each([
    ["毎日9時に実行してください", "毎日9時"],
    ["毎日9時に実行したい", "毎日9時"],
    ["15分ごと。", "15分ごと"],
    ["平日の朝9時", "平日の朝9時"],
  ])("%s → %s", (input, expected) => {
    expect(stripTail(input)).toBe(expected);
  });
});

describe("normalize", () => {
  it("全角を半角にする", () => {
    expect(normalize("毎日９時")).toBe("毎日9時");
  });

  it("前後の空白を落とす", () => {
    expect(normalize("  毎日9時  ")).toBe("毎日9時");
  });
});

describe("tokenize", () => {
  it("時間表現を分解する", () => {
    expect(tokenize("平日の朝9時30分").map((token) => [token.type, token.raw])).toEqual([
      ["DOW_SET", "平日"],
      ["SEP", "の"],
      ["TIME_OF_DAY", "朝"],
      ["TIME", "9時30分"],
    ]);
  });

  it("「休日」を曜日集合として読む", () => {
    expect(tokenize("休日の10時")[0]).toMatchObject({ type: "DOW_SET", value: [0, 6] });
  });

  it("「9時半」を 9:30 として読む", () => {
    expect(tokenize("9時半")[0]).toMatchObject({ type: "TIME", value: { hour: 9, minute: 30 } });
  });

  it("コロン表記を読む", () => {
    expect(tokenize("18:05")[0]).toMatchObject({ type: "TIME", value: { hour: 18, minute: 5 } });
  });

  it("間隔を読む", () => {
    expect(tokenize("15分ごと")[0]).toMatchObject({
      type: "INTERVAL",
      value: { unit: "minute", n: 15 },
    });
    expect(tokenize("2時間おき")[0]).toMatchObject({
      type: "INTERVAL",
      value: { unit: "hour", n: 2 },
    });
  });

  it("月と週の間隔を読む", () => {
    expect(tokenize("3か月ごと")[0]).toMatchObject({
      type: "INTERVAL",
      value: { unit: "month", n: 3 },
    });
    expect(tokenize("3ヶ月おき")[0]).toMatchObject({
      type: "INTERVAL",
      value: { unit: "month", n: 3 },
    });
    expect(tokenize("2週間ごと")[0]).toMatchObject({
      type: "INTERVAL",
      value: { unit: "week", n: 2 },
    });
  });

  it("「毎」で終わる間隔は後ろに頻度語が続くと採らない", () => {
    expect(tokenize("1月毎日").map((token) => token.type)).toEqual(["MONTH", "FREQ"]);
    expect(tokenize("15分毎").map((token) => token.type)).toEqual(["INTERVAL"]);
  });

  it("「時台」の「台」は時の中を指すトークン", () => {
    expect(tokenize("9時台").map((token) => token.type)).toEqual(["TIME", "HOUR_SPAN"]);
  });

  it("「月末」を FREQ より優先する", () => {
    expect(tokenize("毎月末")[0]).toMatchObject({ type: "DOM_SPECIAL", value: "L" });
    expect(tokenize("毎月15日")[0]).toMatchObject({ type: "FREQ", value: "month" });
  });

  it("「月初」は 1 日", () => {
    expect(tokenize("月初")[0]).toMatchObject({ type: "DOM_SPECIAL", value: 1 });
  });

  it("第 N 週と最終を読む", () => {
    expect(tokenize("第2月曜")[0]).toMatchObject({ type: "NTH", value: 2 });
    expect(tokenize("最終金曜")[0]).toMatchObject({ type: "NTH", value: -1 });
  });

  it("範囲と並列を読む", () => {
    expect(tokenize("9時から18時まで").map((token) => token.type)).toEqual([
      "TIME",
      "RANGE_FROM",
      "TIME",
      "RANGE_TO",
    ]);
    expect(tokenize("月曜と金曜").map((token) => token.type)).toEqual(["DOW", "AND", "DOW"]);
  });

  it("未知の文字は UNKNOWN", () => {
    expect(tokenize("あ").map((token) => token.type)).toEqual(["UNKNOWN"]);
  });
});

describe("辞書", () => {
  it("曜日は 0-6 に対応する", () => {
    expect(Object.values(DOW).sort()).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it("曜日集合を持つ", () => {
    expect(DOW_SET.平日).toEqual([1, 2, 3, 4, 5]);
    expect(DOW_SET.週末).toEqual([0, 6]);
    expect(DOW_SET.土日).toEqual([0, 6]);
    expect(DOW_SET.休日).toEqual([0, 6]);
  });

  it("曜日で近似した語には説明が付く", () => {
    for (const word of Object.keys(DOW_SET_APPROX)) {
      expect(DOW_SET[word], word).toBeDefined();
      expect(DOW_SET_APPROX[word], word).toContain(word);
    }
    expect(DOW_SET_APPROX.休日).toContain("祝日");
  });

  it("時間帯の既定値は範囲内にある", () => {
    for (const [word, spec] of Object.entries(TIME_OF_DAY)) {
      if (spec.default === null) continue;
      expect(spec.default, word).toBeGreaterThanOrEqual(spec.range[0]);
      expect(spec.default, word).toBeLessThanOrEqual(spec.range[1]);
    }
  });

  it("頻度語をすべて持つ", () => {
    expect(Object.keys(FREQ)).toEqual(["毎分", "毎時", "毎日", "毎週", "毎月", "毎年"]);
  });

  it("第 N の値", () => {
    expect(NTH.第3).toBe(3);
    expect(NTH.最終).toBe(-1);
  });
});

describe("時刻の整形", () => {
  it.each([
    [0, "午前0時"],
    [9, "午前9時"],
    [12, "午後0時"],
    [15, "午後3時"],
    [23, "午後11時"],
  ])("12h: %i → %s", (hour, expected) => {
    expect(formatHour(hour, { style: "casual", hour: "12h" })).toBe(expected);
  });

  it("24h 表記", () => {
    expect(formatHour(15, { style: "casual", hour: "24h" })).toBe("15時");
  });

  it.each([
    [12, 0, "casual", "正午"],
    [12, 0, "formal", "午後0時00分"],
    [9, 0, "casual", "午前9時"],
    [9, 5, "casual", "午前9時5分"],
    [9, 5, "formal", "午前9時05分"],
    [18, 30, "casual", "午後6時30分"],
  ] as const)("%i:%i (%s) → %s", (hour, minute, style, expected) => {
    expect(formatTime(hour, minute, { style, hour: "12h" })).toBe(expected);
  });
});
