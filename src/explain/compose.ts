import {
  DOM_SPEC,
  DOW_SPEC,
  HOUR_SPEC,
  MINUTE_SPEC,
  MONTH_SPEC,
  SECOND_SPEC,
} from "../cron/fields";
import { coversAll, expandField, fullRangeStep, rangeStep, toRanges } from "../cron/values";
import type { CronAST } from "../types";
import {
  describeDayOfMonthField,
  describeDayOfWeekField,
  describeHourValues,
  describeMonthField,
  describeSecondField,
  joinJa,
  type MinutePart,
  minuteBare,
  minutePart,
} from "./field";
import { formatHour, formatTime, type TimeStyle } from "./time";

export interface ComposeOptions extends TimeStyle {
  collapseWeekdays: boolean;
}

/** 「毎分」「15分ごと」「毎時0分」のように、時の範囲に続けるときの分の表現 */
function minuteSuffix(part: MinutePart): string {
  switch (part.kind) {
    case "any":
      return "毎分";
    case "step":
      return part.text;
    case "single":
      return `毎時${part.value}分`;
    case "values":
      return `毎時${part.text}`;
  }
}

export interface TimeDescription {
  text: string;
  /** 「毎分」「N分ごと」のように頻度そのものを表す表現か */
  frequency: boolean;
}

/**
 * 時刻部分を組み立てる。
 */
export function describeTime(ast: CronAST, options: ComposeOptions): TimeDescription {
  const minute = minutePart(ast.minute);
  const hour = ast.hour;
  let result: TimeDescription;

  const hourStep = fullRangeStep(hour, HOUR_SPEC);
  const hourRange = rangeStep(hour, HOUR_SPEC);

  if (coversAll(hour, HOUR_SPEC)) {
    result = { text: minuteSuffix(minute), frequency: true };
  } else if (hourStep !== undefined) {
    const suffix =
      minute.kind === "single" ? `（毎時${minute.value}分）` : `（${minuteSuffix(minute)}）`;
    result = { text: `${hourStep}時間ごと${suffix}`, frequency: true };
  } else if (hourRange !== undefined) {
    const from = formatHour(hourRange.from, options);
    const to = formatHour(hourRange.to, options);
    const suffix =
      minute.kind === "single" ? `（毎時${minute.value}分）` : `（${minuteSuffix(minute)}）`;
    result = { text: `${from}から${to}まで${hourRange.step}時間ごと${suffix}`, frequency: false };
  } else {
    const values = expandField(hour, HOUR_SPEC);
    const ranges = toRanges(values);
    // describeHourValues は 3 個以上連続したときだけ範囲に畳む。同じ閾値で判定しないと、
    // 12,13 のような 2 個の連なりが「範囲になった」扱いのまま点として並び、
    // 「午後0時と午後1時毎時0分」のように接続が抜けた文になる
    const allPoints = ranges.every(([from, to]) => to - from < 2);
    if (allPoints && minute.kind === "single") {
      result = {
        text: joinJa(values.map((value) => formatTime(value, minute.value, options))),
        frequency: false,
      };
    } else if (allPoints) {
      // 「台」は各時に付ける。「午後2時と午後6時台」では 2 時に掛からない
      const hours = joinJa(values.map((value) => `${formatHour(value, options)}台`));
      result = { text: `${hours}の${minuteBare(minute)}`, frequency: false };
    } else {
      result = {
        text: `${describeHourValues(hour, options)}${minuteSuffix(minute)}`,
        frequency: false,
      };
    }
  }

  const seconds = ast.seconds;
  if (seconds === undefined) return result;
  // 「0 秒ちょうど」は既定の挙動なので触れない
  if (seconds.kind === "value" && seconds.value === 0) return result;

  if (coversAll(ast.hour, HOUR_SPEC) && coversAll(ast.minute, MINUTE_SPEC)) {
    if (coversAll(seconds, SECOND_SPEC)) return { text: "毎秒", frequency: true };
    const secondStep = fullRangeStep(seconds, SECOND_SPEC);
    if (secondStep !== undefined) return { text: `${secondStep}秒ごと`, frequency: true };
  }
  return { text: `${result.text}の${describeSecondField(seconds)}`, frequency: result.frequency };
}

export interface DateDescription {
  text: string;
  /** 時刻表現と「の」で繋ぐか */
  joinWithNo: boolean;
  /** 日付を一切限定していないか */
  everyDay: boolean;
}

/**
 * 日付部分を組み立てる。
 */
export function describeDate(ast: CronAST, options: ComposeOptions): DateDescription {
  const domAny = coversAll(ast.dayOfMonth, DOM_SPEC);
  const monthAny = coversAll(ast.month, MONTH_SPEC);
  const dowAny = coversAll(ast.dayOfWeek, DOW_SPEC);

  if (domAny && monthAny && dowAny) {
    return { text: "毎日", joinWithNo: false, everyDay: true };
  }

  const monthText = describeMonthField(ast.month);

  if (domAny && !dowAny) {
    const dow = describeDayOfWeekField(ast.dayOfWeek, {
      weekly: true,
      collapse: options.collapseWeekdays,
    });
    const text = monthAny ? dow : `${monthText}の${dow}`;
    return { text, joinWithNo: true, everyDay: false };
  }

  if (!domAny && dowAny) {
    const dom = describeDayOfMonthField(ast.dayOfMonth);
    if (monthAny) return { text: `毎月${dom}`, joinWithNo: true, everyDay: false };
    if (ast.month.kind === "value" && ast.dayOfMonth.kind === "value") {
      return { text: `毎年${monthText}${dom}`, joinWithNo: true, everyDay: false };
    }
    return { text: `${monthText}の${dom}`, joinWithNo: true, everyDay: false };
  }

  if (!domAny && !dowAny) {
    const dom = describeDayOfMonthField(ast.dayOfMonth);
    const dow = describeDayOfWeekField(ast.dayOfWeek, {
      weekly: false,
      collapse: options.collapseWeekdays,
    });
    const base = monthAny
      ? `毎月${dom}`
      : ast.month.kind === "value" && ast.dayOfMonth.kind === "value"
        ? `毎年${monthText}${dom}`
        : `${monthText}の${dom}`;
    return { text: `${base}および${dow}`, joinWithNo: true, everyDay: false };
  }

  // 月だけが指定されている
  return { text: `${monthText}の毎日`, joinWithNo: false, everyDay: false };
}

/**
 * 日付部分と時刻部分を 1 文に組み立てる。
 */
export function compose(ast: CronAST, options: ComposeOptions): string {
  const time = describeTime(ast, options);
  const date = describeDate(ast, options);
  if (date.everyDay && time.frequency) return time.text;
  return `${date.text}${date.joinWithNo ? "の" : ""}${time.text}`;
}
