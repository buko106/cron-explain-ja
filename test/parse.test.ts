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
