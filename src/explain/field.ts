import {
  DOM_SPEC,
  DOW_LABELS,
  DOW_SPEC,
  HOUR_SPEC,
  MINUTE_SPEC,
  MONTH_SPEC,
  SECOND_SPEC,
} from "../cron/fields";
import { coversAll, expandField, fullRangeStep, hasExtension, toRanges } from "../cron/values";
import type { FieldAST } from "../types";
import { formatHour, type TimeStyle } from "./time";

/** 「AとB」「A、B、C」 */
export function joinJa(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]}と${items[1]}`;
  return items.join("、");
}

/**
 * 値の並びを、連続部分を範囲に畳みながら日本語にする。
 */
export function describeValues(
  values: number[],
  point: (value: number) => string,
  range: (from: number, to: number) => string,
): string {
  const texts: string[] = [];
  for (const [from, to] of toRanges(values)) {
    // 3 個以上連続している場合のみ範囲に畳む
    if (to - from >= 2) {
      texts.push(range(from, to));
    } else {
      for (let value = from; value <= to; value++) texts.push(point(value));
    }
  }
  return joinJa(texts);
}

export function describeMinuteValues(ast: FieldAST): string {
  const values = expandField(ast, MINUTE_SPEC);
  return describeValues(
    values,
    (value) => `${value}分`,
    (from, to) => `${from}分から${to}分まで`,
  );
}

/** 分フィールドの説明。全域は「毎分」、ステップ指定は「N分ごと」 */
export function describeMinuteField(ast: FieldAST): string {
  if (coversAll(ast, MINUTE_SPEC)) return "毎分";
  const step = fullRangeStep(ast, MINUTE_SPEC);
  if (step !== undefined) return `${step}分ごと`;
  if (ast.kind === "step" && ast.base.kind === "range") {
    return `${ast.base.from}分から${ast.base.to}分まで${ast.step}分ごと`;
  }
  return describeMinuteValues(ast);
}

export function describeSecondField(ast: FieldAST): string {
  if (coversAll(ast, SECOND_SPEC)) return "毎秒";
  const step = fullRangeStep(ast, SECOND_SPEC);
  if (step !== undefined) return `${step}秒ごと`;
  const values = expandField(ast, SECOND_SPEC);
  return describeValues(
    values,
    (value) => `${value}秒`,
    (from, to) => `${from}秒から${to}秒まで`,
  );
}

export function describeHourValues(ast: FieldAST, style: TimeStyle): string {
  const values = expandField(ast, HOUR_SPEC);
  return describeValues(
    values,
    (value) => formatHour(value, style),
    (from, to) => `${formatHour(from, style)}から${formatHour(to, style)}まで`,
  );
}

export function describeHourField(ast: FieldAST, style: TimeStyle): string {
  if (coversAll(ast, HOUR_SPEC)) return "毎時";
  const step = fullRangeStep(ast, HOUR_SPEC);
  if (step !== undefined) return `${step}時間ごと`;
  if (ast.kind === "step" && ast.base.kind === "range") {
    const from = formatHour(ast.base.from, style);
    const to = formatHour(ast.base.to, style);
    return `${from}から${to}まで${ast.step}時間ごと`;
  }
  return describeHourValues(ast, style);
}

export function describeMonthField(ast: FieldAST): string {
  if (coversAll(ast, MONTH_SPEC)) return "毎月";
  const step = fullRangeStep(ast, MONTH_SPEC);
  if (step !== undefined) return `${step}か月ごと`;
  const values = expandField(ast, MONTH_SPEC);
  return describeValues(
    values,
    (value) => `${value}月`,
    (from, to) => `${from}月から${to}月まで`,
  );
}

export function describeDayOfMonthField(ast: FieldAST): string {
  if (coversAll(ast, DOM_SPEC)) return "毎日";
  if (ast.kind === "last") {
    return ast.offset === undefined ? "月末" : `月末の${ast.offset}日前`;
  }
  if (ast.kind === "nearestWeekday") return `${ast.day}日に最も近い平日`;
  // parse 側が「1日から3日ごと」を解釈できず往復が壊れるため、起点は明示しない。
  // 「毎月」が前置されるので、月をまたいで数え直す点は文脈から読み取れる。
  const step = fullRangeStep(ast, DOM_SPEC);
  if (step !== undefined) return `${step}日ごと`;
  if (ast.kind === "list" && hasExtension(ast)) {
    return joinJa(ast.items.map(describeDayOfMonthField));
  }
  const values = expandField(ast, DOM_SPEC);
  return describeValues(
    values,
    (value) => `${value}日`,
    (from, to) => `${from}日から${to}日まで`,
  );
}

export interface DowOptions {
  /** 「毎週」を前置するか */
  weekly: boolean;
  /** 「平日」「週末」に畳むか */
  collapse: boolean;
}

function dowLabel(value: number): string {
  return DOW_LABELS[value] ?? `${value}`;
}

export function describeDayOfWeekField(ast: FieldAST, options: DowOptions): string {
  if (ast.kind === "any" || ast.kind === "noSpecific") return "毎日";
  if (ast.kind === "nth") {
    const label = dowLabel(ast.weekday);
    return ast.nth === -1 ? `最終${label}` : `第${ast.nth}${label}`;
  }
  if (ast.kind === "list" && hasExtension(ast)) {
    return joinJa(
      ast.items.map((item) => describeDayOfWeekField(item, { ...options, weekly: false })),
    );
  }

  const values = expandField(ast, DOW_SPEC);
  if (values.length === 7) return "毎日";
  if (options.collapse) {
    const key = values.join(",");
    if (key === "1,2,3,4,5") return "平日";
    if (key === "0,6") return "週末";
  }
  const text = describeValues(
    values,
    dowLabel,
    (from, to) => `${dowLabel(from)}から${dowLabel(to)}まで`,
  );
  return options.weekly ? `毎週${text}` : text;
}
