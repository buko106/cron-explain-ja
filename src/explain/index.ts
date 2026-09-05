import {
  DOM_SPEC,
  DOW_SPEC,
  expandField,
  type FieldSpec,
  formatField,
  HOUR_SPEC,
  hasExtension,
  MINUTE_SPEC,
  MONTH_SPEC,
  next,
  parseExpression,
  SECOND_SPEC,
  validate,
} from "../cron";
import type {
  CronAST,
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
 * ```ts
 * explain('0 9 * * 1-5'); // '平日の午前9時'
 * ```
 *
 * @throws {CronSyntaxError} 式が不正な場合
 */
export function explain(expression: string, options: ExplainOptions = {}): string {
  const parsed = parseExpression(expression, parserOptions(options));
  const text = compose(parsed.ast, resolve(options));
  return options.tz === undefined || options.tz === "" ? text : `${text}（${options.tz}）`;
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

/** 正規化された cron 式を組み立てる */
export function formatExpression(ast: CronAST): string {
  const fields = [ast.minute, ast.hour, ast.dayOfMonth, ast.month, ast.dayOfWeek].map(formatField);
  if (ast.seconds !== undefined) fields.unshift(formatField(ast.seconds));
  return fields.join(" ");
}

/**
 * cron 式をフィールド別の内訳・注意書き・次回実行日時つきで説明する。
 */
export function explainDetailed(expression: string, options: ExplainOptions = {}): Explanation {
  const parsed = parseExpression(expression, parserOptions(options));
  const composeOptions = resolve(options);
  const ast = parsed.ast;

  const normalized = formatExpression(ast);
  const dowOptions = { weekly: false, collapse: composeOptions.collapseWeekdays };

  const fields: Explanation["fields"] = {
    minute: explainField(
      parsed.raw.minute,
      ast.minute,
      MINUTE_SPEC,
      describeMinuteField(ast.minute),
    ),
    hour: explainField(
      parsed.raw.hour,
      ast.hour,
      HOUR_SPEC,
      describeHourField(ast.hour, composeOptions),
    ),
    dayOfMonth: explainField(
      parsed.raw.dayOfMonth,
      ast.dayOfMonth,
      DOM_SPEC,
      describeDayOfMonthField(ast.dayOfMonth),
    ),
    month: explainField(parsed.raw.month, ast.month, MONTH_SPEC, describeMonthField(ast.month)),
    dayOfWeek: explainField(
      parsed.raw.dayOfWeek,
      ast.dayOfWeek,
      DOW_SPEC,
      describeDayOfWeekField(ast.dayOfWeek, dowOptions),
    ),
  };
  if (ast.seconds !== undefined && parsed.raw.seconds !== undefined) {
    fields.second = explainField(
      parsed.raw.seconds,
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
    fields,
    extensions: parsed.extensions,
    notes: warnings,
    next: next(expression, { ...parserOptions(options), count: 3 }),
  };
}
