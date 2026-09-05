import { CronSyntaxError } from "../errors";
import type { ParserOptions, ValidationError, ValidationResult } from "../types";
import { DOM_SPEC, MONTH_SPEC } from "./fields";
import { parseExpression } from "./parser";
import { expandField, hasExtension, isAny } from "./values";

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_LABELS = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

/**
 * cron 式を検証する。構文エラーは throw せず {@link ValidationResult} として返す。
 */
export function validate(expression: string, options: ParserOptions = {}): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  let parsed: ReturnType<typeof parseExpression>;
  try {
    parsed = parseExpression(expression, options);
  } catch (error) {
    if (error instanceof CronSyntaxError) {
      const entry: ValidationError = {
        field: error.field ?? "expression",
        message: error.message,
      };
      if (error.position !== undefined) entry.position = error.position;
      errors.push(entry);
      return { valid: false, errors, warnings };
    }
    /* c8 ignore next 2 -- parseExpression は CronSyntaxError しか投げない */
    throw error;
  }

  const { ast, extensions } = parsed;

  if (extensions.includes("L") || extensions.includes("#") || extensions.includes("W")) {
    const used = extensions.filter((extension) => extension !== "?").join("', '");
    warnings.push(`'${used}' は Quartz 拡張です。標準の cron（Vixie cron）では動作しません`);
    warnings.push("拡張構文を含む式では次回実行日時（next）を計算できません");
  }

  if (!isAny(ast.dayOfMonth) && !isAny(ast.dayOfWeek)) {
    warnings.push(
      "標準の cron では日と曜日を同時に指定すると OR 条件になり、どちらかに一致する日に実行されます",
    );
  }

  if (
    !isAny(ast.month) &&
    !isAny(ast.dayOfMonth) &&
    !hasExtension(ast.dayOfMonth) &&
    !hasExtension(ast.month)
  ) {
    const months = expandField(ast.month, MONTH_SPEC);
    const days = expandField(ast.dayOfMonth, DOM_SPEC);
    const impossible: string[] = [];
    let anyPossible = false;
    for (const month of months) {
      const limit = DAYS_IN_MONTH[month - 1] ?? 31;
      for (const day of days) {
        if (day <= limit) {
          anyPossible = true;
        } else {
          impossible.push(`${MONTH_LABELS[month - 1] ?? `${month}月`}${day}日`);
        }
      }
    }
    if (!anyPossible && impossible.length > 0) {
      warnings.push(`${impossible.join("、")}は存在しないため、このジョブは実行されません`);
    } else if (impossible.length > 0) {
      warnings.push(`${impossible.join("、")}は存在しないため、その日は実行されません`);
    }
    if (months.includes(2) && days.includes(29)) {
      warnings.push("2月29日はうるう年にのみ実行されます");
    }
  }

  return { valid: true, errors, warnings };
}
