import { ParseAmbiguityError } from "../errors";
import type { ParseOptions, ParseResult } from "../types";
import { emit, fill } from "./fill";
import { normalize } from "./normalize";
import { tokenize } from "./tokenize";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 日本語の予定表現を cron 式に変換する。
 *
 * ```ts
 * parse('平日の朝9時').expression; // '0 9 * * 1-5'
 * ```
 *
 * @throws {ParseAmbiguityError} `strict: true` かつ解釈が曖昧な場合
 */
export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const tokens = tokenize(normalize(text));
  const slots = fill(tokens, options);

  if (slots.empty) {
    const result: ParseResult = {
      expression: null,
      confidence: 0,
      ambiguities: [],
      notes: ["時間表現が見つかりませんでした"],
      tokens,
    };
    if (options.strict === true) {
      throw new ParseAmbiguityError("時間表現が見つかりませんでした", result);
    }
    return result;
  }

  const total = slots.penalties.reduce((sum, penalty) => sum + penalty.amount, 0);
  const result: ParseResult = {
    expression: emit(slots),
    confidence: round2(Math.max(0, 1 - total)),
    ambiguities: slots.ambiguities,
    notes: slots.notes,
    tokens,
  };

  if (options.strict === true && result.ambiguities.length > 0) {
    const first = result.ambiguities[0];
    throw new ParseAmbiguityError(
      `解釈が曖昧です: ${first?.question ?? "入力を特定できません"}`,
      result,
    );
  }

  return result;
}

export * from "./dictionary";
export { emit, fill } from "./fill";
export { kanjiToArabic, normalize, stripTail } from "./normalize";
export { tokenize } from "./tokenize";
