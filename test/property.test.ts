import { describe, expect, it } from "vitest";
import { CronSyntaxError, explain, next, parse, validate } from "../src/index";

/** 決定的な擬似乱数（テストを再現可能にする） */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const CRON_CHARS = "0123456789*,-/#?LW ABCDEFGJMNOPSTUVYamon@";
const JA_CHARS = "毎日時分曜月火水木金土週平末第朝昼夜半午前後からまでと、0123456789 ごおきabc。";

function randomString(random: () => number, alphabet: string, maxLength: number): string {
  const length = Math.floor(random() * maxLength);
  let text = "";
  for (let i = 0; i < length; i++) {
    text += alphabet[Math.floor(random() * alphabet.length)] ?? "";
  }
  return text;
}

describe("プロパティ: cron パーサはクラッシュしない", () => {
  it("ランダムな文字列では CronSyntaxError だけを投げる", () => {
    const random = createRandom(20260905);
    for (let i = 0; i < 3000; i++) {
      const input = randomString(random, CRON_CHARS, 24);
      try {
        explain(input);
      } catch (error) {
        expect(error, input).toBeInstanceOf(CronSyntaxError);
      }
    }
  });

  it("validate は常に結果を返す", () => {
    const random = createRandom(11);
    for (let i = 0; i < 3000; i++) {
      const input = randomString(random, CRON_CHARS, 24);
      const result = validate(input);
      expect(typeof result.valid, input).toBe("boolean");
      if (!result.valid) expect(result.errors.length, input).toBeGreaterThan(0);
    }
  });

  it("組み合わせで生成した式は explain / next を通る", () => {
    const minutes = ["*", "0", "30", "*/15", "0,30", "10-20"];
    const hours = ["*", "0", "9", "*/2", "9-17", "9,18"];
    const doms = ["*", "1", "15", "1,15", "1-5", "*/10"];
    const months = ["*", "1", "6,12", "1-3", "*/3"];
    const dows = ["*", "0", "1-5", "0,6", "1,3,5", "MON-FRI"];

    let count = 0;
    for (const minute of minutes) {
      for (const hour of hours) {
        for (const dom of doms) {
          for (const month of months) {
            for (const dow of dows) {
              const expression = `${minute} ${hour} ${dom} ${month} ${dow}`;
              expect(validate(expression).valid, expression).toBe(true);
              expect(typeof explain(expression, { tz: "UTC" }), expression).toBe("string");
              expect(explain(expression, { tz: "UTC" }), expression).not.toBe("");
              expect(Array.isArray(next(expression, { count: 1 })), expression).toBe(true);
              count += 1;
            }
          }
        }
      }
    }
    expect(count).toBe(minutes.length * hours.length * doms.length * months.length * dows.length);
  });
});

describe("組み合わせ: 日本語表現", () => {
  it("時刻 × 曜日 × 頻度語の組み合わせが破綻しない", () => {
    const times = ["9時", "9時30分", "午後3時", "朝9時", "0:05", "15分ごと", "2時間おき"];
    const days = ["", "平日の", "週末の", "月曜の", "毎月15日の", "第2月曜の", "月末の"];
    const freqs = ["", "毎日", "毎週", "毎月"];

    for (const time of times) {
      for (const day of days) {
        for (const freq of freqs) {
          const text = `${freq}${day}${time}`;
          const result = parse(text, { tz: "UTC" });
          expect(result.confidence, text).toBeGreaterThanOrEqual(0);
          expect(result.confidence, text).toBeLessThanOrEqual(1);
          expect(result.expression, text).not.toBeNull();
          if (result.expression !== null) {
            expect(validate(result.expression).valid, `${text} -> ${result.expression}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("プロパティ: 日本語パーサはクラッシュしない", () => {
  it("ランダムな日本語では例外を投げず confidence が 0-1 に収まる", () => {
    const random = createRandom(42);
    for (let i = 0; i < 3000; i++) {
      const input = randomString(random, JA_CHARS, 20);
      const result = parse(input, { tz: "UTC" });
      expect(result.confidence, input).toBeGreaterThanOrEqual(0);
      expect(result.confidence, input).toBeLessThanOrEqual(1);
      if (result.expression !== null) {
        expect(validate(result.expression).valid, `${input} -> ${result.expression}`).toBe(true);
      }
    }
  });
});
