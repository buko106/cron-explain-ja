import {
  DOM_SPEC,
  DOW_SPEC,
  HOUR_SPEC,
  MINUTE_SPEC,
  MONTH_SPEC,
  SECOND_SPEC,
} from "../cron/fields";
import { coversAll, expandField, fullRangeStep, isAny, rangeStep, toRanges } from "../cron/values";
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
  minuteWithinHour,
} from "./field";
import { formatHour, formatTime, type TimeStyle } from "./time";

export interface ComposeOptions extends TimeStyle {
  collapseWeekdays: boolean;
}

/** 「毎分」「15分ごと」「毎時0分」のように、時を限定しない文での分の表現 */
function minuteAlone(part: MinutePart): string {
  switch (part.kind) {
    case "any":
    case "step":
    case "rangeStep":
      return minuteBare(part);
    case "single":
      return `毎時${part.value}分`;
    case "values":
      return `毎時${part.text}`;
  }
}

/**
 * 時の節に続けるときの分の表現。
 * 「AからBまでNごと」を自己完結した形のまま置くと、時の範囲の「まで」と重なって
 * 「午前9時から午後5時まで5分から59分まで15分ごと」のように読めなくなる。
 * 「毎時」で分の節の始まりを示し、時の中での位置として組み立てる。
 */
function minuteAfterHours(part: MinutePart): string {
  if (part.kind === "rangeStep") return `毎時${minuteWithinHour(part)}`;
  return minuteAlone(part);
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
    result = { text: minuteAlone(minute), frequency: true };
  } else if (hourStep !== undefined) {
    result = { text: `${hourStep}時間ごと（${minuteAfterHours(minute)}）`, frequency: true };
  } else if (hourRange !== undefined) {
    const from = formatHour(hourRange.from, options);
    const to = formatHour(hourRange.to, options);
    const step = `${hourRange.step}時間ごと（${minuteAfterHours(minute)}）`;
    result = { text: `${from}から${to}まで${step}`, frequency: false };
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
      // 「台」自体が時の中を指すので、ここでは「毎時」を前置しない
      result = { text: `${hours}の${minuteWithinHour(minute)}`, frequency: false };
    } else {
      result = {
        text: `${describeHourValues(hour, options)}${minuteAfterHours(minute)}`,
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
  const domAll = coversAll(ast.dayOfMonth, DOM_SPEC);
  const monthAny = coversAll(ast.month, MONTH_SPEC);
  const dowAll = coversAll(ast.dayOfWeek, DOW_SPEC);

  // 標準の cron では、日と曜日を「両方とも」指定すると OR 条件になる（`*` / `?` は指定と
  // 見なさない）。片方が全域を覆っていれば、もう片方が何であれ毎日一致する。
  // `0 0 15 * 0-7` は「毎月15日」ではなく毎日動く
  const orCoversEveryDay = !isAny(ast.dayOfMonth) && !isAny(ast.dayOfWeek) && (domAll || dowAll);
  const domAny = domAll || orCoversEveryDay;
  const dowAny = dowAll || orCoversEveryDay;

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
