import {
  DOM_SPEC,
  DOW_SPEC,
  expandField,
  type FieldSpec,
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
  const timeZone = resolveTimeZone(options.tz);
  const text = compose(shiftAst(parsed.ast, timeZone, "toLocal"), resolve(options));
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
  const timeZone = resolveTimeZone(options.tz);
  const ast = shiftAst(parsed.ast, timeZone, "toLocal");

  const normalized = formatExpression(parsed.ast);
  const localized = ast === parsed.ast ? normalized : formatExpression(ast);
  // 書き換わったフィールドだけ raw を差し替える。触っていないフィールドは
  // 入力の字面（JAN や MON-FRI）をそのまま見せる
  const raw = (field: keyof typeof parsed.raw, before: FieldAST, after: FieldAST): string =>
    before === after ? (parsed.raw[field] ?? formatField(after)) : formatField(after);
  const dowOptions = { weekly: false, collapse: composeOptions.collapseWeekdays };

  const fields: Explanation["fields"] = {
    minute: explainField(
      raw("minute", parsed.ast.minute, ast.minute),
      ast.minute,
      MINUTE_SPEC,
      describeMinuteField(ast.minute),
    ),
    hour: explainField(
      raw("hour", parsed.ast.hour, ast.hour),
      ast.hour,
      HOUR_SPEC,
      describeHourField(ast.hour, composeOptions),
    ),
    dayOfMonth: explainField(
      raw("dayOfMonth", parsed.ast.dayOfMonth, ast.dayOfMonth),
      ast.dayOfMonth,
      DOM_SPEC,
      describeDayOfMonthField(ast.dayOfMonth),
    ),
    month: explainField(
      raw("month", parsed.ast.month, ast.month),
      ast.month,
      MONTH_SPEC,
      describeMonthField(ast.month),
    ),
    dayOfWeek: explainField(
      raw("dayOfWeek", parsed.ast.dayOfWeek, ast.dayOfWeek),
      ast.dayOfWeek,
      DOW_SPEC,
      describeDayOfWeekField(ast.dayOfWeek, dowOptions),
    ),
  };
  if (ast.seconds !== undefined) {
    fields.second = explainField(
      raw("seconds", parsed.ast.seconds ?? ast.seconds, ast.seconds),
      ast.seconds,
      SECOND_SPEC,
      describeSecondField(ast.seconds),
    );
  }

  const composed = compose(ast, composeOptions);
  const text = options.showTimeZone === true ? `${composed}（${timeZone}）` : composed;
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
