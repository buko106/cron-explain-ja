import {
  DOM_SPEC,
  DOW_LABELS,
  DOW_SPEC,
  HOUR_SPEC,
  MINUTE_SPEC,
  MONTH_SPEC,
  SECOND_SPEC,
} from "../cron/fields";
import {
  coversAll,
  expandField,
  fullRangeStep,
  hasExtension,
  rangeStep,
  toRanges,
} from "../cron/values";
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

/** 分フィールドの、時と組み合わせるための表現 */
export type MinutePart =
  | { kind: "any" }
  | { kind: "step"; text: string }
  | { kind: "rangeStep"; from: number; to: number; step: number }
  | { kind: "single"; value: number }
  | { kind: "values"; text: string };

/**
 * 分フィールドを、文の組み立てに使える形に分解する。
 * 文単位（`compose.ts`）とフィールド単位（{@link describeMinuteField}）で
 * 同じ規則を使うため、判定はここだけに置く。
 */
export function minutePart(ast: FieldAST): MinutePart {
  if (coversAll(ast, MINUTE_SPEC)) return { kind: "any" };
  const step = fullRangeStep(ast, MINUTE_SPEC);
  if (step !== undefined) return { kind: "step", text: `${step}分ごと` };
  const ranged = rangeStep(ast, MINUTE_SPEC);
  if (ranged !== undefined) return { kind: "rangeStep", ...ranged };
  const values = expandField(ast, MINUTE_SPEC);
  const first = values[0];
  if (values.length === 1 && first !== undefined) return { kind: "single", value: first };
  return { kind: "values", text: describeMinuteValues(ast) };
}

/** 前に何も置かずに単独で読める分の表現 */
export function minuteBare(part: MinutePart): string {
  switch (part.kind) {
    case "any":
      return "毎分";
    case "step":
      return part.text;
    case "rangeStep":
      return `${part.from}分から${part.to}分まで${part.step}分ごと`;
    case "single":
      return `${part.value}分`;
    case "values":
      return part.text;
  }
}

/**
 * 時の節に続けるときの、時の中での分の表現。
 * 刻みは時をまたがないので、上限が 59 分なら「59分まで」は何も足さない。
 * 時の範囲の「まで」と重なって読みにくくするだけなので落とす。
 */
export function minuteWithinHour(part: MinutePart): string {
  if (part.kind !== "rangeStep") return minuteBare(part);
  const { from, to, step } = part;
  if (to === MINUTE_SPEC.max) return `${from}分から${step}分ごと`;
  return `${from}分から${to}分まで${step}分ごと`;
}

/** 分フィールドの説明。全域は「毎分」、ステップ指定は「N分ごと」 */
export function describeMinuteField(ast: FieldAST): string {
  return minuteBare(minutePart(ast));
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
  const ranged = rangeStep(ast, HOUR_SPEC);
  if (ranged !== undefined) {
    const from = formatHour(ranged.from, style);
    const to = formatHour(ranged.to, style);
    return `${from}から${to}まで${ranged.step}時間ごと`;
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
