import type { NextOptions } from "../types";
import { DOM_SPEC, DOW_SPEC, HOUR_SPEC, MINUTE_SPEC, MONTH_SPEC, SECOND_SPEC } from "./fields";
import { parseExpression } from "./parser";
import { expandField, isAny } from "./values";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

/** 瞬間 → UTC の壁時計 */
function partsOf(date: Date): Parts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    dayOfWeek: date.getUTCDay(),
  };
}

/** UTC の壁時計 → 瞬間。範囲外の値（13 月・32 日・24 時など）は繰り上がる */
function dateOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
}

/** sorted の中で value 以上の最小値。無ければ null */
function atLeast(sorted: number[], value: number): number | null {
  for (const candidate of sorted) {
    if (candidate >= value) return candidate;
  }
  return null;
}

/** 5 年先まで探索する */
const SEARCH_YEARS = 5;

/** 無限ループを避けるための保険 */
const MAX_ITERATIONS = 2_000_000;

/**
 * cron 式の次回実行日時を求める。
 *
 * cron 式は UTC のサーバーで動くものとして解釈する。返るのは絶対時刻なので、
 * どのタイムゾーンで表示するかは呼び出し側の裁量。
 *
 * `L` / `#` / `W` を含む式は v1 では計算対象外で、空配列を返す。
 */
export function next(expression: string, options: NextOptions = {}): Date[] {
  const parserOptions = options.seconds === true ? { seconds: true } : {};
  const parsed = parseExpression(expression, parserOptions);
  if (parsed.extensions.some((extension) => extension !== "?")) return [];

  const count = options.count ?? 3;
  if (count <= 0) return [];

  const from = options.from ?? new Date();
  if (Number.isNaN(from.getTime())) return [];

  const ast = parsed.ast;
  const seconds = ast.seconds === undefined ? [0] : expandField(ast.seconds, SECOND_SPEC);
  const minutes = expandField(ast.minute, MINUTE_SPEC);
  const hours = expandField(ast.hour, HOUR_SPEC);
  const months = expandField(ast.month, MONTH_SPEC);
  const days = expandField(ast.dayOfMonth, DOM_SPEC);
  const weekdays = expandField(ast.dayOfWeek, DOW_SPEC);
  if ([seconds, minutes, hours, months].some((values) => values.length === 0)) return [];

  const domRestricted = !isAny(ast.dayOfMonth);
  const dowRestricted = !isAny(ast.dayOfWeek);
  const daySet = new Set(days);
  const weekdaySet = new Set(weekdays);
  const monthSet = new Set(months);

  const dayMatches = (parts: Parts): boolean => {
    if (domRestricted && dowRestricted) {
      return daySet.has(parts.day) || weekdaySet.has(parts.dayOfWeek);
    }
    if (domRestricted) return daySet.has(parts.day);
    if (dowRestricted) return weekdaySet.has(parts.dayOfWeek);
    return true;
  };

  const startParts = partsOf(from);
  const limitYear = startParts.year + SEARCH_YEARS;

  // 起点そのものは含めないので 1 秒進めてから秒に丸める
  const initial = partsOf(new Date(from.getTime() + 1000));
  let cursor = dateOf(
    initial.year,
    initial.month,
    initial.day,
    initial.hour,
    initial.minute,
    initial.second,
  );

  const results: Date[] = [];
  let iterations = 0;
  while (results.length < count && iterations < MAX_ITERATIONS) {
    iterations += 1;
    const parts = partsOf(cursor);
    if (parts.year > limitYear) break;

    if (!monthSet.has(parts.month)) {
      cursor = dateOf(parts.year, parts.month + 1, 1, 0, 0, 0);
      continue;
    }
    if (!dayMatches(parts)) {
      cursor = dateOf(parts.year, parts.month, parts.day + 1, 0, 0, 0);
      continue;
    }
    const hour = atLeast(hours, parts.hour);
    if (hour === null) {
      cursor = dateOf(parts.year, parts.month, parts.day + 1, 0, 0, 0);
      continue;
    }
    if (hour !== parts.hour) {
      cursor = dateOf(parts.year, parts.month, parts.day, hour, 0, 0);
      continue;
    }
    const minute = atLeast(minutes, parts.minute);
    if (minute === null) {
      cursor = dateOf(parts.year, parts.month, parts.day, parts.hour + 1, 0, 0);
      continue;
    }
    if (minute !== parts.minute) {
      cursor = dateOf(parts.year, parts.month, parts.day, parts.hour, minute, 0);
      continue;
    }
    const second = atLeast(seconds, parts.second);
    if (second === null) {
      cursor = dateOf(parts.year, parts.month, parts.day, parts.hour, parts.minute + 1, 0);
      continue;
    }
    if (second !== parts.second) {
      cursor = dateOf(parts.year, parts.month, parts.day, parts.hour, parts.minute, second);
      continue;
    }

    results.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 1000);
  }

  return results;
}
