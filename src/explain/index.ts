import {
  DOM_SPEC,
  DOW_SPEC,
  expandField,
  type FieldSpec,
  fixedOffsetMinutes,
  formatExpression,
  formatField,
  HOUR_SPEC,
  hasExtension,
  MINUTE_SPEC,
  MONTH_SPEC,
  next,
  parseExpression,
  resolveTimeZone,
  SECOND_SPEC,
  SERVER_TIME_ZONE,
  shiftAst,
  validate,
} from "../cron";
import type {
  ExplainOptions,
  Explanation,
  FieldAST,
  FieldExplanation,
  ParserOptions,
} from "../types";
import type { ComposeOptions } from "./compose";
import { compose } from "./compose";
import {
  describeDayOfMonthField,
  describeDayOfWeekField,
  describeHourField,
  describeMinuteField,
  describeMonthField,
  describeSecondField,
} from "./field";

function resolve(options: ExplainOptions): ComposeOptions {
  return {
    style: options.style ?? "casual",
    hour: options.hour ?? "12h",
    collapseWeekdays: options.collapseWeekdays ?? true,
  };
}

function parserOptions(options: ExplainOptions): ParserOptions {
  return options.seconds === true ? { seconds: true } : {};
}

/**
 * cron 式（UTC）を読み替えるゾーンと、そこまでのずれ（分）を求める。
 *
 * @throws {CronTimeZoneError} ゾーン名が解釈できない、または夏時間がある場合
 */
function timeZoneShift(options: ExplainOptions): { timeZone: string; delta: number } {
  const timeZone = resolveTimeZone(options.tz);
  // UTC のままなら夏時間の検査も要らない
  if (timeZone === SERVER_TIME_ZONE) return { timeZone, delta: 0 };
  return { timeZone, delta: fixedOffsetMinutes(timeZone) };
}

/**
 * cron 式を 1 文の日本語に変換する。
 *
 * 式は UTC のサーバーで動くものとして読み、`options.tz`（既定 `'Asia/Tokyo'`）の
 * 壁時計に直してから日本語にする。
 *
 * ```ts
 * explain('0 4 * * 1-5'); // '平日の午後1時'（UTC 04:00 = JST 13:00）
 * explain('0 9 * * 1-5', { tz: 'UTC' }); // '平日の午前9時'（変換しない）
 * ```
 *
 * @throws {CronSyntaxError} 式が不正な場合
 * @throws {CronTimeZoneError} `tz` を解釈できない、または cron 式に書き換えられない場合
 */
export function explain(expression: string, options: ExplainOptions = {}): string {
  const parsed = parseExpression(expression, parserOptions(options));
  const { timeZone, delta } = timeZoneShift(options);
  const text = compose(shiftAst(parsed.ast, delta, timeZone), resolve(options));
  return options.showTimeZone === true ? `${text}（${timeZone}）` : text;
}

function kindOf(ast: FieldAST): FieldExplanation["kind"] {
  if (hasExtension(ast) || ast.kind === "noSpecific") return "extension";
  switch (ast.kind) {
    case "any":
      return "any";
    case "value":
      return "value";
    case "range":
      return "range";
    case "step":
      return "step";
    case "list":
      return "list";
    /* c8 ignore next 2 -- 拡張構文は上で処理済み */
    default:
      return "extension";
  }
}

function explainField(raw: string, ast: FieldAST, spec: FieldSpec, text: string): FieldExplanation {
  return {
    raw,
    kind: kindOf(ast),
    values: hasExtension(ast) ? [] : expandField(ast, spec),
    text,
  };
}

/**
 * cron 式をフィールド別の内訳・注意書き・次回実行日時つきで説明する。
 *
 * `fields` は `options.tz` の壁時計に直したあとの値を説明する（`localExpression` と対応）。
 * `expression` は入力（UTC）を正規化したもの、`next` は UTC として解釈した絶対時刻。
 *
 * @throws {CronSyntaxError} 式が不正な場合
 * @throws {CronTimeZoneError} `tz` を解釈できない、または cron 式に書き換えられない場合
 */
export function explainDetailed(expression: string, options: ExplainOptions = {}): Explanation {
  const parsed = parseExpression(expression, parserOptions(options));
  const composeOptions = resolve(options);
  const { timeZone, delta } = timeZoneShift(options);
  const ast = shiftAst(parsed.ast, delta, timeZone);

  const normalized = formatExpression(parsed.ast);
  const localized = delta === 0 ? normalized : formatExpression(ast);
  // 書き換えたあとは入力の字面と値がずれるので、raw も書き換え後のものにする
  const raw = (field: keyof typeof parsed.raw, node: FieldAST): string =>
    delta === 0 ? (parsed.raw[field] ?? formatField(node)) : formatField(node);
  const dowOptions = { weekly: false, collapse: composeOptions.collapseWeekdays };

  const fields: Explanation["fields"] = {
    minute: explainField(
      raw("minute", ast.minute),
      ast.minute,
      MINUTE_SPEC,
      describeMinuteField(ast.minute),
    ),
    hour: explainField(
      raw("hour", ast.hour),
      ast.hour,
      HOUR_SPEC,
      describeHourField(ast.hour, composeOptions),
    ),
    dayOfMonth: explainField(
      raw("dayOfMonth", ast.dayOfMonth),
      ast.dayOfMonth,
      DOM_SPEC,
      describeDayOfMonthField(ast.dayOfMonth),
    ),
    month: explainField(
      raw("month", ast.month),
      ast.month,
      MONTH_SPEC,
      describeMonthField(ast.month),
    ),
    dayOfWeek: explainField(
      raw("dayOfWeek", ast.dayOfWeek),
      ast.dayOfWeek,
      DOW_SPEC,
      describeDayOfWeekField(ast.dayOfWeek, dowOptions),
    ),
  };
  if (ast.seconds !== undefined) {
    fields.second = explainField(
      raw("seconds", ast.seconds),
      ast.seconds,
      SECOND_SPEC,
      describeSecondField(ast.seconds),
    );
  }

  const text = explain(expression, options);
  const { warnings } = validate(expression, parserOptions(options));

  return {
    text,
    expression: normalized,
    localExpression: localized,
    tz: timeZone,
    fields,
    extensions: parsed.extensions,
    notes: warnings,
    next: next(expression, { ...parserOptions(options), count: 3 }),
  };
}
